import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { baselineQueue, scanQueue, emailQueue } from "../queues/index";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const [
    websiteCount,
    pageCount,
    totalScans,
    successfulScans,
    failedScans,
    scansWithChanges,
    recentRuns,
    baselineWaiting,
    scanWaiting,
  ] = await Promise.all([
    prisma.website.count(),
    prisma.websitePage.count(),
    prisma.scanRun.count({ where: { type: "SCAN" } }),
    prisma.scanRun.count({ where: { type: "SCAN", status: "COMPLETED" } }),
    prisma.scanRun.count({ where: { type: "SCAN", status: "FAILED" } }),
    prisma.scanPageResult.count({ where: { hasChanges: true } }),
    prisma.scanRun.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        website: { select: { id: true, name: true } },
        pageResults: { select: { hasChanges: true, status: true } },
      },
    }),
    baselineQueue.getWaitingCount(),
    scanQueue.getWaitingCount(),
  ]);

  res.json({
    websites: websiteCount,
    pages: pageCount,
    scans: {
      total: totalScans,
      successful: successfulScans,
      failed: failedScans,
      changesDetected: scansWithChanges,
    },
    queues: {
      baseline: { waiting: baselineWaiting },
      scan: { waiting: scanWaiting },
    },
    recentActivity: recentRuns.map((r) => ({
      id: r.id,
      websiteId: r.websiteId,
      websiteName: r.website.name,
      type: r.type,
      status: r.status,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      hasChanges: r.pageResults.some((p) => p.hasChanges),
      pageCount: r.pageResults.length,
    })),
  });
});

export default router;
