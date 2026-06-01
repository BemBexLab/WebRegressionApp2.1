import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { baselineQueue, scanQueue } from "../queues/index";
import { scanLimiter } from "../middleware/rateLimiter";
import { syncWebsitePages } from "../lib/siteDiscovery";

const router = Router({ mergeParams: true });

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

router.post("/baseline", scanLimiter, async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, url: true },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const running = await prisma.scanRun.findFirst({
    where: { websiteId, status: { in: ["PENDING", "RUNNING"] } },
  });

  if (running) {
    res.status(409).json({ error: "A scan is already running for this website" });
    return;
  }

  let synced;
  try {
    synced = await syncWebsitePages(websiteId, website.url);
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

  await baselineQueue.add(
    "baseline",
    { websiteId, scanRunId: scanRun.id },
    { jobId: `baseline-${scanRun.id}` }
  );

  res.status(202).json({
    scanRunId: scanRun.id,
    message: `Baseline job queued for ${synced.pages.length} page(s)`,
  });
});

router.post("/scan", scanLimiter, async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, url: true },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const running = await prisma.scanRun.findFirst({
    where: { websiteId, status: { in: ["PENDING", "RUNNING"] } },
  });

  if (running) {
    res.status(409).json({ error: "A scan is already running for this website" });
    return;
  }

  let synced;
  try {
    synced = await syncWebsitePages(websiteId, website.url);
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

  await scanQueue.add(
    "scan",
    { websiteId, scanRunId: scanRun.id },
    { jobId: `scan-${scanRun.id}` }
  );

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

export default router;
