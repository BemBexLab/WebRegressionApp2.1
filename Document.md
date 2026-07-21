# WebRegression 2.1 — Full Project Documentation

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Services & Docker Compose](#3-services--docker-compose)
4. [Database Schema](#4-database-schema)
5. [API Server](#5-api-server)
6. [Worker](#6-worker)
7. [Frontend (Next.js)](#7-frontend-nextjs)
8. [Screenshot Engine](#8-screenshot-engine)
9. [Visual Comparison Engine](#9-visual-comparison-engine)
10. [Storage](#10-storage)
11. [Auto-Scan Scheduling](#11-auto-scan-scheduling)
12. [Scan Retention & Pruning](#12-scan-retention--pruning)
13. [Email Notifications](#13-email-notifications)
14. [PDF Report Export](#14-pdf-report-export)
15. [Site Discovery (Crawler)](#15-site-discovery-crawler)
16. [Authentication & Security](#16-authentication--security)
17. [Nginx Reverse Proxy](#17-nginx-reverse-proxy)
18. [Environment Variables Reference](#18-environment-variables-reference)
19. [Deployment (VPS)](#19-deployment-vps)
20. [Key Flows End-to-End](#20-key-flows-end-to-end)

---

## 1. Project Overview

WebRegression 2.1 is a self-hosted **visual regression testing** platform. It automatically crawls websites, captures full-page screenshots, and compares them against stored baselines to detect visual changes. When differences exceed a configurable threshold, alerts are sent via email with a PDF report attached.

**Core capabilities:**

- Automated website crawling and page discovery
- Playwright-based screenshot capture (Chromium headless)
- Pixel-level image diffing via `pixelmatch`
- Auto-scheduled recurring scans per website
- Email alerts with HTML + PDF reports
- Supabase Storage for screenshot persistence
- BullMQ job queues with Redis for resilient async processing
- Next.js dashboard UI with server actions

**Live VPS:** `203.161.44.35` — App directory: `/opt/WebRegressionApp2.1/`

---

## 2. Architecture

```
Browser / User
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Nginx (:80)                             │
│   /         → frontend:3000                                     │
│   /api/      → api:4000                                         │
│   /storage/  → supabase-storage:5000                            │
└──────────────┬──────────────────┬──────────────────────────────┘
               │                  │
        ┌──────▼──────┐    ┌──────▼──────┐
        │  Frontend   │    │     API     │
        │  Next.js    │    │  Express    │
        │  (:3001)    │    │  (:4000)    │
        └─────────────┘    └──────┬──────┘
                                  │ BullMQ jobs
                           ┌──────▼──────┐
                           │   Redis     │
                           │  (:6379)    │
                           └──────┬──────┘
                                  │ dequeues
                           ┌──────▼──────┐
                           │   Worker    │
                           │ (Playwright)│
                           └──────┬──────┘
                    ┌─────────────┼─────────────┐
             ┌──────▼──────┐ ┌───▼────┐  ┌─────▼──────┐
             │  PostgreSQL │ │Supabase│  │   SMTP     │
             │  (:5432)    │ │Storage │  │  (email)   │
             └─────────────┘ │(:5000) │  └────────────┘
                             └────────┘
```

**Container names (Docker network):**
`postgres`, `redis`, `supabase-storage`, `api`, `worker`, `frontend`, `nginx`

Internal container-to-container communication uses hostnames above, never the host's external IP.

---

## 3. Services & Docker Compose

All services are defined in `docker-compose.yml`. Each has a `restart: unless-stopped` policy.

### postgres
- Image: `postgres:16-alpine`
- Port: `127.0.0.1:5432:5432` (localhost-only)
- Volume: `postgres_data`
- Init script: `postgres/init/01-supabase-roles.sql` — creates Supabase-required roles (`authenticator`, `anon`, `service_role`) in the database so the storage-api container can function
- Health check: `pg_isready -U postgres`

### redis
- Image: `redis:7-alpine`
- Port: `127.0.0.1:6379:6379` (localhost-only)
- Volume: `redis_data`
- Persistence: AOF with `appendfsync everysec`
- Protected-mode: `yes` (safe since it only listens on localhost — Docker bridge connections work because there is no password requirement inside the Docker network)
- Optional password via `REDIS_PASSWORD` env var

### supabase-storage
- Image: `supabase/storage-api:v1.11.13`
- Port: `127.0.0.1:5000:5000` (localhost-only)
- Volume: `supabase_storage` (local file backend — no S3)
- Storage backend: `file` at `/var/lib/storage`
- Bucket: `screenshots` (created automatically by the worker on startup via `ensureBucket()`)
- Max file size: 50 MB
- Health check: HTTP GET `/status`

### api
- Build context: `./server`
- Port: `4000:4000` (accessible externally for health checks)
- Depends on: `postgres` (healthy), `redis` (healthy)
- Health check: HTTP GET `http://127.0.0.1:4000/health`
- Serves: Express REST API under `/api/*`, protected by Bearer token auth

### worker
- Build context: `./worker`
- No exposed ports
- Depends on: `postgres` (healthy), `redis` (healthy), `supabase-storage` (healthy)
- Memory limit: 4 GB (`deploy.resources.limits.memory: 4G`)
- Shared memory: 1 GB (`shm_size: 1gb`) — required by Chromium
- Runs: BullMQ workers for `baseline`, `scan`, and `email` queues

### frontend
- Build context: `./client`
- Port: `3001:3000`
- Build args: `ADMIN_PASSWORD`, `API_URL=http://api:4000`, `STORAGE_URL=http://supabase-storage:5000`
- The `API_URL` is baked into the Next.js build at build-time for server-side rewrites
- Depends on: `api` (healthy)

### nginx
- Image: `nginx:alpine`
- Ports: `80:80`, `443:443`
- Config: `./nginx.conf` (mounted read-only)
- Volume: `nginx_certs` (for future TLS certificates)

---

## 4. Database Schema

Managed by **Prisma ORM**. Schema file: `server/prisma/schema.prisma` (mirrored to `worker/prisma/schema.prisma`).

### Website
| Column      | Type     | Notes                        |
|-------------|----------|------------------------------|
| id          | String   | CUID primary key             |
| name        | String   | Display name                 |
| url         | String   | Normalized (no trailing `/`) |
| createdAt   | DateTime |                              |
| updatedAt   | DateTime |                              |

Relations: `pages[]`, `scanConfig?`, `scanRuns[]`, `emailNotifications[]`

### WebsitePage
| Column    | Type     | Notes              |
|-----------|----------|--------------------|
| id        | String   | CUID               |
| websiteId | String   | FK → Website       |
| name      | String?  | Page `<title>`     |
| url       | String   | Full page URL      |

Relations: `website`, `scanResults[]`, `baselineImages[]`

### ScanConfig
One-to-one with Website. Controls auto-scan behavior and screenshot settings.

| Column          | Type    | Default | Notes                    |
|-----------------|---------|---------|--------------------------|
| id              | String  |         |                          |
| websiteId       | String  |         | Unique FK → Website      |
| intervalMinutes | Int     | 20      | Auto-scan frequency      |
| threshold       | Float   | 0.01    | Diff score to flag change|
| viewportWidth   | Int     | 1280    | Browser viewport px      |
| viewportHeight  | Int     | 720     | Browser viewport px      |
| enabled         | Boolean | true    | Auto-scan on/off         |

### ScanRun
Represents one full scan execution (either BASELINE or SCAN type).

| Column      | Type       | Notes                     |
|-------------|------------|---------------------------|
| id          | String     | CUID                      |
| websiteId   | String     | FK → Website              |
| type        | ScanType   | `BASELINE` or `SCAN`      |
| status      | ScanStatus | `PENDING/RUNNING/COMPLETED/FAILED` |
| startedAt   | DateTime?  |                           |
| completedAt | DateTime?  |                           |
| error       | String?    | Top-level error message   |

### ScanPageResult
One row per page per scan run.

| Column        | Type      | Notes                          |
|---------------|-----------|--------------------------------|
| scanRunId     | String    | FK → ScanRun                   |
| pageId        | String    | FK → WebsitePage               |
| status        | ScanStatus|                                |
| screenshotKey | String?   | Storage key for new screenshot |
| screenshotUrl | String?   | Public path `/storage/...`     |
| baselineKey   | String?   | Storage key for baseline       |
| baselineUrl   | String?   | Public path `/storage/...`     |
| diffKey       | String?   | Storage key for diff image     |
| diffUrl       | String?   | Public path `/storage/...`     |
| diffScore     | Float?    | Fraction of changed pixels     |
| diffPixels    | Int?      | Absolute changed pixel count   |
| hasChanges    | Boolean   | `diffScore > threshold`        |
| error         | String?   | Per-page error message         |

### BaselineImage
Stores the current baseline for each page (one active baseline per page).

| Column     | Type    | Notes                             |
|------------|---------|-----------------------------------|
| pageId     | String  | FK → WebsitePage                  |
| storageKey | String  | `websiteId/pageId/baseline.png`   |
| url        | String  | Public path `/storage/...`        |
| width      | Int?    | Capture viewport width            |
| height     | Int?    | Capture viewport height           |

### EmailNotification
Audit log of sent (or failed) email alerts.

| Column    | Type                  | Notes             |
|-----------|-----------------------|-------------------|
| websiteId | String?               | FK → Website      |
| scanRunId | String?               |                   |
| type      | EmailNotificationType | `SCAN_COMPLETE / VISUAL_CHANGE / FAILURE` |
| recipient | String                |                   |
| subject   | String                |                   |
| status    | EmailStatus           | `PENDING/SENT/FAILED` |
| sentAt    | DateTime?             |                   |
| error     | String?               |                   |

### Enums
- `ScanType`: `BASELINE`, `SCAN`
- `ScanStatus`: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`
- `EmailNotificationType`: `SCAN_COMPLETE`, `VISUAL_CHANGE`, `FAILURE`
- `EmailStatus`: `PENDING`, `SENT`, `FAILED`

---

## 5. API Server

**Entry point:** `server/src/index.ts` → `server/src/app.ts`

Express app on port 4000. All `/api/*` routes require Bearer token auth (see §16).

### Middleware Stack
1. `helmet()` — HTTP security headers
2. `cors()` — allows origins from `FRONTEND_URL` env var (comma-separated list)
3. `express.json({ limit: "1mb" })`
4. `globalLimiter` — rate limiter (all routes)
5. `adminAuth` — Bearer token check (all `/api` routes)

### Health Check
```
GET /health
```
Returns `{ status: "ok", checks: { database, redis } }`. Returns 503 if either dependency is down. Used by Docker health checks.

### Route Groups

All routes are under `/api/` prefix and registered in `server/src/routes/index.ts`.

#### Websites — `/api/websites`

| Method | Path              | Description                                      |
|--------|-------------------|--------------------------------------------------|
| GET    | `/`               | List all websites with page count and last scan  |
| GET    | `/:id`            | Get website with pages, config, last 10 scan runs|
| POST   | `/`               | Create website (crawls pages, creates ScanConfig)|
| PUT    | `/:id`            | Update name/URL (re-crawls if URL changed)       |
| DELETE | `/:id`            | Delete website and all related data (cascade)    |
| PUT    | `/:id/config`     | Update `ScanConfig` (interval, threshold, viewport, enabled) |

**POST /websites body:**
```json
{ "name": "My Site", "url": "https://example.com" }
```
Creates the website, auto-crawls pages, creates default `ScanConfig` (interval: 20min, threshold: 0.01). Returns 409 if URL already exists. Returns 422 if crawl fails.

**PUT /websites/:id/config body:**
```json
{
  "intervalMinutes": 60,
  "threshold": 0.02,
  "viewportWidth": 1920,
  "viewportHeight": 1080,
  "enabled": true
}
```
All fields optional. Valid ranges: `intervalMinutes` 1–10080, `threshold` 0–1, `viewportWidth` 320–3840, `viewportHeight` 240–2160.

#### Pages — `/api/websites/:websiteId/pages`

| Method | Path         | Description                                |
|--------|--------------|--------------------------------------------|
| GET    | `/`          | List pages with latest baseline image info |
| POST   | `/`          | Add a page manually                        |
| DELETE | `/:pageId`   | Remove a page                              |

Max pages per website: `MAX_PAGES_PER_SITE` (default 80). Returns 409 if URL already exists on that website.

#### Scans — `/api/websites/:websiteId/scans`

| Method | Path              | Description                             |
|--------|-------------------|-----------------------------------------|
| GET    | `/`               | List scan runs (paginated, ?page=&limit=)|
| GET    | `/:scanId`        | Get scan run with all page results      |
| POST   | `/baseline`       | Trigger a new baseline capture          |
| POST   | `/scan`           | Trigger a new comparison scan           |
| GET    | `/:scanId/export` | Download scan as PDF                    |

**POST /baseline:** Re-crawls pages, creates a `ScanRun` of type `BASELINE`, enqueues a BullMQ `baseline` job. Returns 409 if another scan is active. Special case: if a delayed auto-scan is pending, it promotes it to run immediately and returns 202.

**POST /scan:** Same flow for `SCAN` type. Requires at least one page with an existing baseline. Returns 422 `"No baseline exists. Create a baseline first."` otherwise.

**GET /:scanId/export:** Generates and streams a PDF report (baseline scans return 400).

#### Stats — `/api/stats`

| Method | Path | Description                                        |
|--------|------|----------------------------------------------------|
| GET    | `/`  | Aggregated counts: websites, pages, scans, queues  |

Returns:
```json
{
  "websites": 3,
  "pages": 24,
  "scans": { "total": 100, "successful": 95, "failed": 5, "changesDetected": 12 },
  "queues": { "baseline": { "waiting": 0 }, "scan": { "waiting": 1 } },
  "recentActivity": [...]
}
```

### Queue Configuration
`server/src/queues/index.ts` exports `baselineQueue`, `scanQueue`, `emailQueue` — all backed by the same Redis connection defined in `server/src/lib/redis.ts`.

---

## 6. Worker

**Entry point:** `worker/src/index.ts`

Node.js process running three BullMQ workers concurrently. Starts by calling `ensureBucket()` to ensure the storage bucket exists, then calls `reconcileAutoScans()` to reschedule any missed auto-scans.

### Workers

| Worker          | Queue      | Concurrency           | Lock Duration |
|-----------------|------------|-----------------------|---------------|
| baselineWorker  | `baseline` | `BASELINE_CONCURRENCY` (default 1) | 900000ms |
| scanWorker      | `scan`     | `SCAN_CONCURRENCY` (default 1)     | 900000ms |
| emailWorker     | `email`    | 5 (hardcoded)          | 900000ms |

Stalled interval: `BULLMQ_STALLED_INTERVAL_MS` (default 120000ms). If a job stalls (worker dies mid-job), BullMQ will re-enqueue it after this interval.

All workers log job start and completion. On `failed` event, the `baseline` and `scan` workers call `markRunFailed()` to set the DB scan run status to `FAILED`.

### processBaseline (`worker/src/processors/baseline.ts`)

1. Mark `ScanRun` as `RUNNING`
2. Fetch full `ScanRun` including website config, page results, and pages
3. For each page:
   - Mark page result as `RUNNING`
   - Call `takeScreenshot()` with `stabilizeComparison: false`
   - Upload screenshot as `{websiteId}/{pageId}/baseline.png` (overwriting previous baseline)
   - Also upload the screenshot as `screenshotKey` for the scan run record
   - Replace `BaselineImage` record for the page in a DB transaction
   - Mark page result as `COMPLETED`
4. Mark `ScanRun` as `COMPLETED` or `FAILED`
5. If succeeded and `scanConfig.enabled`, call `scheduleNextScan()` to queue the first auto-scan
6. Call `pruneOldScans()` to enforce 20-scan retention

### processScan (`worker/src/processors/scan.ts`)

1. Mark `ScanRun` as `RUNNING`
2. Fetch full `ScanRun` including baseline images per page
3. For each page:
   - Take screenshot (dual-capture with stability comparison)
   - Upload new screenshot to `{websiteId}/{pageId}/screenshot/{scanRunId}.png`
   - If page has a baseline: download baseline, run `compareScreenshots()`, upload diff image if changes detected
   - If page has no baseline: create one automatically (treated as new page)
   - Save diff metrics (`diffScore`, `diffPixels`, `hasChanges`) to page result
4. Mark `ScanRun` as `COMPLETED` or `FAILED`
5. If `NOTIFICATION_EMAIL` is set and there are changes or errors, enqueue an `email` job
6. If `scanConfig.enabled`, call `scheduleNextScan()` to queue the next auto-scan
7. Call `pruneOldScans()` to enforce 20-scan retention

### processEmail (`worker/src/processors/email.ts`)

1. Fetch website and scan run from DB
2. Build plain-text and HTML email bodies
3. Generate PDF report (via `createScanPdfBuffer`)
4. Create `EmailNotification` record (status `PENDING`)
5. Send email via Nodemailer SMTP with PDF attached
6. Update `EmailNotification` to `SENT` or `FAILED`

---

## 7. Frontend (Next.js)

**Directory:** `client/`

Next.js 14+ App Router with server components and server actions. Output mode: `standalone` (for Docker deployment).

### Pages

| Route                              | Description                              |
|------------------------------------|------------------------------------------|
| `/`                                | Dashboard / home                         |
| `/websites`                        | List all websites                        |
| `/websites/new`                    | Add new website form                     |
| `/websites/[id]`                   | Website detail: pages, scans, config     |
| `/websites/[id]/scans/[scanId]`    | Scan run detail: diff viewer per page    |

### Key Files

- `client/lib/api.ts` — API client. Server-side uses `process.env.API_URL` (container hostname). Client-side uses `""` (relative URL, proxied by Next.js rewrite to the API container).
- `client/lib/types.ts` — TypeScript types matching DB models
- `client/lib/media.ts` — Storage URL helpers
- `client/next.config.ts` — Rewrites `/api/:path*` → `API_URL/api/:path*`, `/storage/:path*` → `STORAGE_URL/:path*`
- `client/components/DiffViewer.tsx` — Side-by-side baseline/screenshot/diff image viewer
- `client/components/WebsiteActions.tsx` — Buttons for triggering baseline and scan
- `client/components/PageList.tsx` — Lists pages with baseline status
- `client/components/AddPageForm.tsx` — Manual page addition form
- `client/components/StatusBadge.tsx` — Colored status indicator component
- `client/components/Sidebar.tsx` — Navigation sidebar

### API Route (scan-reports)

`client/app/api/scan-reports/[websiteId]/[scanId]/route.ts` — Proxy route that fetches and streams the PDF export from the API server, forwarding the admin Bearer token.

### Next.js Configuration (`client/next.config.ts`)

```typescript
experimental: {
  serverActions: {
    allowedOrigins: [
      "localhost:3000", "localhost:3001", "localhost",
      "203.161.44.35", "203.161.44.35:3001", "203.161.44.35:80",
    ],
  },
},
rewrites: [
  { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
  { source: "/storage/:path*", destination: `${STORAGE_URL}/:path*` },
]
```

`API_URL` is baked at build time from the `API_URL` Docker build arg (`http://api:4000`). This means server-side fetch calls and rewrites both route through the Docker container hostname.

---

## 8. Screenshot Engine

**File:** `worker/src/lib/browser.ts`

Uses **Playwright** with Chromium (headless). A single shared `Browser` instance is reused across jobs.

### Chromium launch flags
`--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-accelerated-2d-canvas`, `--disable-gpu`, `--disable-web-security`, `--disable-extensions`

### Capture pipeline (`takeScreenshot`)

1. Create a new `BrowserContext` (isolated per job)
2. Block `media` and `font` resource types (reduces noise)
3. Navigate to URL with `waitUntil: "domcontentloaded"` (45s timeout)
4. Wait for `domcontentloaded` + `load` events + `INITIAL_LOAD_DELAY_MS` (default 2500ms)
5. `hydrateLazyContent()` — scroll through the page to trigger lazy-load, up to `MAX_SCROLL_STEPS` (default 12 for worker). If `SCREENSHOT_FULL_PAGE=true`, scrolls to full document height.
6. `freezePageForCapture()` — inject CSS to disable all animations/transitions, hide ads and video players, pause/finish all Web Animations API animations
7. Wait `SETTLE_DELAY_MS` (default 2500ms)
8. Take first screenshot (PNG)
9. If `stabilizeComparison !== false` (scan mode): wait `SAMPLE_GAP_MS` (750ms), take second screenshot, call `buildComparisonBuffer()` which blanks out pixels that differ between the two captures (removes dynamic content from comparison without affecting the display screenshot)

**Returns:** `{ displayBuffer, compareBuffer }` — `displayBuffer` is what's stored and shown; `compareBuffer` is what's used for diffing.

### Configurable env vars (browser)

| Env Var                              | Default | Description                     |
|--------------------------------------|---------|---------------------------------|
| SCREENSHOT_INITIAL_LOAD_DELAY_MS     | 2500    | Wait after page load events     |
| SCREENSHOT_SETTLE_DELAY_MS           | 2500    | Wait after freeze, before capture |
| SCREENSHOT_SAMPLE_GAP_MS             | 750     | Gap between stability captures  |
| SCREENSHOT_UNSTABLE_PIXEL_TOLERANCE  | 12      | Channel delta to blank out      |
| SCREENSHOT_NAVIGATION_TIMEOUT_MS     | 45000   | Max navigation time             |
| SCREENSHOT_LOAD_STATE_TIMEOUT_MS     | 15000   | Wait for load/DOMContentLoaded  |
| SCREENSHOT_CAPTURE_TIMEOUT_MS        | 45000   | Max screenshot time             |
| SCREENSHOT_MAX_SCROLL_STEPS          | 12      | Scroll steps for lazy content   |
| SCREENSHOT_FULL_PAGE                 | false   | Full-page vs viewport capture   |

---

## 9. Visual Comparison Engine

**File:** `worker/src/lib/compare.ts`

Uses `sharp` for image normalization and `pixelmatch` for pixel-level diffing.

### `compareScreenshots(baselineBuffer, latestBuffer, threshold)`

1. Determine target dimensions: `max(baselineWidth, latestWidth)` × `max(baselineHeight, latestHeight)`
2. Resize both images to target with `fit: contain`, white background (handles viewport size changes)
3. Convert to raw RGBA pixel arrays via `pngjs`
4. Run `pixelmatch` with `threshold: 0.1` (per-pixel color tolerance), `includeAA: false` (ignore anti-aliasing), diff color: red `[255, 0, 0]`
5. Compute `diffScore = diffPixels / totalPixels`
6. Return `{ diffScore, diffPixels, totalPixels, diffImageBuffer, hasChanges: diffScore > threshold }`

The `threshold` parameter (from `ScanConfig.threshold`, default `0.01`) is what determines whether `hasChanges` is true — i.e., 1% of pixels changed by default.

---

## 10. Storage

**File:** `worker/src/lib/storage.ts`

Uses `@supabase/storage-js` client to talk to the self-hosted `supabase/storage-api` container.

### Storage key patterns

| Type       | Key pattern                                        |
|------------|----------------------------------------------------|
| Baseline   | `{websiteId}/{pageId}/baseline.png`               |
| Screenshot | `{websiteId}/{pageId}/screenshot/{scanRunId}.png` |
| Diff       | `{websiteId}/{pageId}/diff/{scanRunId}.png`       |

The baseline key is **shared** — re-running baseline overwrites it. Screenshot and diff keys are scoped per scan run.

### Public URLs

`uploadImage()` returns `/storage/object/public/screenshots/{key}` — a path relative to the app's public origin. Both Next.js (via rewrite) and Nginx (via proxy) expose `/storage/` to the browser.

### Functions

- `ensureBucket()` — Lists buckets; creates the `screenshots` bucket if missing (called on worker startup)
- `buildStorageKey(websiteId, pageId, type, scanRunId?)` — Constructs the key
- `uploadImage(key, buffer)` — Uploads PNG, `upsert: true`, 1-year cache
- `downloadImage(key)` — Downloads as Buffer (used to fetch baseline for diffing)
- `deleteImage(key)` — Removes object (used by pruning)

---

## 11. Auto-Scan Scheduling

**File:** `worker/src/lib/autoScan.ts`

### `scheduleNextScan(websiteId, intervalMinutes, scanQueue, delayMs?)`

1. Check if a `PENDING` scan run already exists for the website — if so, skip (deduplication)
2. Fetch all pages for the website
3. Create a new `ScanRun` (type `SCAN`, status `PENDING`) with page results
4. Add a BullMQ job to the `scan` queue with `jobId: scan-{runId}` and `delay: delayMs ?? intervalMinutes * 60 * 1000`

The job ID pattern `scan-{runId}` allows the API to look it up and promote it from `delayed` to `active` when a manual scan is requested while one is already scheduled.

### `getAutoScanIntervalMinutes(intervalMinutes?)`

Priority order:
1. `AUTO_SCAN_INTERVAL_MINUTES` env var (if set and > 0)
2. `intervalMinutes` argument (from `ScanConfig.intervalMinutes`)
3. Default: `20` minutes

### `reconcileAutoScans(scanQueue)`

Called once on worker startup. For every website where:
- `scanConfig.enabled` is `true` (or unset)
- At least one page has a baseline image
- No scan is currently `PENDING` or `RUNNING`
- A completed run exists

...it computes `delayMs = latestCompletedAt + intervalMinutes - now` (clamped to 0) and calls `scheduleNextScan()` with that delay. This recovers missed scans after a worker restart without running them all immediately.

### Auto-scan trigger points

Auto-scans are scheduled:
1. **After baseline completes** — `processBaseline` calls `scheduleNextScan()` with no delay override (runs after `intervalMinutes`)
2. **After scan completes** — `processScan` calls `scheduleNextScan()` with no delay override, creating a chain
3. **On worker startup** — `reconcileAutoScans()` handles gaps from downtime

---

## 12. Scan Retention & Pruning

**File:** `worker/src/lib/pruneScans.ts`

### `pruneOldScans(prisma, websiteId)`

Called after every completed baseline and scan. Retains the **20 most recent** `COMPLETED` or `FAILED` scan runs per website.

Process:
1. Fetch all `COMPLETED`/`FAILED` scan runs for the website, ordered newest-first
2. If count ≤ 20, return immediately
3. Collect `screenshotKey` and `diffKey` from all page results of runs beyond 20
4. Delete storage objects in parallel via `Promise.allSettled` (failures don't abort the process)
5. Delete the scan run records (cascades to page results in DB)

**Important:** Baseline keys (`{websiteId}/{pageId}/baseline.png`) are never deleted by pruning — they are shared references used by all future scans.

---

## 13. Email Notifications

**File:** `worker/src/processors/email.ts`

Triggered by `processScan` when `NOTIFICATION_EMAIL` is set and the scan has visual changes or errors.

### Transport
Nodemailer with SMTP credentials from env vars. Supports Gmail app passwords and standard SMTP.

### Email content
- **Subject:** `[WebRegression] N page(s) changed on {websiteName}` (or failure subject)
- **Body:** HTML report listing changed/failed pages with diff URLs
- **Plain text:** Fallback plain-text version
- **Attachment:** PDF scan report (see §14)

### Notification types
- `VISUAL_CHANGE` — one or more pages exceeded the diff threshold
- `FAILURE` — one or more pages failed during scan
- `SCAN_COMPLETE` — sent for completeness (not currently triggered)

All sends are logged to `EmailNotification` table with outcome status.

---

## 14. PDF Report Export

**Files:** `server/src/lib/scanReport.ts`, `worker/src/lib/scanReport.ts` (identical)

Uses **PDFKit** to generate a multi-page PDF report.

### Structure
1. **Cover page:** website name, URL, scan run ID, threshold, generated timestamp, summary counts
2. **Changed URLs list:** all pages that exceeded threshold
3. **Failed pages list:** (if any)
4. **Per-changed-page sections:** For each changed page — name, URL, status, diff score/pixels, and embedded images (diff, current screenshot, baseline) fetched from storage. Images that are taller than the page are sliced across multiple pages using `sharp`.
5. **Full page summary:** All pages with status and result

### Image fetching in PDF
`resolveAssetUrl()` converts `/storage/...` relative paths to absolute `SUPABASE_STORAGE_URL` URLs so the server can fetch images internally from the storage container.

### Access

- **API route:** `GET /api/websites/:websiteId/scans/:scanId/export` — streams PDF directly
- **Next.js proxy:** `client/app/api/scan-reports/[websiteId]/[scanId]/route.ts` — forwards to API with auth token

---

## 15. Site Discovery (Crawler)

**File:** `server/src/lib/siteDiscovery.ts`

### `crawlWebsite(startUrl)`

BFS crawler that stays within the same origin:

1. Normalize start URL (strip trailing slash, strip fragment)
2. Fetch each URL, follow redirects, verify final URL stays on same origin
3. Parse `<a href>` links with regex, normalize, filter same-origin only
4. Stop when `MAX_PAGES_PER_SITE` pages are discovered
5. Extract `<title>` as page name

User agent: `Mozilla/5.0 (compatible; WebRegressionBot/1.0; +https://localhost)`

### `syncWebsitePages(websiteId, websiteUrl)`

Reconciles crawled pages with existing DB records:
- Updates page names if the `<title>` changed
- Creates new `WebsitePage` records for discovered pages
- Does NOT delete pages that are no longer discovered (preserves history)

Called on:
- `POST /websites` (initial setup)
- `POST /websites/:id/scans/baseline` and `POST /websites/:id/scans/scan` (refresh before each scan)
- `PUT /websites/:id` (when URL changes)

---

## 16. Authentication & Security

### API Authentication (`server/src/middleware/auth.ts`)

Simple static Bearer token:
```
Authorization: Bearer <ADMIN_PASSWORD>
```
All `/api/*` routes require this header. If `ADMIN_PASSWORD` env var is not set, auth is bypassed (dev mode). Returns 401 if missing or wrong.

### Frontend Auth
The `ADMIN_PASSWORD` build arg is baked into the Next.js build. The API client attaches it automatically as the Bearer token for every server-side request.

### CORS (`server/src/app.ts`)
Configured from `FRONTEND_URL` env var (comma-separated list of allowed origins). Supports exact origin matching and URL-based matching (protocol + hostname + optional port). Credentials allowed.

### Rate Limiting (`server/src/middleware/rateLimiter.ts`)
- `globalLimiter` — applied to all routes
- `scanLimiter` — applied specifically to baseline and scan trigger endpoints

### Helmet
`helmet()` applied to all responses — sets standard security headers (CSP, HSTS, X-Frame-Options, etc.).

---

## 17. Nginx Reverse Proxy

**File:** `nginx.conf`

Single HTTP server block on port 80.

| Location    | Upstream                        | Notes                               |
|-------------|---------------------------------|-------------------------------------|
| `/storage/` | `http://supabase-storage:5000/` | Strips `/storage` prefix            |
| `/api/`     | `http://api/api/`               | Passes API prefix through           |
| `/health`   | `http://api/health`             |                                     |
| `/`         | `http://frontend`               | WebSocket upgrade support           |

`client_max_body_size 2m` — limits request body size.

`proxy_read_timeout 60s` — allows time for slow scan operations.

---

## 18. Environment Variables Reference

All variables are defined in `.env` (not committed) based on `.env.example`.

### Database
| Variable           | Default             | Description               |
|--------------------|---------------------|---------------------------|
| POSTGRES_USER      | postgres            |                           |
| POSTGRES_PASSWORD  | (required)          |                           |
| POSTGRES_DB        | webregression       |                           |
| DATABASE_URL       | (required)          | Full Prisma connection URL|

### Redis
| Variable       | Default   | Description              |
|----------------|-----------|--------------------------|
| REDIS_HOST     | redis     | Container hostname       |
| REDIS_PORT     | 6379      |                          |
| REDIS_PASSWORD | (empty)   | Optional password        |

### Supabase Storage
| Variable                  | Default                  | Description                  |
|---------------------------|--------------------------|------------------------------|
| SUPABASE_STORAGE_URL      | http://supabase-storage:5000 | Internal container URL   |
| SUPABASE_SERVICE_ROLE_KEY | (demo JWT)               | JWT for storage auth         |
| SUPABASE_ANON_KEY         | (demo JWT)               | JWT for anon access          |
| SUPABASE_JWT_SECRET       | (demo secret)            | JWT signing secret           |
| SUPABASE_STORAGE_BUCKET   | screenshots              | Bucket name                  |

### API Server
| Variable         | Default        | Description                   |
|------------------|----------------|-------------------------------|
| ADMIN_PASSWORD   | change-me      | Bearer token for API auth     |
| FRONTEND_URL     | http://localhost:3000 | CORS allowed origins (comma-sep) |
| PORT             | 4000           |                               |
| MAX_PAGES_PER_SITE | 80           | Crawl limit                   |
| DIFF_THRESHOLD   | 0.01           | Default diff threshold        |

### Worker / Scanning
| Variable                    | Default  | Description                        |
|-----------------------------|----------|------------------------------------|
| SCAN_CONCURRENCY            | 1        | Parallel scan jobs                 |
| BASELINE_CONCURRENCY        | 1        | Parallel baseline jobs             |
| BULLMQ_LOCK_DURATION_MS     | 900000   | Job lock timeout (15 min)          |
| BULLMQ_STALLED_INTERVAL_MS  | 120000   | Stall detection interval           |
| AUTO_SCAN_INTERVAL_MINUTES  | 20       | Global override for scan frequency |
| SCREENSHOT_FULL_PAGE        | true     | Full-page vs viewport screenshots  |
| SCREENSHOT_MAX_SCROLL_STEPS | 12       | Lazy-load scroll steps             |

### Email (SMTP)
| Variable            | Default               | Description              |
|---------------------|-----------------------|--------------------------|
| SMTP_HOST           | smtp.gmail.com        |                          |
| SMTP_PORT           | 587                   |                          |
| SMTP_SECURE         | false                 | TLS (true = port 465)    |
| SMTP_USER           | (required for email)  | SMTP login               |
| SMTP_PASS           | (required for email)  | App password             |
| FROM_EMAIL          | noreply@...           | Sender address           |
| NOTIFICATION_EMAIL  | (required for email)  | Alert recipient          |

### Frontend Build Args
| Variable       | Default          | Description                               |
|----------------|------------------|-------------------------------------------|
| API_URL        | http://api:4000  | Internal API URL for server-side rewrites |
| STORAGE_URL    | http://supabase-storage:5000 | Internal storage URL          |
| NEXT_PUBLIC_API_URL | (external) | Used for direct browser calls (legacy)   |

---

## 19. Deployment (VPS)

**Server:** `203.161.44.35` (Ubuntu/Debian with Docker)
**App path:** `/opt/WebRegressionApp2.1/`

### Starting / Stopping

```bash
cd /opt/WebRegressionApp2.1

# Start all services
docker compose up -d

# Stop all services
docker compose down

# Rebuild and restart a specific service
docker compose up -d --build worker

# View logs
docker compose logs -f worker
docker compose logs -f api

# Check container health
docker compose ps
```

### Rebuilding after code changes

```bash
# Rebuild worker only (most common)
docker compose up -d --build worker

# Rebuild frontend (required after any client/ changes — API_URL baked at build time)
docker compose up -d --build frontend

# Full rebuild
docker compose up -d --build
```

### Database migrations

```bash
docker compose exec api npx prisma migrate deploy
```

### Accessing services directly

| Service   | URL from VPS host              |
|-----------|-------------------------------|
| App (Nginx)       | http://203.161.44.35         |
| API               | http://203.161.44.35:4000    |
| Frontend (direct) | http://203.161.44.35:3001    |
| PostgreSQL        | localhost:5432 (host-only)   |
| Redis             | localhost:6379 (host-only)   |
| Storage           | localhost:5000 (host-only)   |

### SSH access (Windows with plink)

```
plink -ssh root@203.161.44.35 -pw 39b71PqqF1GpuI8aGT -hostkey SHA256:4Y5F1WlBUWOfuZ3Sb1d1Ex/ob+CUVgXGfQr/BlxailU -batch "<command>"
```

---

## 20. Key Flows End-to-End

### Adding a new website

```
User fills form → POST /api/websites
  → siteDiscovery.crawlWebsite() discovers pages
  → Website + WebsitePage records created
  → ScanConfig created (interval: 20min, threshold: 0.01)
  → Response includes discovered pages
```

### Taking a baseline

```
User clicks "Take Baseline" → POST /api/websites/:id/scans/baseline
  → syncWebsitePages() refreshes page list
  → ScanRun (type: BASELINE, status: PENDING) created
  → BullMQ job enqueued to "baseline" queue
  → Worker picks up job:
      → For each page: takeScreenshot() → upload as baseline.png
      → ScanRun marked COMPLETED
      → scheduleNextScan() queues first auto-scan (delayed by intervalMinutes)
      → pruneOldScans() trims to 20 runs
```

### Running a comparison scan

```
Auto-scan timer fires (or user triggers manually) → scan job dequeued
  → ScanRun (type: SCAN, status: PENDING → RUNNING) 
  → For each page:
      → takeScreenshot() → upload as screenshot/{scanRunId}.png
      → downloadImage(baseline.storageKey) → compareScreenshots()
      → If changes: upload diff/{scanRunId}.png, set hasChanges=true
  → ScanRun marked COMPLETED
  → If changes detected: emailQueue.add() → email sent with PDF
  → scheduleNextScan() queues next scan (delayed by intervalMinutes)
  → pruneOldScans() enforces 20-run limit
```

### Manual scan when auto-scan is pending

```
User clicks "Run Scan" → POST /api/websites/:id/scans/scan
  → Detects existing PENDING scan job (the scheduled auto-scan)
  → Calls scanQueue.getJob("scan-{runId}"), checks state === "delayed"
  → Calls existingJob.promote() to move from delayed → waiting
  → Returns 202 with "Scheduled scan activated and will run now"
  → Worker picks up the promoted job immediately
```

### PDF report download

```
User clicks "Export PDF" → GET /api/websites/:id/scans/:scanId/export
  → Fetches scanRun with all pageResults
  → Fetches images from supabase-storage (internal URL)
  → Builds PDF with PDFKit, embeds images
  → Streams PDF response with Content-Disposition: attachment
```
