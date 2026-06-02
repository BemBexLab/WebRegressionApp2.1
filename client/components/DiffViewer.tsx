"use client";

import { useState } from "react";

type ViewMode = "baseline" | "latest" | "diff" | "side";

interface Props {
  baselineUrl: string | null;
  screenshotUrl: string | null;
  diffUrl: string | null;
  diffScore: number | null;
  diffPixels: number | null;
  hasChanges: boolean;
}

export default function DiffViewer({
  baselineUrl,
  screenshotUrl,
  diffUrl,
  diffScore,
  diffPixels,
  hasChanges,
}: Props) {
  const [mode, setMode] = useState<ViewMode>(hasChanges ? "diff" : "latest");

  const tabs: { id: ViewMode; label: string; available: boolean }[] = [
    { id: "baseline", label: "Baseline", available: !!baselineUrl },
    { id: "latest", label: "Latest", available: !!screenshotUrl },
    { id: "diff", label: "Diff", available: !!diffUrl },
    { id: "side", label: "Side by Side", available: !!(baselineUrl && screenshotUrl) },
  ];

  function getImageUrl(): string | null {
    switch (mode) {
      case "baseline":
        return baselineUrl;
      case "latest":
        return screenshotUrl;
      case "diff":
        return diffUrl;
      default:
        return screenshotUrl;
    }
  }

  function renderImage(url: string, alt: string) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400">{alt}</p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900"
          >
            Open full image
          </a>
        </div>
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
          <img src={url} alt={alt} className="block h-auto w-full rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-gray-200">
          {tabs
            .filter((t) => t.available)
            .map((tab) => (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === tab.id ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
        </div>
        {diffScore !== null && (
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${
              hasChanges ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
            }`}
          >
            {(diffScore * 100).toFixed(2)}% diff
            {diffPixels !== null && ` · ${diffPixels.toLocaleString()} px`}
          </span>
        )}
      </div>

      {mode === "side" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            {baselineUrl ? (
              renderImage(baselineUrl, "Baseline")
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-gray-200 text-xs text-gray-400">
                No baseline
              </div>
            )}
          </div>
          <div>
            {screenshotUrl ? (
              renderImage(screenshotUrl, "Latest")
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-gray-200 text-xs text-gray-400">
                No screenshot
              </div>
            )}
          </div>
        </div>
      ) : getImageUrl() ? (
        renderImage(getImageUrl()!, mode)
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-gray-200 text-sm text-gray-400">
          No image available
        </div>
      )}
    </div>
  );
}
