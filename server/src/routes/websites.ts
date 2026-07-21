import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { syncWebsitePages } from "../lib/siteDiscovery";
import { baselineQueue, scanQueue } from "../queues/index";

const router = Router();

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

const createWebsiteSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  homepageOnly: z.boolean().optional(),
});

const updateWebsiteSchema = createWebsiteSchema.partial();

type WebsiteRunSummary = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  type: "BASELINE" | "SCAN";
  createdAt: Date;
  completedAt: Date | null;
  startedAt: Date | null;
};

type WebsiteScanConfigSummary = {
  enabled: boolean;
  intervalMinutes?: number | null;
};

function getEffectiveIntervalMinutes(scanConfig?: WebsiteScanConfigSummary | null): number {
  const envValue = parseInt(process.env.AUTO_SCAN_INTERVAL_MINUTES ?? "", 10);

  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }

  if (typeof scanConfig?.intervalMinutes === "number" && scanConfig.intervalMinutes > 0) {
    return scanConfig.intervalMinutes;
  }

  return 20;
}

function getQueueJobId(type: "BASELINE" | "SCAN", scanRunId: string): string {
  return `${type === "BASELINE" ? "baseline" : "scan"}-${scanRunId}`;
}

async function removeQueuedJob(type: "BASELINE" | "SCAN", scanRunId: string): Promise<void> {
  const queue = type === "BASELINE" ? baselineQueue : scanQueue;
  const job = await queue.getJob(getQueueJobId(type, scanRunId));

  if (job) {
    await job.remove();
  }
}

async function cancelPendingWebsiteRuns(websiteId: string): Promise<number> {
  const pendingRuns = await prisma.scanRun.findMany({
    where: {
      websiteId,
      status: "PENDING",
      startedAt: null,
    },
    select: { id: true, type: true },
  });

  for (const run of pendingRuns) {
    try {
      await removeQueuedJob(run.type, run.id);
    } catch (error) {
      console.warn(
        `[websites] Failed to remove queued ${run.type} job for run ${run.id}:`,
        error
      );
    }
  }

  if (pendingRuns.length > 0) {
    await prisma.scanRun.deleteMany({
      where: {
        id: { in: pendingRuns.map((run) => run.id) },
        status: "PENDING",
        startedAt: null,
      },
    });
  }

  return pendingRuns.length;
}

async function scheduleResumeScanIfNeeded(
  websiteId: string,
  scanConfig?: WebsiteScanConfigSummary | null
): Promise<string | null> {
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    include: {
      scanConfig: true,
      pages: {
        orderBy: { createdAt: "asc" },
        include: {
          baselineImages: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: { id: true },
          },
        },
      },
      scanRuns: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          status: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
        },
      },
    },
  });

  if (!website) {
    return null;
  }

  const hasBaseline = website.pages.some((page) => page.baselineImages.length > 0);
  if (!hasBaseline || website.pages.length === 0) {
    return null;
  }

  const activeRun = website.scanRuns.find((run) =>
    ["PENDING", "RUNNING"].includes(run.status)
  );
  if (activeRun) {
    return null;
  }

  const latestCompletedRun = website.scanRuns.find(
    (run) =>
      ["BASELINE", "SCAN"].includes(run.type) &&
      run.status === "COMPLETED" &&
      run.completedAt !== null
  );

  if (!latestCompletedRun?.completedAt) {
    return null;
  }

  const intervalMinutes = getEffectiveIntervalMinutes(scanConfig ?? website.scanConfig);
  const delayMs = Math.max(
    0,
    latestCompletedRun.completedAt.getTime() + intervalMinutes * 60 * 1000 - Date.now()
  );

  const nextRun = await prisma.scanRun.create({
    data: {
      websiteId,
      type: "SCAN",
      status: "PENDING",
      pageResults: {
        create: website.pages.map((page) => ({
          pageId: page.id,
          status: "PENDING",
        })),
      },
    },
    select: { id: true },
  });

  try {
    await scanQueue.add(
      "scan",
      { websiteId, scanRunId: nextRun.id },
      {
        jobId: getQueueJobId("SCAN", nextRun.id),
        delay: delayMs,
      }
    );
  } catch (error) {
    await prisma.scanRun.delete({ where: { id: nextRun.id } });
    throw error;
  }

  return nextRun.id;
}

