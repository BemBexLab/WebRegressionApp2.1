import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { baselineQueue, scanQueue } from "../queues/index";
import { scanLimiter } from "../middleware/rateLimiter";
import { syncWebsitePages } from "../lib/siteDiscovery";
import { createScanPdfBuffer, ScanReportPage } from "../lib/scanReport";

const router = Router({ mergeParams: true });

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

async function activatePendingScanRun(
  websiteId: string,
  scanRunId: string
): Promise<boolean> {
  try {
    const jobId = `scan-${scanRunId}`;
    const existingJob = await scanQueue.getJob(jobId);

    if (!existingJob) {
      await scanQueue.add("scan", { websiteId, scanRunId }, { jobId });
      return true;
    }

    const state = await existingJob.getState();
    if (state === "delayed") {
      await existingJob.promote();
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function getExistingOrSyncedPages(
  websiteId: string,
  websiteUrl: string
): Promise<{ pages: Array<{ id: string; url: string; name: string | null }>; discovered: number }> {
  const existingPages = await prisma.websitePage.findMany({
    where: { websiteId },
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, name: true },
  });

  if (existingPages.length > 0) {
    return {
      pages: existingPages,
      discovered: existingPages.length,
    };
  }

  return syncWebsitePages(websiteId, websiteUrl);
}

router.post("/baseline", scanLimiter, async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, url: true, scanConfig: { select: { enabled: true } } },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  if (!(website.scanConfig?.enabled ?? true)) {
    res.status(409).json({ error: "Scanning is paused for this website. Resume it first." });
    return;
  }

  const running = await prisma.scanRun.findFirst({
    where: { websiteId, status: { in: ["PENDING", "RUNNING"] } },
  });

  if (running) {
    if (
      running.type === "SCAN" &&
      running.status === "PENDING" &&
      running.startedAt === null
    ) {
      const activated = await activatePendingScanRun(websiteId, running.id);
      if (activated) {
        res.status(202).json({
          scanRunId: running.id,
          message: "Scheduled scan activated and will run now",
        });
        return;
      }
    }

    res.status(409).json({ error: "A scan is already running for this website" });
    return;
  }

  let synced;
  try {
    synced = await getExistingOrSyncedPages(websiteId, website.url);
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "Failed to crawl website pages",
    });
    return;
  }

  if (synced.pages.length === 0) {
    res.status(422).json({ error: "No crawlable pages were found for this website" });
    return;
  }

  const scanRun = await prisma.scanRun.create({
    data: {
      websiteId,
      type: "BASELINE",
      status: "PENDING",
      pageResults: {
        create: synced.pages.map((p) => ({
          pageId: p.id,
          status: "PENDING",
        })),
      },
    },
    include: { pageResults: true },
  });

  try {
    await baselineQueue.add(
      "baseline",
      { websiteId, scanRunId: scanRun.id },
      { jobId: `baseline-${scanRun.id}` }
    );
  } catch (err) {
    await prisma.scanRun.delete({ where: { id: scanRun.id } });
    res.status(503).json({ error: "Queue temporarily unavailable. Please try again." });
    return;
  }

  res.status(202).json({
    scanRunId: scanRun.id,
    message: `Baseline job queued for ${synced.pages.length} page(s)`,
  });
});

