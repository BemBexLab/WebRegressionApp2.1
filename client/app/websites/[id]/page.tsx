import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "../../../lib/api";
import NextScanTimer from "../../../components/NextScanTimer";
import { StatusBadge, TypeBadge } from "../../../components/StatusBadge";
import WebsiteActions from "../../../components/WebsiteActions";
import PageList from "../../../components/PageList";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  return new Date(value).toLocaleString();
}

function getExpiryWarning(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;

  const diffMs = new Date(expiresAt).getTime() - Date.now();
  const daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

  if (daysRemaining < 0) return "Domain expiry date has passed.";
  if (daysRemaining <= 7) return `Renew soon: ${daysRemaining} day(s) remaining.`;
  return null;
}

export default async function WebsitePage({ params }: Props) {
  const { id } = await params;

  let website;
  try {
    website = await api.websites.get(id);
  } catch {
    notFound();
  }

  const hasBaseline = (website.pages ?? []).some(
    (p) => p.baselineImages && p.baselineImages.length > 0
  );
  const isPaused = !(website.scanConfig?.enabled ?? true);
  const expiryWarning = getExpiryWarning(website.domainExpiresAt);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm text-gray-400">
            <Link href="/websites" className="hover:text-gray-600">
              Websites
            </Link>
            <span>/</span>
            <span className="text-gray-700">{website.name}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{website.name}</h1>
          <a
            href={website.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-block text-sm text-blue-600 hover:underline"
          >
            {website.url} {"->"}
          </a>
          <div className="mt-3 max-w-sm">
            <NextScanTimer
              nextScanAt={website.nextScanAt}
              nextScanStatus={website.nextScanStatus}
            />
          </div>
        </div>
        <WebsiteActions websiteId={website.id} hasBaseline={hasBaseline} isPaused={isPaused} />
      </div>

      {website.scanConfig && (
        <div className="flex gap-6 rounded-xl border border-gray-200 bg-white px-6 py-4 text-sm">
          <div>
            <span className="text-gray-400">Scan interval</span>
            <span className="ml-2 font-medium text-gray-700">
              Every {website.scanConfig.intervalMinutes}m
            </span>
          </div>
          <div>
            <span className="text-gray-400">Diff threshold</span>
            <span className="ml-2 font-medium text-gray-700">
              {(website.scanConfig.threshold * 100).toFixed(1)}%
            </span>
          </div>
          <div>
            <span className="text-gray-400">Viewport</span>
            <span className="ml-2 font-medium text-gray-700">
              {website.scanConfig.viewportWidth}x{website.scanConfig.viewportHeight}
            </span>
          </div>
          <div>
            <span className="text-gray-400">Scan status</span>
            <span
              className={`ml-2 font-medium ${
                website.scanConfig.enabled ? "text-green-600" : "text-amber-600"
              }`}
            >
              {website.scanConfig.enabled ? "Active" : "Paused"}
            </span>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-900">Domain Lifecycle</h2>
        <div className="mt-3 grid gap-3 text-sm text-gray-600 md:grid-cols-2">
          <div>
            <span className="text-gray-400">Domain</span>
            <p className="font-medium text-gray-800">
              {website.domainName ?? new URL(website.url).hostname}
            </p>
          </div>
          <div>
            <span className="text-gray-400">Purchased / Registered</span>
            <p className="font-medium text-gray-800">{formatDate(website.domainRegisteredAt)}</p>
          </div>
          <div>
            <span className="text-gray-400">Expires</span>
            <p className="font-medium text-gray-800">{formatDate(website.domainExpiresAt)}</p>
          </div>
          <div>
            <span className="text-gray-400">Last checked</span>
            <p className="font-medium text-gray-800">{formatDate(website.domainLastCheckedAt)}</p>
          </div>
        </div>
        {expiryWarning && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {expiryWarning}
          </p>
        )}
        {website.domainCheckError && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Domain lookup note: {website.domainCheckError}
          </p>
        )}
      </div>

      <PageList websiteId={website.id} initialPages={website.pages ?? []} />

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-gray-900">Recent Scans</h2>
        </div>

        {!website.scanRuns || website.scanRuns.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            No scans yet. Create a baseline to get started.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {website.scanRuns.map((run) => {
              const changes = run.pageResults.filter((r) => r.hasChanges).length;
              const failed = run.pageResults.filter((r) => r.status === "FAILED").length;
              return (
                <li key={run.id}>
                  <Link
                    href={`/websites/${website.id}/scans/${run.id}`}
                    className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-400">
                        {new Date(run.createdAt).toLocaleString()}
                        {run.completedAt && (
                          <> {"·"}{" "}
                            {Math.round(
                              (new Date(run.completedAt).getTime() -
                                new Date(run.createdAt).getTime()) /
                                1000
                            )}
                            s
                          </>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-600">
                        {run.pageResults.length} page(s)
                        {changes > 0 && (
                          <>
                            {" · "}
                            <span className="text-orange-600">{changes} changed</span>
                          </>
                        )}
                        {failed > 0 && (
                          <>
                            {" · "}
                            <span className="text-red-600">{failed} failed</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 flex gap-2">
                      <TypeBadge type={run.type} />
                      <StatusBadge status={run.status} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
