import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { MAX_PAGES_PER_SITE } from "../lib/siteDiscovery";

const router = Router({ mergeParams: true });

const pageSchema = z.object({
  url: z.string().url(),
  name: z.string().max(100).optional(),
});

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

router.get("/", async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);
  const pages = await prisma.websitePage.findMany({
    where: { websiteId },
    orderBy: { createdAt: "asc" },
    include: {
      baselineImages: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { id: true, url: true, createdAt: true },
      },
    },
  });

  res.json(pages);
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);
  const parsed = pageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  const pageCount = await prisma.websitePage.count({ where: { websiteId } });

  if (pageCount >= MAX_PAGES_PER_SITE) {
    res.status(422).json({ error: `Maximum ${MAX_PAGES_PER_SITE} pages per website allowed` });
    return;
  }

  const existing = await prisma.websitePage.findFirst({
    where: { websiteId, url: parsed.data.url },
  });

  if (existing) {
    res.status(409).json({ error: "Page with this URL already exists" });
    return;
  }

  const page = await prisma.websitePage.create({
    data: { websiteId, url: parsed.data.url, name: parsed.data.name },
  });

  res.status(201).json(page);
});

router.delete("/:pageId", async (req: Request, res: Response): Promise<void> => {
  const websiteId = param(req.params.websiteId);
  const pageId = param(req.params.pageId);

  const page = await prisma.websitePage.findFirst({
    where: { id: pageId, websiteId },
  });

  if (!page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  await prisma.websitePage.delete({ where: { id: pageId } });
  res.status(204).send();
});

export default router;
