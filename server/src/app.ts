import express from "express";
import cors from "cors";
import helmet from "helmet";
import { globalLimiter } from "./middleware/rateLimiter";
import { adminAuth } from "./middleware/auth";
import apiRoutes from "./routes/index";

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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
