import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "../../../lib/auth/shared";

export async function POST(request: NextRequest) {
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: "/login" },
  });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    expires: new Date(0),
    path: "/",
  });
  return response;
}
