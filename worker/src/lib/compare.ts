import sharp from "sharp";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface CompareResult {
  diffScore: number;
  diffPixels: number;
  totalPixels: number;
  diffImageBuffer: Buffer;
  hasChanges: boolean;
}

async function normalizePng(imageBuffer: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize(width, height, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
}

function pngToRawPixels(pngBuffer: Buffer): { data: Buffer; width: number; height: number } {
  const png = PNG.sync.read(pngBuffer);
  return { data: Buffer.from(png.data), width: png.width, height: png.height };
}

export async function compareScreenshots(
  baselineBuffer: Buffer,
  latestBuffer: Buffer,
  threshold: number = 0.3
): Promise<CompareResult> {
  const baselineMeta = await sharp(baselineBuffer).metadata();
  const latestMeta = await sharp(latestBuffer).metadata();

  const targetWidth = Math.max(baselineMeta.width ?? 1280, latestMeta.width ?? 1280);
  const targetHeight = Math.max(baselineMeta.height ?? 720, latestMeta.height ?? 720);

  const [normalizedBaseline, normalizedLatest] = await Promise.all([
    normalizePng(baselineBuffer, targetWidth, targetHeight),
    normalizePng(latestBuffer, targetWidth, targetHeight),
  ]);

  const baselinePixels = pngToRawPixels(normalizedBaseline);
  const latestPixels = pngToRawPixels(normalizedLatest);

  const diffPng = new PNG({ width: targetWidth, height: targetHeight });
  const diffPixels = pixelmatch(
    baselinePixels.data,
    latestPixels.data,
    diffPng.data,
    targetWidth,
    targetHeight,
    { threshold: 0.1, includeAA: false, alpha: 0.3, diffColor: [255, 0, 0] }
  );

  const totalPixels = targetWidth * targetHeight;
  const diffScore = diffPixels / totalPixels;
  const diffImageBuffer = PNG.sync.write(diffPng);

  return {
    diffScore,
    diffPixels,
    totalPixels,
    diffImageBuffer,
    hasChanges: diffScore > threshold,
  };
}
