"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";

interface Props {
  websiteId: string;
  hasBaseline: boolean;
  isPaused: boolean;
}

export default function WebsiteActions({ websiteId, hasBaseline, isPaused }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"baseline" | "scan" | "pause" | "resume" | "delete" | null>(null);
  const [error, setError] = useState("");

  async function trigger(type: "baseline" | "scan") {
    setError("");
    setLoading(type);
    try {
      if (type === "baseline") {
        await api.scans.triggerBaseline(websiteId);
      } else {
        await api.scans.triggerScan(websiteId);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  async function togglePause() {
    setError("");
    setLoading(isPaused ? "resume" : "pause");

    try {
      if (isPaused) {
        await api.websites.resume(websiteId);
      } else {
        await api.websites.pause(websiteId);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update scanning state");
    } finally {
      setLoading(null);
    }
  }

  async function removeWebsite() {
    const confirmed = window.confirm(
      "Delete this website and all of its pages, baselines, and scan history?"
    );
    if (!confirmed) return;

    setError("");
    setLoading("delete");

    try {
      await api.websites.delete(websiteId);
      router.push("/websites");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete website");
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => trigger("baseline")}
          disabled={!!loading || isPaused}
          className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {loading === "baseline" ? "Queuing..." : "Create Baseline"}
        </button>
        {hasBaseline && (
          <button
            onClick={() => trigger("scan")}
            disabled={!!loading || isPaused}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {loading === "scan" ? "Queuing..." : "Run Scan"}
          </button>
        )}
        <button
          onClick={togglePause}
          disabled={!!loading}
          className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${
            isPaused
              ? "bg-green-600 text-white hover:bg-green-700"
              : "border border-amber-200 text-amber-700 hover:bg-amber-50"
          }`}
        >
          {loading === "pause"
            ? "Pausing..."
            : loading === "resume"
              ? "Resuming..."
              : isPaused
                ? "Resume Scans"
                : "Pause Scans"}
        </button>
        <button
          onClick={removeWebsite}
          disabled={!!loading}
          className="px-4 py-2 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
        >
          {loading === "delete" ? "Deleting..." : "Delete Website"}
        </button>
      </div>
      {isPaused && <p className="text-sm text-amber-700">Scanning is paused for this website.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
