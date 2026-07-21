import {
  Website,
  WebsitePage,
  ScanRun,
  ScanConfig,
  DashboardStats,
} from "./types";

const INTERNAL_API_URL = process.env.API_URL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

function isServerRequest(): boolean {
  return typeof window === "undefined";
}

function authHeaders(): HeadersInit {
  if (!isServerRequest() || !ADMIN_PASSWORD) {
    return { "Content-Type": "application/json" };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ADMIN_PASSWORD}`,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const requestUrl = isServerRequest()
    ? `${INTERNAL_API_URL}/api${path}`
    : `/app-api${path}`;

  const res = await fetch(requestUrl, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  stats: {
    get: () => request<DashboardStats>("/stats"),
  },

  websites: {
    list: () => request<Website[]>("/websites"),
    get: (id: string) => request<Website>(`/websites/${id}`),
    create: (data: { name: string; url: string; homepageOnly?: boolean }) =>
      request<Website>("/websites", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{ name: string; url: string }>) =>
      request<Website>(`/websites/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/websites/${id}`, { method: "DELETE" }),
    updateConfig: (id: string, data: Partial<ScanConfig>) =>
      request<ScanConfig>(`/websites/${id}/config`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    pause: (id: string) =>
      request<{ config: ScanConfig; removedPendingRuns: number; message: string }>(
        `/websites/${id}/pause`,
        { method: "POST" }
      ),
    resume: (id: string) =>
      request<{ config: ScanConfig; scheduledScanRunId: string | null; message: string }>(
        `/websites/${id}/resume`,
        { method: "POST" }
      ),
  },

  pages: {
    list: (websiteId: string) => request<WebsitePage[]>(`/websites/${websiteId}/pages`),
    create: (websiteId: string, data: { url: string; name?: string }) =>
      request<WebsitePage>(`/websites/${websiteId}/pages`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (websiteId: string, pageId: string) =>
      request<void>(`/websites/${websiteId}/pages/${pageId}`, { method: "DELETE" }),
  },

  scans: {
    list: (websiteId: string, page = 1, limit = 20) =>
      request<{ total: number; page: number; limit: number; runs: ScanRun[] }>(
        `/websites/${websiteId}/scans?page=${page}&limit=${limit}`
      ),
    get: (websiteId: string, scanId: string) =>
      request<ScanRun>(`/websites/${websiteId}/scans/${scanId}`),
    triggerBaseline: (websiteId: string) =>
      request<{ scanRunId: string; message: string }>(
        `/websites/${websiteId}/scans/baseline`,
        { method: "POST" }
      ),
    triggerScan: (websiteId: string) =>
      request<{ scanRunId: string; message: string }>(
        `/websites/${websiteId}/scans/scan`,
        { method: "POST" }
      ),
  },
};
