export const AUTH_COOKIE_NAME = "wr_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getLoginUser(): string {
  return (process.env.LOGIN_USERNAME ?? process.env.LOGIN_USER ?? "admin").trim();
}

function getSessionSecret(): string {
  return (
    process.env.AUTH_SESSION_SECRET ??
    `${getLoginUser()}:${process.env.LOGIN_PASSWORD ?? ""}:${process.env.ADMIN_PASSWORD ?? ""}`
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSessionToken(): Promise<string> {
  return sha256Hex(`${getSessionSecret()}:${getLoginUser()}`);
}

export async function isValidSessionToken(token?: string | null): Promise<boolean> {
  if (!token) {
    return false;
  }

  return token === (await createSessionToken());
}

export function sanitizeNextPath(candidate?: string | null): string {
  if (!candidate || !candidate.startsWith("/")) {
    return "/";
  }

  if (candidate.startsWith("//")) {
    return "/";
  }

  return candidate;
}

