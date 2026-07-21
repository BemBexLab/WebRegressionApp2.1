import "dotenv/config";
import app from "./app";
import { prisma } from "./lib/prisma";
import { probeRedis } from "./lib/redis";

const PORT = parseInt(process.env.PORT ?? "4000", 10);

async function main() {
  await prisma.$connect();
  console.log("PostgreSQL connected");

  app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
  });

  probeRedis()
    .then(() => {
      console.log("Redis connected");
    })
    .catch((err) => {
      console.error("Redis startup probe failed:", err);
    });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
