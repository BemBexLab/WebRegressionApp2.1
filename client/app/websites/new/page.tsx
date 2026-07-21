"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";

export default function NewWebsitePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [homepageOnly, setHomepageOnly] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const site = await api.websites.create({ name, url, homepageOnly });
      router.push(`/websites/${site.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create website");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add Website</h1>
        <p className="text-sm text-gray-500 mt-1">
          Add a website and the app will crawl its internal pages for visual monitoring
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="My Website"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="https://example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <p className="mt-2 text-xs text-gray-400">
            We will crawl this site, save the pages we discover, and scan them for visual changes.
          </p>
        </div>

        <div>
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative mt-0.5">
              <input
                type="checkbox"
                checked={homepageOnly}
                onChange={(e) => setHomepageOnly(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-4 h-4 border-2 border-gray-300 rounded peer-checked:bg-gray-900 peer-checked:border-gray-900 group-hover:border-gray-400 transition-colors flex items-center justify-center">
                {homepageOnly && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M1 4l2.5 2.5L9 1" />
                  </svg>
                )}
              </div>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-700">Homepage only</span>
              <p className="text-xs text-gray-400 mt-0.5">
                Skip crawling — scan only the root URL of this website.
              </p>
            </div>
          </label>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Creating..." : "Create Website"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
