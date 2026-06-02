const INTERNAL_STORAGE_ORIGINS = [
  "http://supabase-storage:5000",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

export function normalizeAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  for (const origin of INTERNAL_STORAGE_ORIGINS) {
    if (url.startsWith(`${origin}/`)) {
      return `/storage/${url.slice(`${origin}/`.length)}`;
    }
  }

  return url;
}
