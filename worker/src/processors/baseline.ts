import { Job, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { takeScreenshot } from "../lib/browser";
import { uploadImage, buildStorageKey } from "../lib/storage";
import { getAutoScanIntervalMinutes, scheduleNextScan } from "../lib/autoScan";

const prisma = new PrismaClient();

async function updateScanRunIfPresent(
  scanRunId: string,
  data: Parameters<typeof prisma.scanRun.updateMany>[0]["data"]
): Promise<boolean> {
  const result = await prisma.scanRun.updateMany({
    where: { id: scanRunId },
    data,
  });

  return result.count > 0;
}

async function updatePageResultIfPresent(
  pageResultId: string,
  data: Parameters<typeof prisma.scanPageResult.updateMany>[0]["data"]
): Promise<boolean> {
  const result = await prisma.scanPageResult.updateMany({
    where: { id: pageResultId },
    data,
  });

  return result.count > 0;
}

export interface BaselineJobData {
  websiteId: string;
  scanRunId: string;
}

export async function processBaseline(
  job: Job<BaselineJobData>,
  scanQueue?: Queue
): Promise<void> {
  const { websiteId, scanRunId } = job.data;

  const started = await updateScanRunIfPresent(scanRunId, {
    status: "RUNNING",
    startedAt: new Date(),
  });

  if (!started) {
    console.warn(`[baseline] ScanRun ${scanRunId} no longer exists; skipping job ${job.id}`);
    return;
  }

  const scanRun = await prisma.scanRun.findUnique({
    where: { id: scanRunId },
    include: {
      website: { include: { scanConfig: true } },
      pageResults: { include: { page: true } },
    },
  });

  if (!scanRun) {
    console.warn(`[baseline] ScanRun ${scanRunId} disappeared before processing; skipping`);
    return;
  }

  const config = scanRun.website.scanConfig;
  const intervalMinutes =
    typeof (config as { intervalMinutes?: unknown } | null)?.intervalMinutes === "number"
      ? ((config as { intervalMinutes?: number }).intervalMinutes ?? null)
      : null;
  const viewportWidth = config?.viewportWidth ?? 1280;
  const viewportHeight = config?.viewportHeight ?? 720;

  let hasError = false;

  for (let i = 0; i < scanRun.pageResults.length; i++) {
    const result = scanRun.pageResults[i];
    const page = result.page;

    await job.updateProgress(Math.round((i / scanRun.pageResults.length) * 100));
    console.log(
      `[baseline] Scan ${scanRunId} page ${i + 1}/${scanRun.pageResults.length}: ${page.url}`
    );

    try {
      const pageMarkedRunning = await updatePageResultIfPresent(result.id, { status: "RUNNING" });

      if (!pageMarkedRunning) {
        console.warn(
          `[baseline] Page result ${result.id} no longer exists for scan ${scanRunId}; skipping page ${page.url}`
        );
        continue;
      }

      const capture = await takeScreenshot({
        url: page.url,
        viewportWidth,
        viewportHeight,
        stabilizeComparison: false,
      });

      const storageKey = buildStorageKey(websiteId, page.id, "baseline");
      const url = await uploadImage(storageKey, capture.compareBuffer);
      const screenshotKey = buildStorageKey(websiteId, page.id, "screenshot", scanRunId);
      const screenshotUrl = await uploadImage(screenshotKey, capture.displayBuffer);

      await prisma.$transaction([
        prisma.baselineImage.deleteMany({ where: { pageId: page.id } }),
        prisma.baselineImage.create({
          data: {
            pageId: page.id,
            storageKey,
            url,
            width: viewportWidth,
            height: viewportHeight,
          },
        }),
        prisma.scanPageResult.updateMany({
          where: { id: result.id },
          data: {
            status: "COMPLETED",
            screenshotKey,
            screenshotUrl,
            baselineKey: storageKey,
            baselineUrl: url,
          },
        }),
      ]);

      console.log(`[baseline] Scan ${scanRunId} saved baseline for ${page.url}`);
    } catch (err) {
      hasError = true;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Baseline failed for page ${page.url}:`, errorMsg);

      const pageMarkedFailed = await updatePageResultIfPresent(result.id, {
        status: "FAILED",
        error: errorMsg,
      });

      if (!pageMarkedFailed) {
        console.warn(
          `[baseline] Page result ${result.id} was removed before failure status could be saved`
        );
      }
    }
  }

  const finalised = await updateScanRunIfPresent(scanRunId, {
    status: hasError ? "FAILED" : "COMPLETED",
    completedAt: new Date(),
  });

  if (!finalised) {
    console.warn(`[baseline] ScanRun ${scanRunId} was removed before completion could be saved`);
    return;
  }

  await job.updateProgress(100);

  if (!hasError && scanQueue && (scanRun.website.scanConfig?.enabled ?? true)) {
    const nextIntervalMinutes = getAutoScanIntervalMinutes(intervalMinutes);
    await scheduleNextScan(websiteId, nextIntervalMinutes, scanQueue);
  }
}
