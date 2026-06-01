import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { syncWebsitePages } from "../lib/siteDiscovery";

const router = Router();

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

const createWebsiteSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

const updateWebsiteSchema = createWebsiteSchema.partial();

router.get("/", async (_req: Request, res: Response) => {
  const websites = await prisma.website.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      pages: { select: { id: true } },
      scanConfig: true,
      scanRuns: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, type: true, createdAt: true, completedAt: true },
      },
    },
  });

  res.json(
    websites.map((w) => ({
      ...w,
      pageCount: w.pages.length,
      lastScan: w.scanRuns[0] ?? null,
      pages: undefined,
      scanRuns: undefined,
    }))
  );
});

router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const website = await prisma.website.findUnique({
    where: { id },
    include: {
      pages: {
        orderBy: { createdAt: "asc" },
        include: {
          baselineImages: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: { id: true, url: true, createdAt: true },
          },
        },
      },
      scanConfig: true,
      scanRuns: {
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          pageResults: {
            select: { id: true, status: true, hasChanges: true, diffScore: true, pageId: true },
          },
        },
      },
    },
  });

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  res.json(website);
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const parsed = createWebsiteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { name, url } = parsed.data;
  const normalizedUrl = url.replace(/\/$/, "");

  const existing = await prisma.website.findFirst({ where: { url: normalizedUrl } });
  if (existing) {
    res.status(409).json({ error: "Website with this URL already exists" });
    return;
  }

  const website = await prisma.website.create({
    data: {
      name,
      url: normalizedUrl,
      scanConfig: {
        create: {
          intervalHours: 5,
          threshold: parseFloat(process.env.DIFF_THRESHOLD ?? "0.01"),
        },
      },
    },
    include: { scanConfig: true, pages: true },
  });

  try {
    const synced = await syncWebsitePages(website.id, normalizedUrl);

    res.status(201).json({
      ...website,
      pages: synced.pages,
    });
  } catch (error) {
    await prisma.website.delete({ where: { id: website.id } });
    res.status(422).json({
      error: error instanceof Error ? error.message : "Failed to crawl website pages",
    });
  }
});

router.put("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const parsed = updateWebsiteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const website = await prisma.website.findUnique({ where: { id } });
  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const normalizedUpdate = parsed.data.url
    ? { ...parsed.data, url: parsed.data.url.replace(/\/$/, "") }
    : parsed.data;

  const updated = await prisma.website.update({
    where: { id },
    data: normalizedUpdate,
    include: { scanConfig: true, pages: true },
  });

  try {
    const synced =
      parsed.data.url || updated.pages.length === 0
        ? await syncWebsitePages(updated.id, updated.url)
        : { pages: updated.pages, discovered: updated.pages.length };

    res.json({
      ...updated,
      pages: synced.pages,
    });
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "Failed to crawl website pages",
    });
  }
});

router.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const website = await prisma.website.findUnique({ where: { id } });
  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  await prisma.website.delete({ where: { id } });
  res.status(204).send();
});

router.put("/:id/config", async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const schema = z.object({
    intervalHours: z.number().int().min(1).max(168).optional(),
    threshold: z.number().min(0).max(1).optional(),
    viewportWidth: z.number().int().min(320).max(3840).optional(),
    viewportHeight: z.number().int().min(240).max(2160).optional(),
    enabled: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const config = await prisma.scanConfig.upsert({
    where: { websiteId: id },
    update: parsed.data,
    create: { websiteId: id, ...parsed.data },
  });

  res.json(config);
});

export default router;
