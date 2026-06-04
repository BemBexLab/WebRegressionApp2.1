import { PrismaClient } from "@prisma/client";
import { deleteImage } from "./storage";

const SCAN_RETENTION = 20;

export async function pruneOldScans(prisma: PrismaClient, websiteId: string): Promise<void> {
  const allScans = await prisma.scanRun.findMany({
    where: { websiteId, status: { in: ["COMPLETED", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (allScans.length <= SCAN_RETENTION) return;

  const toDeleteIds = allScans.slice(SCAN_RETENTION).map((s) => s.id);

  const pageResults = await prisma.scanPageResult.findMany({
    where: { scanRunId: { in: toDeleteIds } },
    select: { screenshotKey: true, diffKey: true },
  });

  const keysToDelete = pageResults.flatMap((r) =>
    [r.screenshotKey, r.diffKey].filter((k): k is string => !!k)
  );

  await Promise.allSettled(keysToDelete.map((key) => deleteImage(key)));

  await prisma.scanRun.deleteMany({ where: { id: { in: toDeleteIds } } });

  console.log(`[prune] Deleted ${toDeleteIds.length} old scan(s) for website ${websiteId}`);
}