async function getNextScanSummary(
  websiteId: string,
  scanConfig: WebsiteScanConfigSummary | null | undefined,
  scanRuns: WebsiteRunSummary[]
): Promise<{ nextScanAt: string | null; nextScanStatus: string }> {
  const intervalMinutes = getEffectiveIntervalMinutes(scanConfig);
  const latestCompletedRun = scanRuns.find(
    (run) =>
      ["BASELINE", "SCAN"].includes(run.type) &&
      run.status === "COMPLETED" &&
      run.completedAt !== null
  );
  const activeBaseline = scanRuns.find(
    (run) => run.type === "BASELINE" && ["PENDING", "RUNNING"].includes(run.status)
  );

  if (activeBaseline) {
    return { nextScanAt: null, nextScanStatus: "BASELINE_RUNNING" };
  }

  const activeScan = scanRuns.find(
    (run) => run.type === "SCAN" && ["PENDING", "RUNNING"].includes(run.status)
  );

  if (activeScan) {
    if (activeScan.status === "RUNNING" || activeScan.startedAt) {
      return { nextScanAt: null, nextScanStatus: "RUNNING" };
    }

    try {
      const job = await scanQueue.getJob(`scan-${activeScan.id}`);
      const state = job ? await job.getState() : null;

      if (state === "delayed") {
        return {
          nextScanAt: new Date(
            activeScan.createdAt.getTime() + intervalMinutes * 60 * 1000
          ).toISOString(),
          nextScanStatus: "SCHEDULED",
        };
      }

      if (state === "waiting" || state === "active" || state === "prioritized") {
        return { nextScanAt: null, nextScanStatus: "RUNNING" };
      }
    } catch (error) {
      console.warn(`[websites] Failed to inspect queued scan ${activeScan.id}:`, error);
    }

    if (latestCompletedRun?.completedAt) {
      return {
        nextScanAt: new Date(
          latestCompletedRun.completedAt.getTime() + intervalMinutes * 60 * 1000
        ).toISOString(),
        nextScanStatus: "SCHEDULED",
      };
    }

    return { nextScanAt: null, nextScanStatus: "RUNNING" };
  }

  if (!(scanConfig?.enabled ?? true)) {
    return { nextScanAt: null, nextScanStatus: "PAUSED" };
  }

  if (!latestCompletedRun?.completedAt) {
    return { nextScanAt: null, nextScanStatus: "UNAVAILABLE" };
  }

  return {
    nextScanAt: new Date(
      latestCompletedRun.completedAt.getTime() + intervalMinutes * 60 * 1000
    ).toISOString(),
    nextScanStatus: "SCHEDULED",
  };
}

router.get("/", async (_req: Request, res: Response) => {
  const websites = await prisma.website.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      pages: { select: { id: true } },
      scanConfig: true,
      scanRuns: {
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          type: true,
          createdAt: true,
          completedAt: true,
          startedAt: true,
        },
      },
    },
  });

  const payload = await Promise.all(
    websites.map(async (w) => ({
      ...w,
      pageCount: w.pages.length,
      lastScan: w.scanRuns[0] ?? null,
      ...(await getNextScanSummary(w.id, w.scanConfig, w.scanRuns)),
      pages: undefined,
      scanRuns: undefined,
    }))
  );

  res.json(payload);
});

