import { Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export function getAutoScanIntervalMinutes(intervalMinutes?: number | null): number {
  const envValue = parseInt(process.env.AUTO_SCAN_INTERVAL_MINUTES ?? "", 10);

  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }

  if (typeof intervalMinutes === "number" && intervalMinutes > 0) {
    return intervalMinutes;
  }

  return 20;
}

export async function scheduleNextScan(
  websiteId: string,
  intervalMinutes: number,
  scanQueue: Queue,
  delayMs?: number
): Promise<string | null> {
  const existingQueuedRun = await prisma.scanRun.findFirst({
    where: {
      websiteId,
      type: "SCAN",
      status: "PENDING",
    },
    select: { id: true },
  });

  if (existingQueuedRun) {
    console.log(
      `[auto-scan] Next scan already queued for website ${websiteId} as run ${existingQueuedRun.id}`
    );
    return existingQueuedRun.id;
  }

  const pages = await prisma.websitePage.findMany({
    where: { websiteId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (pages.length === 0) {
    console.warn(`[auto-scan] No pages found for website ${websiteId}; skipping auto re-scan`);
    return null;
  }

  const nextRun = await prisma.scanRun.create({
    data: {
      websiteId,
      type: "SCAN",
      status: "PENDING",
      pageResults: {
        create: pages.map((page) => ({
          pageId: page.id,
          status: "PENDING",
        })),
      },
    },
    select: { id: true },
  });

  await scanQueue.add(
    "scan",
    { websiteId, scanRunId: nextRun.id },
    {
      jobId: `scan-${nextRun.id}`,
      delay: delayMs ?? intervalMinutes * 60 * 1000,
    }
  );

  console.log(
    `[auto-scan] Scheduled next scan ${nextRun.id} for website ${websiteId} in ${Math.round(
      (delayMs ?? intervalMinutes * 60 * 1000) / 60000
    )} minute(s)`
  );

  return nextRun.id;
}

export async function reconcileAutoScans(scanQueue: Queue): Promise<void> {
  const websites = await prisma.website.findMany({
    include: {
      scanConfig: true,
      pages: {
        select: {
          baselineImages: {
            take: 1,
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
          completedAt: true,
          createdAt: true,
        },
      },
    },
  });

  const now = Date.now();

  for (const website of websites) {
    if (!(website.scanConfig?.enabled ?? true)) continue;

    const configuredIntervalMinutes =
      typeof (website.scanConfig as { intervalMinutes?: unknown } | null)?.intervalMinutes ===
      "number"
        ? ((website.scanConfig as { intervalMinutes?: number }).intervalMinutes ?? null)
        : null;

    const hasBaseline = website.pages.some((page) => page.baselineImages.length > 0);
    if (!hasBaseline) continue;

    const activeScan = website.scanRuns.find(
      (run) => run.type === "SCAN" && ["PENDING", "RUNNING"].includes(run.status)
    );

    if (activeScan) continue;

    const latestCompletedRun = website.scanRuns.find(
      (run) =>
        ["BASELINE", "SCAN"].includes(run.type) &&
        run.status === "COMPLETED" &&
        run.completedAt !== null
    );

    if (!latestCompletedRun?.completedAt) continue;

    const intervalMinutes = getAutoScanIntervalMinutes(configuredIntervalMinutes);
    const nextRunAt = latestCompletedRun.completedAt.getTime() + intervalMinutes * 60 * 1000;
    const delayMs = Math.max(0, nextRunAt - now);

    await scheduleNextScan(website.id, intervalMinutes, scanQueue, delayMs);
  }
}
