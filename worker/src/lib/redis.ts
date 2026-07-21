export const redisConnection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 10000,
  connectTimeout: 5000,
  maxLoadingRetryTime: 2000,
  family: 4 as const,
  retryStrategy: (times: number) => Math.min(times * 300, 5000),
};
