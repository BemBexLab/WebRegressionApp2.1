import "dotenv/config";
import { Worker, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { redisConnection } from "./lib/redis";
import { processBaseline } from "./processors/baseline";
import { processScan } from "./processors/scan";
import { processEmail } from "./processors/email";
import { closeBrowser } from "./lib/browser";
import { ensureBucket } from "./lib/storage";
import { reconcileAutoScans } from "./lib/autoScan";
import { getDomainCheckIntervalMs, refreshAllWebsiteDomains } from "./lib/domainMonitor";
import {
  buildShutdownAlertText,
  buildStartupAlertText,
  getCliqWebhookUrl,
  postToCliq,
} from "./lib/cliq";

const SCAN_CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY ?? "1", 10);
const BASELINE_CONCURRENCY = parseInt(process.env.BASELINE_CONCURRENCY ?? "1", 10);
const BULLMQ_LOCK_DURATION_MS = parseInt(process.env.BULLMQ_LOCK_DURATION_MS ?? "900000", 10);
const BULLMQ_STALLED_INTERVAL_MS = parseInt(
  process.env.BULLMQ_STALLED_INTERVAL_MS ?? "120000",
  10
);
const prisma = new PrismaClient();
let isShuttingDown = false;
let shutdownAlertSent = false;
let domainMonitorTimer: NodeJS.Timeout | null = null;
let domainMonitorRunning = false;

function getScanRunId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const candidate = (data as { scanRunId?: unknown }).scanRunId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

async function markRunFailed(scanRunId: string, error: string): Promise<void> {
  await prisma.scanRun.updateMany({
    where: {
      id: scanRunId,
      status: { in: ["PENDING", "RUNNING"] },
    },
    data: {
      status: "FAILED",
      error,
      completedAt: new Date(),
    },
  });
}

const scanQueue = new Queue("scan", { connection: redisConnection });
const emailQueue = new Queue("email", { connection: redisConnection });

const baselineWorker = new Worker(
  "baseline",
  async (job) => {
    console.log(`[baseline] Processing job ${job.id}`);
    await processBaseline(job, { scanQueue, notificationQueue: emailQueue });
    console.log(`[baseline] Job ${job.id} completed`);
  },
  {
    connection: redisConnection,
    concurrency: Math.max(1, BASELINE_CONCURRENCY),
    lockDuration: BULLMQ_LOCK_DURATION_MS,
    stalledInterval: BULLMQ_STALLED_INTERVAL_MS,
  }
);

const scanWorker = new Worker(
  "scan",
  async (job) => {
    console.log(`[scan] Processing job ${job.id}`);
    await processScan(job, { emailQueue, scanQueue });
    console.log(`[scan] Job ${job.id} completed`);
  },
  {
    connection: redisConnection,
    concurrency: SCAN_CONCURRENCY,
    lockDuration: BULLMQ_LOCK_DURATION_MS,
    stalledInterval: BULLMQ_STALLED_INTERVAL_MS,
  }
);

const emailWorker = new Worker(
  "email",
  async (job) => {
    console.log(`[email] Processing job ${job.id}`);
    await processEmail(job);
    console.log(`[email] Job ${job.id} completed`);
  },
  {
    connection: redisConnection,
    concurrency: 5,
    lockDuration: BULLMQ_LOCK_DURATION_MS,
    stalledInterval: BULLMQ_STALLED_INTERVAL_MS,
  }
);

for (const worker of [baselineWorker, scanWorker, emailWorker]) {
  worker.on("stalled", (jobId) => {
    console.warn(`[${worker.name}] Job ${jobId} stalled`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[${worker.name}] Job ${job?.id} failed:`, err.message);

    // Email delivery failures should not poison the underlying scan run.
    if (worker.name === "email") return;

    const scanRunId = getScanRunId(job?.data);
    if (!scanRunId) return;

    markRunFailed(scanRunId, err.message).catch((updateErr) => {
      console.error(
        `[${worker.name}] Failed to mark scan run ${scanRunId} as FAILED:`,
        updateErr
      );
    });
  });
}

console.log(
  `Worker started — baseline concurrency: ${BASELINE_CONCURRENCY}, scan concurrency: ${SCAN_CONCURRENCY}, lock duration: ${BULLMQ_LOCK_DURATION_MS}ms`
);

async function sendStartupAlertOnce(): Promise<void> {
  const webhookUrl = getCliqWebhookUrl();
  if (!webhookUrl) return;
  await postToCliq(webhookUrl, buildStartupAlertText());
  console.log("Sent startup alert to Zoho Cliq");
}

async function sendShutdownAlertOnce(reason: string): Promise<void> {
  if (shutdownAlertSent) return;

  const webhookUrl = getCliqWebhookUrl();
  if (!webhookUrl) return;
  await postToCliq(webhookUrl, buildShutdownAlertText(reason));
  shutdownAlertSent = true;
  console.log("Sent shutdown alert to Zoho Cliq");
}

async function runStartupTasks(): Promise<void> {
  try {
    await ensureBucket();
  } catch (err) {
    console.error("Failed to initialise storage bucket:", err);
    process.exit(1);
  }

  try {
    await reconcileAutoScans(scanQueue);
  } catch (err) {
    console.error("Failed to reconcile auto-scan schedule:", err);
  }

  try {
    await sendStartupAlertOnce();
  } catch (err) {
    console.error("Failed to send startup alert to Zoho Cliq:", err);
  }

  try {
    await runDomainMonitorCycle();
  } catch (err) {
    console.error("Failed to refresh domain lifecycle data:", err);
  }
}

runStartupTasks().catch((err) => {
  console.error("Unexpected worker startup error:", err);
});

async function runDomainMonitorCycle(): Promise<void> {
  if (domainMonitorRunning) return;
  domainMonitorRunning = true;

  try {
    await refreshAllWebsiteDomains(prisma, emailQueue);
  } finally {
    domainMonitorRunning = false;
  }
}

function startDomainMonitor(): void {
  if (domainMonitorTimer) return;

  domainMonitorTimer = setInterval(() => {
    void runDomainMonitorCycle().catch((err) => {
      console.error("Scheduled domain lifecycle refresh failed:", err);
    });
  }, getDomainCheckIntervalMs());
}

startDomainMonitor();

async function shutdown(reason: string, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Shutting down workers (${reason})...`);

  try {
    await sendShutdownAlertOnce(reason);
  } catch (err) {
    console.error("Failed to send shutdown alert to Zoho Cliq:", err);
  }

  await Promise.all([
    baselineWorker.close(),
    scanWorker.close(),
    emailWorker.close(),
  ]);
  if (domainMonitorTimer) {
    clearInterval(domainMonitorTimer);
    domainMonitorTimer = null;
  }
  await prisma.$disconnect();
  await closeBrowser();
  process.exit(exitCode);
}

process.on("SIGTERM", () => {
  void shutdown("container stopped", 0);
});

process.on("SIGINT", () => {
  void shutdown("application closed", 0);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  void shutdown(`crash: ${error.message}`, 1);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error("Unhandled rejection:", reason);
  void shutdown(`unhandled rejection: ${message}`, 1);
});
