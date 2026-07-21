import { chromium, Browser, BrowserContext } from "@playwright/test";
import { PNG } from "pngjs";

let browser: Browser | null = null;
const INITIAL_LOAD_DELAY_MS = parseInt(
  process.env.SCREENSHOT_INITIAL_LOAD_DELAY_MS ?? "2500",
  10
);
const SETTLE_DELAY_MS = parseInt(process.env.SCREENSHOT_SETTLE_DELAY_MS ?? "2500", 10);
const SAMPLE_GAP_MS = parseInt(process.env.SCREENSHOT_SAMPLE_GAP_MS ?? "750", 10);
const UNSTABLE_PIXEL_TOLERANCE = parseInt(
  process.env.SCREENSHOT_UNSTABLE_PIXEL_TOLERANCE ?? "12",
  10
);
const NAVIGATION_TIMEOUT_MS = parseInt(
  process.env.SCREENSHOT_NAVIGATION_TIMEOUT_MS ?? "45000",
  10
);
const LOAD_STATE_TIMEOUT_MS = parseInt(
  process.env.SCREENSHOT_LOAD_STATE_TIMEOUT_MS ?? "15000",
  10
);
const CAPTURE_TIMEOUT_MS = parseInt(
  process.env.SCREENSHOT_CAPTURE_TIMEOUT_MS ?? "45000",
  10
);
const NAVIGATION_RETRY_COUNT = parseInt(
  process.env.SCREENSHOT_NAVIGATION_RETRY_COUNT ?? "3",
  10
);
const MAX_SCROLL_STEPS = parseInt(process.env.SCREENSHOT_MAX_SCROLL_STEPS ?? "24", 10);
const FULL_PAGE_CAPTURE = (process.env.SCREENSHOT_FULL_PAGE ?? "false") === "true";

export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-extensions",
      ],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export interface ScreenshotOptions {
  url: string;
  viewportWidth?: number;
  viewportHeight?: number;
  stabilizeComparison?: boolean;
}

export interface CapturedScreenshot {
  displayBuffer: Buffer;
  compareBuffer: Buffer;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function buildComparisonBuffer(primaryBuffer: Buffer, secondaryBuffer: Buffer): Buffer {
  const primary = PNG.sync.read(primaryBuffer);
  const secondary = PNG.sync.read(secondaryBuffer);

  if (primary.width !== secondary.width || primary.height !== secondary.height) {
    return secondaryBuffer;
  }

  const sanitized = new PNG({ width: secondary.width, height: secondary.height });
  sanitized.data.set(secondary.data);

  for (let i = 0; i < primary.data.length; i += 4) {
    const delta =
      Math.abs(primary.data[i] - secondary.data[i]) +
      Math.abs(primary.data[i + 1] - secondary.data[i + 1]) +
      Math.abs(primary.data[i + 2] - secondary.data[i + 2]) +
      Math.abs(primary.data[i + 3] - secondary.data[i + 3]);

    if (delta > UNSTABLE_PIXEL_TOLERANCE) {
      sanitized.data[i] = 255;
      sanitized.data[i + 1] = 255;
      sanitized.data[i + 2] = 255;
      sanitized.data[i + 3] = 255;
    }
  }

  return PNG.sync.write(sanitized);
}

async function waitForPageToFullyLoad(
  page: Awaited<ReturnType<BrowserContext["newPage"]>>
): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: LOAD_STATE_TIMEOUT_MS });

  try {
    await page.waitForLoadState("load", { timeout: LOAD_STATE_TIMEOUT_MS });
  } catch {}

  await page.waitForTimeout(INITIAL_LOAD_DELAY_MS);
}

async function hydrateLazyContent(
  page: Awaited<ReturnType<BrowserContext["newPage"]>>
): Promise<void> {
  await page.evaluate(async ({ maxScrollSteps, fullPageCapture }) => {
    const root = globalThis as any;
    const doc = root.document;
    const win = root.window;

    let totalHeight = Math.max(
      doc?.body?.scrollHeight ?? 0,
      doc?.documentElement?.scrollHeight ?? 0
    );
    const viewportHeight = win?.innerHeight ?? 800;
    const step = Math.max(Math.floor(viewportHeight * 0.75), 400);
    const previewScrollTarget = Math.min(totalHeight, step * maxScrollSteps);

    for (let y = 0; y < previewScrollTarget; y += step) {
      win.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (fullPageCapture) {
      win.scrollTo(0, totalHeight);
      await new Promise((resolve) => setTimeout(resolve, 800));

      totalHeight = Math.max(
        doc?.body?.scrollHeight ?? totalHeight,
        doc?.documentElement?.scrollHeight ?? totalHeight
      );

      win.scrollTo(0, totalHeight);
      await new Promise((resolve) => setTimeout(resolve, 800));
    } else {
      win.scrollTo(0, previewScrollTarget);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    win.scrollTo(0, totalHeight);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.scrollTo(0, 0);
  }, { maxScrollSteps: MAX_SCROLL_STEPS, fullPageCapture: FULL_PAGE_CAPTURE });

  await page.waitForTimeout(1000);
}

function isNavigationTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "TimeoutError" ||
    error.message.includes("Timeout") ||
    error.message.includes("timed out")
  );
}