router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const website = await prisma.website.findUnique({
    where: { id },
    include: {
      pages: {
        orderBy: { createdAt: "asc" },
        include: {
          baselineImages: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: { id: true, url: true, createdAt: true },
          },
        },
      },
      scanConfig: true,
      scanRuns: {
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          pageResults: {
            select: { id: true, status: true, hasChanges: true, diffScore: true, pageId: true },
          },
        },
      },
    },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  res.json({
    ...website,
    ...(await getNextScanSummary(website.id, website.scanConfig, website.scanRuns)),
  });
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const parsed = createWebsiteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { name, url, homepageOnly } = parsed.data;
  const normalizedUrl = url.replace(/\/$/, "");

  const existing = await prisma.website.findFirst({ where: { url: normalizedUrl } });
  if (existing) {
    res.status(409).json({ error: "Website with this URL already exists" });
    return;
  }

  const website = await prisma.website.create({
    data: {
      name,
      url: normalizedUrl,
      scanConfig: {
        create: {
          intervalMinutes: 20,
          threshold: parseFloat(process.env.DIFF_THRESHOLD ?? "0.3"),
        },
      },
    },
    include: { scanConfig: true, pages: true },
  });

  try {
    const synced = await syncWebsitePages(website.id, normalizedUrl, homepageOnly);

    res.status(201).json({
      ...website,
      pages: synced.pages,
    });
  } catch (error) {
    await prisma.website.delete({ where: { id: website.id } });
    res.status(422).json({
      error: error instanceof Error ? error.message : "Failed to crawl website pages",
    });
  }
});

router.put("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const parsed = updateWebsiteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const website = await prisma.website.findUnique({ where: { id } });
  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const normalizedUpdate = parsed.data.url
    ? { ...parsed.data, url: parsed.data.url.replace(/\/$/, "") }
    : parsed.data;

  const updated = await prisma.website.update({
    where: { id },
    data: normalizedUpdate,
    include: { scanConfig: true, pages: true },
  });

  try {
    const synced =
      parsed.data.url || updated.pages.length === 0
        ? await syncWebsitePages(updated.id, updated.url)
        : { pages: updated.pages, discovered: updated.pages.length };

    res.json({
      ...updated,
      pages: synced.pages,
    });
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "Failed to crawl website pages",
    });
  }
});

router.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const website = await prisma.website.findUnique({ where: { id } });
  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  await prisma.website.delete({ where: { id } });
  res.status(204).send();
});

router.post("/:id/pause", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const website = await prisma.website.findUnique({
    where: { id },
    include: { scanConfig: true },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const removedPendingRuns = await cancelPendingWebsiteRuns(id);
  const config = await prisma.scanConfig.upsert({
    where: { websiteId: id },
    update: { enabled: false },
    create: { websiteId: id, enabled: false },
  });

  res.json({
    config,
    removedPendingRuns,
    message:
      removedPendingRuns > 0
        ? `Scanning paused and ${removedPendingRuns} queued run(s) were removed.`
        : "Scanning paused for this website.",
  });
});

router.post("/:id/resume", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const website = await prisma.website.findUnique({
    where: { id },
    include: { scanConfig: true },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const config = await prisma.scanConfig.upsert({
    where: { websiteId: id },
    update: { enabled: true },
    create: { websiteId: id, enabled: true },
  });

  let scheduledScanRunId: string | null = null;
  try {
    scheduledScanRunId = await scheduleResumeScanIfNeeded(id, config);
  } catch (error) {
    console.warn(`[websites] Failed to schedule resumed scan for website ${id}:`, error);
  }

  res.json({
    config,
    scheduledScanRunId,
    message: scheduledScanRunId
      ? "Scanning resumed and the next scan was scheduled."
      : "Scanning resumed for this website.",
  });
});

router.put("/:id/config", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const schema = z.object({
    intervalMinutes: z.number().int().min(1).max(10080).optional(),
    threshold: z.number().min(0).max(1).optional(),
    viewportWidth: z.number().int().min(320).max(3840).optional(),
    viewportHeight: z.number().int().min(240).max(2160).optional(),
    enabled: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const config = await prisma.scanConfig.upsert({
    where: { websiteId: id },
    update: parsed.data,
    create: { websiteId: id, ...parsed.data },
  });

  res.json(config);
});

export default router;
