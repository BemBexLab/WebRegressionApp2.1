import { ScanStatus, ScanType } from "../lib/types";

const statusStyles: Record<ScanStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  RUNNING: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

const typeStyles: Record<ScanType, string> = {
  BASELINE: "bg-purple-100 text-purple-800",
  SCAN: "bg-gray-100 text-gray-700",
};

export function StatusBadge({ status }: { status: ScanStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusStyles[status]}`}>
      {status === "RUNNING" && (
        <span className="mr-1 inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
      {status}
    </span>
  );
}

export function TypeBadge({ type }: { type: ScanType }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeStyles[type]}`}>
      {type}
    </span>
  );
}
