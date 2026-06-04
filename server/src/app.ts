import express from "express";
import cors from "cors";
import helmet from "helmet";
import { globalLimiter } from "./middleware/rateLimiter";
import { adminAuth } from "./middleware/auth";
import apiRoutes from "./routes/index";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
const allowedOrigins = (process.env.FRONTEND_URL ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes("*")) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const requested = new URL(origin);

    return allowedOrigins.some((allowedOrigin) => {
      try {
        const allowed = new URL(allowedOrigin);
        return (
          requested.protocol === allowed.protocol &&
          requested.hostname === allowed.hostname &&
          (!allowed.port || requested.port === allowed.port)
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || isAllowedOrigin(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(globalLimiter);

app.get("/health", async (_req, res) => {
  const checks = {
    database: false,
    redis: false,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (error) {
    console.error("Health check database probe failed:", error);
  }

  try {
    checks.redis = (await redis.ping()) === "PONG";
  } catch (error) {
    console.error("Health check redis probe failed:", error);
  }

  if (checks.database && checks.redis) {
    res.json({ status: "ok", timestamp: new Date().toISOString(), checks });
    return;
  }

  res.status(503).json({
    status: "degraded",
    timestamp: new Date().toISOString(),
    checks,
  });
});

app.use("/api", adminAuth, apiRoutes);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
);

export default app;
