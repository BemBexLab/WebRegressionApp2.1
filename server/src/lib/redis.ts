import { Redis } from "ioredis";

const redisConfig = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
};

export const redis = new Redis(redisConfig);

export const redisConnection = {
  host: redisConfig.host,
  port: redisConfig.port,
  password: redisConfig.password,
};
