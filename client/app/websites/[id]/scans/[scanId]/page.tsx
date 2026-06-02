import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "../../../../../lib/api";
import { normalizeAssetUrl } from "../../../../../lib/media";
import { StatusBadge, TypeBadge } from "../../../../../components/StatusBadge";
import DiffViewer from "../../../../../components/DiffViewer";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string; scanId: string }>;
}

export default async function ScanDetailPage({ params }: Props) {
  const { id, scanId } = await params;

  let scan;
  try {
    scan = await api.scans.get(id, scanId);
  } catch {
    notFound();
  }

  const changedPages = scan.pageResults.filter((r) => r.hasChanges).length;
  const failedPages = scan.pageResults.filter((r) => r.status === "FAILED").length;

  const durationMs =
    scan.completedAt && scan.startedAt
      ? new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()
      : null;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
          <Link href="/websites" className="hover:text-gray-600">Websites</Link>
          <span>/</span>
          <Link href={`/websites/${id}`} className="hover:text-gray-600">Website</Link>
          <span>/</span>
          <span className="text-gray-700">Scan {scan.id.slice(-8)}</span>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Scan Results</h1>
          <TypeBadge type={scan.type} />
          <StatusBadge status={scan.status} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 px-6 py-4 flex flex-wrap gap-6 text-sm">
        <div>
          <span className="text-gray-400">Started</span>
          <span className="ml-2 font-medium text-gray-700">
            {scan.startedAt ? new Date(scan.startedAt).toLocaleString() : "—"}
          </span>
        </div>
        {durationMs !== null && (
          <div>
            <span className="text-gray-400">Duration</span>
            <span className="ml-2 font-medium text-gray-700">{(durationMs / 1000).toFixed(1)}s</span>
          </div>
        )}
        <div>
          <span className="text-gray-400">Pages</span>
          <span className="ml-2 font-medium text-gray-700">{scan.pageResults.length}</span>
        </div>
        {changedPages > 0 && (
          <div>
            <span className="text-gray-400">Changed</span>
            <span className="ml-2 font-medium text-orange-600">{changedPages}</span>
          </div>
        )}
        {failedPages > 0 && (
          <div>
            <span className="text-gray-400">Failed</span>
            <span className="ml-2 font-medium text-red-600">{failedPages}</span>
          </div>
        )}
      </div>

      {scan.error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-700">
          {scan.error}
        </div>
      )}

      <div className="space-y-4">
        {scan.pageResults.map((result) => (
          <div key={result.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {result.page?.name ?? result.page?.url ?? "Unknown page"}
                </p>
                {result.page?.name && (
                  <p className="text-xs text-gray-400 truncate">{result.page.url}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {result.hasChanges && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                    Changes detected
                  </span>
                )}
                <StatusBadge status={result.status} />
              </div>
            </div>

            <div className="px-6 py-5">
              {result.status === "FAILED" && result.error ? (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {result.error}
                </div>
              ) : result.status === "PENDING" || result.status === "RUNNING" ? (
                <div className="text-sm text-gray-400">Processing...</div>
              ) : (
                <DiffViewer
                  baselineUrl={normalizeAssetUrl(result.baselineUrl)}
                  screenshotUrl={normalizeAssetUrl(result.screenshotUrl)}
                  diffUrl={normalizeAssetUrl(result.diffUrl)}
                  diffScore={result.diffScore}
                  diffPixels={result.diffPixels}
                  hasChanges={result.hasChanges}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
