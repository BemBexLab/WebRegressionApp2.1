import { Job, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { takeScreenshot } from "../lib/browser";
import { compareScreenshots } from "../lib/compare";
import { uploadImage, downloadImage, buildStorageKey } from "../lib/storage";
import { getAutoScanIntervalMinutes, scheduleNextScan } from "../lib/autoScan";
import { pruneOldScans } from "../lib/pruneScans";
import { EmailJobData } from "./email";

const prisma = new PrismaClient();

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

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

export interface ScanJobData {
  websiteId: string;
  scanRunId: string;
}

type ScanQueues = {
  emailQueue: Queue;
  scanQueue: Queue;
};

export async function processScan(
  job: Job<ScanJobData>,
  { emailQueue, scanQueue }: ScanQueues
): Promise<void> {
  const { websiteId, scanRunId } = job.data;

  const started = await updateScanRunIfPresent(scanRunId, {
    status: "RUNNING",
    startedAt: new Date(),
  });

  if (!started) {
    console.warn(`[scan] ScanRun ${scanRunId} no longer exists; skipping job ${job.id}`);
    return;
  }

  const scanRun = await prisma.scanRun.findUnique({
    where: { id: scanRunId },
    include: {
      website: { include: { scanConfig: true } },
      pageResults: {
        include: {
          page: {
            include: {
              baselineImages: { take: 1, orderBy: { createdAt: "desc" } },
            },
          },
        },
      },
    },
  });

  if (!scanRun) {
    console.warn(`[scan] ScanRun ${scanRunId} disappeared before processing; skipping`);
    return;
  }

  const config = scanRun.website.scanConfig;
  const intervalMinutes =
    typeof (config as { intervalMinutes?: unknown } | null)?.intervalMinutes === "number"
      ? ((config as { intervalMinutes?: number }).intervalMinutes ?? null)
      : null;
  const threshold = config?.threshold ?? 0.3;
  const viewportWidth = config?.viewportWidth ?? 1280;
  const viewportHeight = config?.viewportHeight ?? 720;

  let hasError = false;
  let changedPages = 0;
  let maxDiffScore = 0;

  for (let i = 0; i < scanRun.pageResults.length; i++) {
    const result = scanRun.pageResults[i];
    const page = result.page;
    const baseline = page.baselineImages[0];

    await job.updateProgress(Math.round((i / scanRun.pageResults.length) * 100));

    try {
      const pageMarkedRunning = await updatePageResultIfPresent(result.id, { status: "RUNNING" });

      if (!pageMarkedRunning) {
        console.warn(
          `[scan] Page result ${result.id} no longer exists for scan ${scanRunId}; skipping page ${page.url}`
        );
        continue;
      }

      const capture = await takeScreenshot({
        url: page.url,
        viewportWidth,
        viewportHeight,
      });
      await yieldToEventLoop();

      const screenshotKey = buildStorageKey(websiteId, page.id, "screenshot", scanRunId);
      const screenshotUrl = await uploadImage(screenshotKey, capture.displayBuffer);
      await yieldToEventLoop();

      let diffScore = 0;
      let diffPixels = 0;
      let hasChanges = false;
      let diffKey: string | undefined;
      let diffUrl: string | undefined;
      let baselineUrl: string | undefined;
      let baselineKey: string | undefined;
      let pageError: string | undefined;

      if (baseline) {
        const baselineBuffer = await downloadImage(baseline.storageKey);
        baselineKey = baseline.storageKey;
        baselineUrl = baseline.url;

        const comparison = await compareScreenshots(
          baselineBuffer,
          capture.compareBuffer,
          threshold
        );
        await yieldToEventLoop();
        diffScore = comparison.diffScore;
        maxDiffScore = Math.max(maxDiffScore, diffScore);
        diffPixels = comparison.diffPixels;
        hasChanges = comparison.hasChanges;

        if (hasChanges) {
          diffKey = buildStorageKey(websiteId, page.id, "diff", scanRunId);
          diffUrl = await uploadImage(diffKey, comparison.diffImageBuffer);
          await yieldToEventLoop();
          changedPages++;
        }
      } else {
        baselineKey = buildStorageKey(websiteId, page.id, "baseline");
        baselineUrl = await uploadImage(baselineKey, capture.compareBuffer);
        await prisma.baselineImage.deleteMany({ where: { pageId: page.id } });
        await prisma.baselineImage.create({
          data: {
            pageId: page.id,
            storageKey: baselineKey,
            url: baselineUrl,
            width: viewportWidth,
            height: viewportHeight,
          },
        });
        hasChanges = true;
        changedPages++;
        pageError = "New page discovered during scan. Baseline created automatically.";
        await yieldToEventLoop();
      }

      await prisma.scanPageResult.updateMany({
        where: { id: result.id },
        data: {
          status: "COMPLETED",
          screenshotKey,
          screenshotUrl,
          baselineKey,
          baselineUrl,
          diffKey,
          diffUrl,
          diffScore,
          diffPixels,
          hasChanges,
          error: pageError,
        },
      });
      await yieldToEventLoop();
    } catch (err) {
      hasError = true;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Scan failed for page ${page.url}:`, errorMsg);

      const pageMarkedFailed = await updatePageResultIfPresent(result.id, {
        status: "FAILED",
        error: errorMsg,
      });

      if (!pageMarkedFailed) {
        console.warn(
          `[scan] Page result ${result.id} was removed before failure status could be saved`
        );
      }
    }
  }

  const finalStatus = hasError ? "FAILED" : "COMPLETED";
  const finalised = await updateScanRunIfPresent(scanRunId, {
    status: finalStatus,
    completedAt: new Date(),
  });

  if (!finalised) {
    console.warn(`[scan] ScanRun ${scanRunId} was removed before completion could be saved`);
    return;
  }

  await job.updateProgress(100);

  const thresholdExceeded = maxDiffScore > threshold || changedPages > 0;
  console.log(
    `[scan] Alert decision for ${scanRun.website.name}: max diff ${(maxDiffScore * 100).toFixed(
      2
    )}%, threshold ${(threshold * 100).toFixed(2)}%, changed pages ${changedPages}, has error ${hasError}`
  );

  if (thresholdExceeded || hasError) {
    const emailData: EmailJobData = {
      type: thresholdExceeded ? "VISUAL_CHANGE" : "FAILURE",
      websiteId,
      scanRunId,
      recipient: "zoho-cliq",
      websiteName: scanRun.website.name,
      changedPages,
      totalPages: scanRun.pageResults.length,
      diffThreshold: threshold,
      maxDiffScore,
      error: hasError ? "One or more pages failed during the scan run." : undefined,
    };

    await emailQueue.add("email", emailData);
  }

  if (scanRun.website.scanConfig?.enabled ?? true) {
    const nextIntervalMinutes = getAutoScanIntervalMinutes(intervalMinutes);
    await scheduleNextScan(websiteId, nextIntervalMinutes, scanQueue);
  }

  try {
    await pruneOldScans(prisma, websiteId);
  } catch (err) {
    console.error(`[scan] Failed to prune old scans for website ${websiteId}:`, err);
  }
}
