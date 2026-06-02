"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";
import { WebsitePage } from "../lib/types";
import AddPageForm from "./AddPageForm";

interface Props {
  websiteId: string;
  initialPages: WebsitePage[];
}

export default function PageList({ websiteId, initialPages }: Props) {
  const router = useRouter();
  const [pages, setPages] = useState<WebsitePage[]>(initialPages);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function deletePage(pageId: string) {
    setDeleting(pageId);
    try {
      await api.pages.delete(websiteId, pageId);
      setPages((prev) => prev.filter((p) => p.id !== pageId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete page");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Pages ({pages.length})</h2>
        <AddPageForm
          websiteId={websiteId}
          onAdded={(page) => {
            setPages((prev) => [...prev, page]);
            router.refresh();
          }}
        />
      </div>

      {pages.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400">
          No pages discovered yet. Run a baseline or add a page manually to start monitoring.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {pages.map((page) => {
            const baseline = page.baselineImages?.[0];
            return (
              <li key={page.id} className="flex items-center gap-4 px-6 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {page.name ?? page.url}
                  </p>
                  {page.name && (
                    <p className="text-xs text-gray-400 truncate">{page.url}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {baseline ? (
                    <span className="text-xs text-green-600 font-medium">✓ Baseline</span>
                  ) : (
                    <span className="text-xs text-gray-400">No baseline</span>
                  )}
                  <button
                    onClick={() => deletePage(page.id)}
                    disabled={deleting === page.id}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {deleting === page.id ? "..." : "Remove"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
