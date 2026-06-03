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

const SCAN_CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY ?? "2", 10);
const BASELINE_CONCURRENCY = parseInt(process.env.BASELINE_CONCURRENCY ?? "1", 10);
const BULLMQ_LOCK_DURATION_MS = parseInt(process.env.BULLMQ_LOCK_DURATION_MS ?? "300000", 10);
const BULLMQ_STALLED_INTERVAL_MS = parseInt(
  process.env.BULLMQ_STALLED_INTERVAL_MS ?? "60000",
  10
);
const prisma = new PrismaClient();

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

ensureBucket().catch((err) => {
  console.error("Failed to initialise storage bucket:", err);
  process.exit(1);
});

const scanQueue = new Queue("scan", { connection: redisConnection });
const emailQueue = new Queue("email", { connection: redisConnection });

const baselineWorker = new Worker(
  "baseline",
  async (job) => {
    console.log(`[baseline] Processing job ${job.id}`);
    await processBaseline(job, scanQueue);
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

reconcileAutoScans(scanQueue).catch((err) => {
  console.error("Failed to reconcile auto-scan schedule:", err);
});

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    baselineWorker.close(),
    scanWorker.close(),
    emailWorker.close(),
  ]);
  await prisma.$disconnect();
  await closeBrowser();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
