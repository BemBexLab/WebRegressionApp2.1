import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  if (!adminPassword) return NextResponse.next();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Authorization", `Bearer ${adminPassword}`);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: "/api/:path*",
};
