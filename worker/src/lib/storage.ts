import { StorageClient } from "@supabase/storage-js";

const storageUrl = process.env.SUPABASE_STORAGE_URL ?? "http://localhost:5000";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "screenshots";

const storage = new StorageClient(storageUrl, {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
});

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isPublicOrigin(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();

    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
      return false;
    }

    if (host.endsWith(".local")) {
      return false;
    }

    if (!host.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const { data: buckets, error } = await storage.listBuckets();
  if (error) throw new Error(`Failed to list buckets: ${error.message}`);
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error: createErr } = await storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 52428800,
    });
    if (createErr) throw new Error(`Failed to create bucket: ${createErr.message}`);
    console.log(`Created storage bucket: ${BUCKET}`);
  }
}

export function buildStorageKey(
  websiteId: string,
  pageId: string,
  type: "baseline" | "screenshot" | "diff",
  scanRunId?: string
): string {
  if (type === "baseline") {
    return `${websiteId}/${pageId}/baseline.png`;
  }
  return `${websiteId}/${pageId}/${type}/${scanRunId}.png`;
}

export function buildReportStorageKey(websiteId: string, scanRunId: string): string {
  return `${websiteId}/reports/${scanRunId}.pdf`;
}

export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const { error } = await storage.from(BUCKET).upload(key, buffer, {
    contentType,
    upsert: true,
    cacheControl: "31536000",
  });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  // Return a path relative to the app's public origin so browsers can load it
  // regardless of which port they're on. nginx and Next.js both proxy /storage/.
  return `/storage/object/public/${BUCKET}/${key}`;
}

export async function uploadImage(key: string, buffer: Buffer): Promise<string> {
  return uploadFile(key, buffer, "image/png");
}

export async function downloadImage(key: string): Promise<Buffer> {
  const { data, error } = await storage.from(BUCKET).download(key);
  if (error) throw new Error(`Storage download failed: ${error.message}`);

  const arrayBuffer = await (data as Blob).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteImage(key: string): Promise<void> {
  const { error } = await storage.from(BUCKET).remove([key]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

export function toPublicAppUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const configuredPublicUrl = process.env.PUBLIC_APP_URL?.trim();
  if (configuredPublicUrl) {
    return `${trimTrailingSlash(configuredPublicUrl)}${normalizedPath}`;
  }

  const configuredOrigins = (process.env.FRONTEND_URL ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const preferredOrigin =
    configuredOrigins.find((origin) => isPublicOrigin(origin)) ?? configuredOrigins[0];

  if (!preferredOrigin) {
    return normalizedPath;
  }

  return `${trimTrailingSlash(preferredOrigin)}${normalizedPath}`;
}
