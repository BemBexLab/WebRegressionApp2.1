import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "../../../lib/api";
import { StatusBadge, TypeBadge } from "../../../components/StatusBadge";
import WebsiteActions from "../../../components/WebsiteActions";
import PageList from "../../../components/PageList";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
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

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Link href="/websites" className="hover:text-gray-600">Websites</Link>
            <span>/</span>
            <span className="text-gray-700">{website.name}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{website.name}</h1>
          <a
            href={website.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline mt-0.5 inline-block"
          >
            {website.url} ↗
          </a>
        </div>
        <WebsiteActions websiteId={website.id} hasBaseline={hasBaseline} />
      </div>

      {website.scanConfig && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-4 flex gap-6 text-sm">
          <div>
            <span className="text-gray-400">Scan interval</span>
            <span className="ml-2 font-medium text-gray-700">
              Every {website.scanConfig.intervalHours}h
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
              {website.scanConfig.viewportWidth}×{website.scanConfig.viewportHeight}
            </span>
          </div>
          <div>
            <span className="text-gray-400">Auto-scan</span>
            <span className={`ml-2 font-medium ${website.scanConfig.enabled ? "text-green-600" : "text-gray-400"}`}>
              {website.scanConfig.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        </div>
      )}

      <PageList websiteId={website.id} initialPages={website.pages ?? []} />

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
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
                    className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400">
                        {new Date(run.createdAt).toLocaleString()}
                        {run.completedAt && (
                          <> · {Math.round((new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()) / 1000)}s</>
                        )}
                      </p>
                      <p className="text-sm text-gray-600 mt-0.5">
                        {run.pageResults.length} page(s)
                        {changes > 0 && <> · <span className="text-orange-600">{changes} changed</span></>}
                        {failed > 0 && <> · <span className="text-red-600">{failed} failed</span></>}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
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
