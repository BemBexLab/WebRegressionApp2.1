"use client";

import { useEffect, useMemo, useState } from "react";

type NextScanStatus =
  | "SCHEDULED"
  | "RUNNING"
  | "BASELINE_RUNNING"
  | "PAUSED"
  | "UNAVAILABLE";

interface Props {
  nextScanAt?: string | null;
  nextScanStatus?: string | null;
  compact?: boolean;
}

function formatDuration(msRemaining: number): string {
  if (msRemaining <= 0) {
    return "Due now";
  }

  const totalSeconds = Math.floor(msRemaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getStatusLabel(status: NextScanStatus, nextScanAt?: string | null, nowMs?: number): string {
  switch (status) {
    case "RUNNING":
      return "Scan in progress";
    case "BASELINE_RUNNING":
      return "Baseline in progress";
    case "PAUSED":
      return "Scanning paused";
    case "UNAVAILABLE":
      return "Awaiting baseline";
    case "SCHEDULED":
    default:
      if (!nextScanAt) {
        return "Next scan unavailable";
      }

      return `Next scan in ${formatDuration(new Date(nextScanAt).getTime() - (nowMs ?? Date.now()))}`;
  }
}

export default function NextScanTimer({ nextScanAt, nextScanStatus, compact = false }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const status = (nextScanStatus ?? "UNAVAILABLE") as NextScanStatus;
  const label = useMemo(
    () => getStatusLabel(status, nextScanAt, nowMs),
    [nextScanAt, nowMs, status]
  );

  const className = compact
    ? "mt-2 text-xs text-gray-500"
    : "rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800";

  return <p className={className}>{label}</p>;
}
