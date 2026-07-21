"use client";

import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const next = searchParams.get("next") ?? "/";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#dbeafe,_#f8fafc_45%,_#e5e7eb_100%)] px-6 py-12">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.16)] lg:grid-cols-[1.1fr_0.9fr]">
          <section className="hidden bg-slate-950 px-10 py-12 text-white lg:flex lg:flex-col lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.28em] text-sky-300">WebRegression</p>
              <h1 className="mt-5 max-w-sm text-4xl font-semibold leading-tight">
                Sign in to monitor site changes without exposing the dashboard.
              </h1>
              <p className="mt-5 max-w-md text-sm leading-6 text-slate-300">
                Your session stays in a secure HTTP-only cookie, and the app proxies protected
                requests server-side after login.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <p className="text-sm font-medium text-white">Protected workflow</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Login gates the dashboard, websites, scans, PDF exports, and browser-side actions.
              </p>
            </div>
          </section>

          <section className="px-6 py-10 sm:px-10">
            <div className="mx-auto max-w-md">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-700 lg:hidden">
                  WebRegression
                </p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-950">Login</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Enter the credentials configured in your environment file.
                </p>
              </div>

              <form action="/auth/login" method="post" className="mt-8 space-y-5">
                <input type="hidden" name="next" value={next} />

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Username</span>
                  <input
                    name="username"
                    type="text"
                    autoComplete="username"
                    required
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  />
                </label>

                {error && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    Invalid username or password.
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Sign in
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

