import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isValidSessionToken, sanitizeNextPath } from "./lib/auth/shared";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/storage/") ||
    pathname.startsWith("/app-api/")
  );
}

export async function proxy(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const authenticated = await isValidSessionToken(token);

  if (pathname === "/login") {
    if (authenticated) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  if (!authenticated && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", sanitizeNextPath(`${pathname}${search}`));
    return NextResponse.redirect(loginUrl);
  }

  if (!pathname.startsWith("/api/") || !adminPassword) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Authorization", `Bearer ${adminPassword}`);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: "/:path*",
};
