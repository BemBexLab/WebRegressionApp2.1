import Link from "next/link";
import { api } from "../lib/api";
import { StatusBadge, TypeBadge } from "../components/StatusBadge";

export const dynamic = "force-dynamic";

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <p className="text-sm text-gray-500 font-medium">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function getRecentActivityLabel(
  type: "BASELINE" | "SCAN",
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"
): string {
  const subject = type === "BASELINE" ? "Baseline" : "Scan";

  switch (status) {
    case "PENDING":
      return `${subject} pending`;
    case "RUNNING":
      return `${subject} running`;
    case "COMPLETED":
      return `${subject} completed`;
    case "FAILED":
      return `${subject} failed`;
    default:
      return `${subject} updated`;
  }
}

export default async function DashboardPage() {
  let stats;
  let errorMessage = "";
  try {
    stats = await api.stats.get();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unknown API error";
    return (
      <div className="p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700 text-sm">
          <p>
            Dashboard failed to load from {process.env.API_URL ?? "http://localhost:4000"}.
          </p>
          <p className="mt-2 font-medium">{errorMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your visual regression monitoring</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Websites" value={stats.websites} />
        <StatCard label="Pages monitored" value={stats.pages} />
        <StatCard label="Scans run" value={stats.scans.total} sub={`${stats.scans.failed} failed`} />
        <StatCard
          label="Changes detected"
          value={stats.scans.changesDetected}
          sub="across all pages"
        />
      </div>

      {(stats.queues.baseline.waiting > 0 || stats.queues.scan.waiting > 0) && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-5 py-4 text-sm text-blue-700">
          Queue: {stats.queues.baseline.waiting} baseline job(s) waiting ·{" "}
          {stats.queues.scan.waiting} scan job(s) waiting
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Activity</h2>
          <Link href="/websites" className="text-sm text-blue-600 hover:underline">
            View all websites →
          </Link>
        </div>

        {stats.recentActivity.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">
            No scans yet.{" "}
            <Link href="/websites/new" className="text-blue-600 hover:underline">
              Add a website
            </Link>{" "}
            to get started.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {stats.recentActivity.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/websites/${run.websiteId}/scans/${run.id}`}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{run.websiteName}</p>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {getRecentActivityLabel(run.type, run.status)}
                      {run.hasChanges && run.status === "COMPLETED" && (
                        <span className="text-orange-600"> with changes detected</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(run.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <TypeBadge type={run.type} />
                    <StatusBadge status={run.status} />
                    {run.hasChanges && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                        Changes
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
