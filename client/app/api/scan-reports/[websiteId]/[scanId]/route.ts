import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isValidSessionToken } from "../../../../../lib/auth/shared";

const INTERNAL_API_URL = process.env.API_URL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ websiteId: string; scanId: string }> }
) {
  const cookieStore = await cookies();
  if (!(await isValidSessionToken(cookieStore.get(AUTH_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { websiteId, scanId } = await context.params;

  const response = await fetch(
    `${INTERNAL_API_URL}/api/websites/${websiteId}/scans/${scanId}/export`,
    {
      headers: ADMIN_PASSWORD
        ? { Authorization: `Bearer ${ADMIN_PASSWORD}` }
        : undefined,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return NextResponse.json(
      { error: body.error ?? "Failed to export scan report" },
      { status: response.status }
    );
  }

  const pdfBuffer = await response.arrayBuffer();
  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="scan-report-${scanId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