router.post("/scan", scanLimiter, async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, url: true, scanConfig: { select: { enabled: true } } },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  if (!(website.scanConfig?.enabled ?? true)) {
    res.status(409).json({ error: "Scanning is paused for this website. Resume it first." });
    return;
  }

  const running = await prisma.scanRun.findFirst({
    where: { websiteId, status: { in: ["PENDING", "RUNNING"] } },
  });

  if (running) {
    if (
      running.type === "SCAN" &&
      running.status === "PENDING" &&
      running.startedAt === null
    ) {
      const activated = await activatePendingScanRun(websiteId, running.id);
      if (activated) {
        res.status(202).json({
          scanRunId: running.id,
          message: "Scheduled scan activated and will run now",
        });
        return;
      }
    }

    res.status(409).json({ error: "A scan is already running for this website" });
    return;
  }

  let synced;
  try {
    synced = await getExistingOrSyncedPages(websiteId, website.url);
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "Failed to crawl website pages",
    });
    return;
  }

  if (synced.pages.length === 0) {
    res.status(422).json({ error: "No crawlable pages were found for this website" });
    return;
  }

  const pagesWithBaseline = await prisma.websitePage.findMany({
    where: {
      websiteId,
      id: { in: synced.pages.map((page) => page.id) },
    },
    select: {
      id: true,
      baselineImages: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true } },
    },
  });

  if (!pagesWithBaseline.some((page) => page.baselineImages.length > 0)) {
    res.status(422).json({ error: "No baseline exists. Create a baseline first." });
    return;
  }

  const scanRun = await prisma.scanRun.create({
    data: {
      websiteId,
      type: "SCAN",
      status: "PENDING",
      pageResults: {
        create: synced.pages.map((p) => ({
          pageId: p.id,
          status: "PENDING",
        })),
      },
    },
    include: { pageResults: true },
  });

  try {
    await scanQueue.add(
      "scan",
      { websiteId, scanRunId: scanRun.id },
      { jobId: `scan-${scanRun.id}` }
    );
  } catch (err) {
    await prisma.scanRun.delete({ where: { id: scanRun.id } });
    res.status(503).json({ error: "Queue temporarily unavailable. Please try again." });
    return;
  }

  res.status(202).json({
    scanRunId: scanRun.id,
    message: `Scan job queued for ${synced.pages.length} page(s)`,
  });
});

router.get("/", async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);
  const page = parseInt((req.query.page as string) ?? "1", 10);
  const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 100);
  const skip = (page - 1) * limit;

  const [total, runs] = await Promise.all([
    prisma.scanRun.count({ where: { websiteId } }),
    prisma.scanRun.findMany({
      where: { websiteId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        pageResults: {
          select: { id: true, status: true, hasChanges: true, diffScore: true, pageId: true },
        },
      },
    }),
  ]);

  res.json({ total, page, limit, runs });
});

router.get("/:scanId", async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);
  const scanId = param(req.params.scanId);

  const scanRun = await prisma.scanRun.findFirst({
    where: { id: scanId, websiteId },
    include: {
      pageResults: {
        include: { page: { select: { id: true, name: true, url: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!scanRun) {
    res.status(404).json({ error: "Scan run not found" });
    return;
  }

  res.json(scanRun);
});

router.get("/:scanId/export", async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);
  const scanId = param(req.params.scanId);

  const scanRun = await prisma.scanRun.findFirst({
    where: { id: scanId, websiteId },
    include: {
      website: {
        select: {
          name: true,
          url: true,
          scanConfig: { select: { threshold: true } },
        },
      },
      pageResults: {
        include: { page: { select: { id: true, name: true, url: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!scanRun) {
    res.status(404).json({ error: "Scan run not found" });
    return;
  }

  if (scanRun.type === "BASELINE") {
    res.status(400).json({ error: "Baseline scans cannot be exported" });
    return;
  }

  const allPages: ScanReportPage[] = scanRun.pageResults.map((result) => ({
    name: result.page.name ?? result.page.url,
    url: result.page.url,
    status: result.status,
    hasChanges: result.hasChanges,
    diffScore: result.diffScore ?? 0,
    diffPixels: result.diffPixels ?? 0,
    diffUrl: result.diffUrl,
    screenshotUrl: result.screenshotUrl,
    baselineUrl: result.baselineUrl,
    note: result.error,
  }));

  const changedPages = allPages.filter((page) => page.hasChanges);
  const failedPages = allPages.filter((page) => page.status === "FAILED");
  const pdfBuffer = await createScanPdfBuffer({
    websiteName: scanRun.website.name,
    websiteUrl: scanRun.website.url,
    scanRunId: scanRun.id,
    threshold: scanRun.website.scanConfig?.threshold ?? 0.3,
    changedPages,
    failedPages,
    allPages,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="scan-report-${scanRun.id}.pdf"`
  );
  res.send(pdfBuffer);
});

export default router;
