export type ScanStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type ScanType = "BASELINE" | "SCAN";
export type EmailNotificationType = "SCAN_COMPLETE" | "VISUAL_CHANGE" | "FAILURE";

export interface ScanConfig {
  id: string;
  websiteId: string;
  intervalHours: number;
  threshold: number;
  viewportWidth: number;
  viewportHeight: number;
  enabled: boolean;
}

export interface WebsitePage {
  id: string;
  websiteId: string;
  name: string | null;
  url: string;
  createdAt: string;
  baselineImages?: BaselineImage[];
}

export interface BaselineImage {
  id: string;
  pageId: string;
  storageKey: string;
  url: string;
  createdAt: string;
}

export interface Website {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  pageCount?: number;
  lastScan?: ScanRunSummary | null;
  pages?: WebsitePage[];
  scanConfig?: ScanConfig | null;
  scanRuns?: ScanRun[];
}

export interface ScanRunSummary {
  id: string;
  status: ScanStatus;
  type: ScanType;
  createdAt: string;
  completedAt: string | null;
}

export interface ScanPageResult {
  id: string;
  scanRunId: string;
  pageId: string;
  status: ScanStatus;
  screenshotUrl: string | null;
  baselineUrl: string | null;
  diffUrl: string | null;
  diffScore: number | null;
  diffPixels: number | null;
  hasChanges: boolean;
  error: string | null;
  page?: { id: string; name: string | null; url: string };
}

export interface ScanRun {
  id: string;
  websiteId: string;
  type: ScanType;
  status: ScanStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  pageResults: ScanPageResult[];
}

export interface DashboardStats {
  websites: number;
  pages: number;
  scans: {
    total: number;
    successful: number;
    failed: number;
    changesDetected: number;
  };
  queues: {
    baseline: { waiting: number };
    scan: { waiting: number };
  };
  recentActivity: {
    id: string;
    websiteId: string;
    websiteName: string;
    type: ScanType;
    status: ScanStatus;
    createdAt: string;
    completedAt: string | null;
    hasChanges: boolean;
    pageCount: number;
  }[];
}
