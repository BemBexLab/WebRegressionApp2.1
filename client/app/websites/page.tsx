import Link from "next/link";
import { api } from "../../lib/api";
import { Website } from "../../lib/types";
import { StatusBadge } from "../../components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function WebsitesPage() {
  let websites: Website[] = [];
  try {
    websites = await api.websites.list();
  } catch {
    websites = [];
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Websites</h1>
          <p className="text-sm text-gray-500 mt-1">{websites.length} website(s) monitored</p>
        </div>
        <Link
          href="/websites/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          + Add Website
        </Link>
      </div>

      {websites.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-16 text-center">
          <p className="text-gray-500 text-sm">No websites yet.</p>
          <Link
            href="/websites/new"
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Add your first website
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {websites.map((site) => (
            <Link
              key={site.id}
              href={`/websites/${site.id}`}
              className="bg-white rounded-xl border border-gray-200 p-6 hover:border-gray-400 transition-colors block"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-gray-900 truncate">{site.name}</h2>
                  <p className="text-sm text-gray-400 truncate mt-0.5">{site.url}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400">{site.pageCount} page(s)</span>
                  {site.lastScan ? (
                    <StatusBadge status={site.lastScan.status} />
                  ) : (
                    <span className="text-xs text-gray-400">No scans</span>
                  )}
                </div>
              </div>
              {site.lastScan && (
                <p className="text-xs text-gray-400 mt-3">
                  Last scan: {new Date(site.lastScan.createdAt).toLocaleString()}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
