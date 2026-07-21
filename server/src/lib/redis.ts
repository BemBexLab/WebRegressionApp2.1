import { Redis } from "ioredis";

const TRANSIENT_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNREFUSED", "ETIMEDOUT"]);

const baseRedisConfig = {
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

const sharedRedisConfig = {
  ...baseRedisConfig,
  autoResendUnfulfilledCommands: false,
};

export const redis = new Redis(sharedRedisConfig);

redis.on("error", (err: NodeJS.ErrnoException) => {
  if (!TRANSIENT_CODES.has(err.code ?? "")) {
    console.error("[redis] connection error:", err.message);
  }
});

redis.on("connect", () => {
  console.log("[redis] connected");
});

redis.on("ready", () => {
  console.log("[redis] ready");
});

export async function withRedisTimeout<T>(
  operation: Promise<T>,
  timeoutMs = 3000
): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      const timeout = setTimeout(() => {
        clearTimeout(timeout);
        reject(new Error(`Redis operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

export const redisConnection = {
  host: baseRedisConfig.host,
  port: baseRedisConfig.port,
  password: baseRedisConfig.password,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: baseRedisConfig.keepAlive,
  connectTimeout: baseRedisConfig.connectTimeout,
  maxLoadingRetryTime: baseRedisConfig.maxLoadingRetryTime,
  family: baseRedisConfig.family,
  retryStrategy: baseRedisConfig.retryStrategy,
};

export async function probeRedis(): Promise<boolean> {
  const client = new Redis({
    ...baseRedisConfig,
    lazyConnect: true,
  });

  try {
    client.on("error", () => {
      // Health probes use short-lived clients; suppress transient socket noise here.
    });
    await client.connect();
    return (await withRedisTimeout(client.ping(), 3000)) === "PONG";
  } finally {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }
}
