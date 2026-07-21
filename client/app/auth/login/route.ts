import { NextRequest, NextResponse } from "next/server";
import { verifyLoginCredentials } from "../../../lib/auth/credentials";
import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  sanitizeNextPath,
  SESSION_MAX_AGE_SECONDS,
} from "../../../lib/auth/shared";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeNextPath(String(formData.get("next") ?? "/"));

  if (!(await verifyLoginCredentials(username, password))) {
    const loginUrl = new URL("/login", "http://local");
    loginUrl.searchParams.set("error", "invalid");
    if (nextPath !== "/") {
      loginUrl.searchParams.set("next", nextPath);
    }
    return new NextResponse(null, {
      status: 303,
      headers: { location: `${loginUrl.pathname}${loginUrl.search}` },
    });
  }

  const response = new NextResponse(null, {
    status: 303,
    headers: { location: nextPath },
  });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: await createSessionToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