async function gotoWithRetries(
  page: Awaited<ReturnType<BrowserContext["newPage"]>>,
  url: string
): Promise<void> {
  const maxAttempts = Math.max(1, NAVIGATION_RETRY_COUNT);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt === 1) {
        console.log(`[browser] goto ${url} (attempt ${attempt}/${maxAttempts})`);
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
      } else {
        console.log(`[browser] reload ${url} (attempt ${attempt}/${maxAttempts})`);
        await page.reload({
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
      }

      return;
    } catch (error) {
      lastError = error;

      if (!isNavigationTimeout(error) || attempt === maxAttempts) {
        break;
      }

      console.warn(
        `[browser] navigation timeout for ${url} on attempt ${attempt}/${maxAttempts}; retrying with reload`
      );
      await page.waitForTimeout(1000);
    }
  }

  const baseMessage =
    lastError instanceof Error ? lastError.message : `Navigation failed for ${url}`;

  throw new Error(
    `${baseMessage} after ${maxAttempts} attempt(s) including reload retries`
  );
}

async function freezePageForCapture(page: Awaited<ReturnType<BrowserContext["newPage"]>>) {
  await page.addStyleTag({
    content: `
      html { scroll-behavior: auto !important; }
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      video, iframe[src*="youtube"], iframe[src*="ads"] {
        visibility: hidden !important;
      }
    `,
  });

  await page.evaluate(() => {
    const root = globalThis as any;
    const doc = root.document;
    const win = root.window;

    doc
      .querySelectorAll('[data-ad], .ad, .advertisement, [class*="banner-ad"], [id*="google_ads"]')
      .forEach((el: any) => {
        el.style.display = "none";
      });

    doc.querySelectorAll("video, audio").forEach((el: any) => {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {}
    });

    const animations =
      typeof doc.getAnimations === "function" ? doc.getAnimations() : [];

    for (const animation of animations) {
      try {
        const timing =
          animation.effect && typeof animation.effect.getComputedTiming === "function"
            ? animation.effect.getComputedTiming()
            : null;
        if (timing && timing.iterations === Infinity) {
          animation.pause();
        } else {
          animation.finish();
        }
      } catch {
        animation.pause();
      }
    }

    if (typeof win.requestAnimationFrame === "function") {
      const raf = win.requestAnimationFrame.bind(win);
      win.requestAnimationFrame = (callback: any) => raf(() => callback(0));
    }
  });
}

export async function takeScreenshot(opts: ScreenshotOptions): Promise<CapturedScreenshot> {
  const b = await getBrowser();
  let context: BrowserContext | null = null;

  try {
    context = await b.newContext({
      viewport: {
        width: opts.viewportWidth ?? 1280,
        height: opts.viewportHeight ?? 720,
      },
      reducedMotion: "reduce",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 WebRegression/1.0",
    });

    const page = await context.newPage();
    page.setDefaultTimeout(LOAD_STATE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["media", "font"].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await gotoWithRetries(page, opts.url);

    console.log(`[browser] loaded ${opts.url}`);
    await waitForPageToFullyLoad(page);
    console.log(`[browser] hydrated-start ${opts.url}`);
    await hydrateLazyContent(page);
    console.log(`[browser] hydrated-done ${opts.url}`);
    await freezePageForCapture(page);
    await page.waitForTimeout(SETTLE_DELAY_MS);

    const firstScreenshot = await withTimeout(
      page.screenshot({
        fullPage: FULL_PAGE_CAPTURE,
        type: "png",
        timeout: CAPTURE_TIMEOUT_MS,
      }),
      CAPTURE_TIMEOUT_MS + 1000,
      `Screenshot capture for ${opts.url}`
    );

    console.log(`[browser] screenshot-1 ${opts.url}`);

    if (opts.stabilizeComparison === false) {
      return {
        displayBuffer: firstScreenshot,
        compareBuffer: firstScreenshot,
      };
    }

    await page.waitForTimeout(SAMPLE_GAP_MS);

    const secondScreenshot = await withTimeout(
      page.screenshot({
        fullPage: FULL_PAGE_CAPTURE,
        type: "png",
        timeout: CAPTURE_TIMEOUT_MS,
      }),
      CAPTURE_TIMEOUT_MS + 1000,
      `Stability screenshot capture for ${opts.url}`
    );

    console.log(`[browser] screenshot-2 ${opts.url}`);

    return {
      displayBuffer: secondScreenshot,
      compareBuffer: buildComparisonBuffer(firstScreenshot, secondScreenshot),
    };
  } finally {
    if (context) await context.close();
  }
}
