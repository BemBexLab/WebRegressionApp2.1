import { prisma } from "./prisma";

const USER_AGENT =
  "Mozilla/5.0 (compatible; WebRegressionBot/1.0; +https://localhost)";
const REQUEST_TIMEOUT_MS = parseInt(process.env.CRAWL_TIMEOUT_MS ?? "15000", 10);
export const MAX_PAGES_PER_SITE = parseInt(
  process.env.MAX_PAGES_PER_SITE ?? "200",
  10
);

interface CrawledPage {
  url: string;
  name?: string;
}

function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1]?.replace(/\s+/g, " ").trim();
  return title ? title.slice(0, 100) : undefined;
}

function extractLinks(html: string): string[] {
  const links = new Set<string>();
  const hrefRegex = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi;

  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    links.add(match[1]);
  }

  return [...links];
}

async function fetchHtml(url: string): Promise<{ finalUrl: string; html: string } | null> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    return null;
  }

  const finalUrl = normalizeUrl(response.url);
  if (!finalUrl) return null;

  return {
    finalUrl,
    html: await response.text(),
  };
}

export async function crawlWebsite(startUrl: string): Promise<CrawledPage[]> {
  const normalizedStartUrl = normalizeUrl(startUrl);
  if (!normalizedStartUrl) {
    throw new Error("Invalid website URL");
  }

  const start = new URL(normalizedStartUrl);
  const queued = new Set<string>([normalizedStartUrl]);
  const visited = new Set<string>();
  const queue = [normalizedStartUrl];
  const pages: CrawledPage[] = [];

  while (queue.length > 0 && pages.length < MAX_PAGES_PER_SITE) {
    const currentUrl = queue.shift();
    if (!currentUrl || visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    try {
      const page = await fetchHtml(currentUrl);
      if (!page) continue;

      const final = new URL(page.finalUrl);
      if (final.origin !== start.origin) continue;

      if (!visited.has(page.finalUrl)) visited.add(page.finalUrl);
      if (!pages.some((item) => item.url === page.finalUrl)) {
        pages.push({
          url: page.finalUrl,
          name: extractTitle(page.html),
        });
      }

      for (const href of extractLinks(page.html)) {
        const normalizedLink = normalizeUrl(href, page.finalUrl);
        if (!normalizedLink || queued.has(normalizedLink) || visited.has(normalizedLink)) {
          continue;
        }

        const linkUrl = new URL(normalizedLink);
        if (linkUrl.origin !== start.origin) continue;

        queued.add(normalizedLink);
        queue.push(normalizedLink);

        if (queue.length + pages.length >= MAX_PAGES_PER_SITE) break;
      }
    } catch (error) {
      console.warn(`Skipping crawl target ${currentUrl}:`, error);
    }
  }

  return pages;
}

export async function syncWebsitePages(
  websiteId: string,
  websiteUrl: string,
  homepageOnly = false
): Promise<{ pages: Array<{ id: string; url: string; name: string | null }>; discovered: number }> {
  if (homepageOnly) {
    const normalizedUrl = normalizeUrl(websiteUrl) ?? websiteUrl.replace(/\/$/, "");
    const existing = await prisma.websitePage.findFirst({
      where: { websiteId, url: normalizedUrl },
      select: { id: true, url: true, name: true },
    });
    if (existing) {
      return { pages: [existing], discovered: 1 };
    }
    const created = await prisma.websitePage.create({
      data: { websiteId, url: normalizedUrl, name: "Homepage" },
      select: { id: true, url: true, name: true },
    });
    return { pages: [created], discovered: 1 };
  }

  const discoveredPages = await crawlWebsite(websiteUrl);

  if (discoveredPages.length === 0) {
    throw new Error("No crawlable HTML pages were found for this website");
  }

  const existingPages = await prisma.websitePage.findMany({
    where: { websiteId },
    select: { id: true, url: true, name: true },
  });

  const existingByUrl = new Map(existingPages.map((page) => [page.url, page]));
  const syncedPages: Array<{ id: string; url: string; name: string | null }> = [];

  for (const page of discoveredPages) {
    const existing = existingByUrl.get(page.url);

    if (existing) {
      if (page.name && page.name !== existing.name) {
        await prisma.websitePage.update({
          where: { id: existing.id },
          data: { name: page.name },
        });
      }

      syncedPages.push({
        id: existing.id,
        url: existing.url,
        name: page.name ?? existing.name,
      });
      continue;
    }

    const created = await prisma.websitePage.create({
      data: {
        websiteId,
        url: page.url,
        name: page.name,
      },
      select: { id: true, url: true, name: true },
    });

    syncedPages.push(created);
  }

  return {
    pages: syncedPages,
    discovered: discoveredPages.length,
  };
}
