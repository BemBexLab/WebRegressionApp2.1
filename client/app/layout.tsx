import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import Sidebar from "../components/Sidebar";
import { AUTH_COOKIE_NAME, isValidSessionToken } from "../lib/auth/shared";

export const metadata: Metadata = {
  title: "WebRegression — Visual Regression Testing",
  description: "Monitor your websites for visual changes automatically",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const authenticated = await isValidSessionToken(cookieStore.get(AUTH_COOKIE_NAME)?.value);

  return (
    <html lang="en" className="h-full">
      <body className={authenticated ? "h-full flex" : "min-h-full"}>
        {authenticated ? (
          <>
            <Sidebar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
