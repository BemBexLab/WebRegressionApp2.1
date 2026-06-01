import { Queue } from "bullmq";
import { redisConnection } from "../lib/redis";

export const baselineQueue = new Queue("baseline", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

export const scanQueue = new Queue("scan", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

export const emailQueue = new Queue("email", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "fixed", delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export type BaselineJobData = {
  websiteId: string;
  scanRunId: string;
};

export type ScanJobData = {
  websiteId: string;
  scanRunId: string;
};

export type EmailJobData = {
  type: "SCAN_COMPLETE" | "VISUAL_CHANGE" | "FAILURE";
  websiteId: string;
  scanRunId: string;
  recipient: string;
  websiteName: string;
  changedPages?: number;
  totalPages?: number;
  error?: string;
};
