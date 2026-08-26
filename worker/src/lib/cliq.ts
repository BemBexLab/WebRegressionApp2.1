import { toPublicAppUrl } from "./storage";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalOrigin(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();

    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

function isPublicOrigin(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();

    if (isLocalOrigin(candidate) || host.endsWith(".local")) {
      return false;
    }

    if (!host.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function normalizeDashboardOrigin(origin: string): string {
  const parsed = new URL(origin);

  if (!parsed.port) {
    parsed.port = "3001";
  }

  return `${trimTrailingSlash(parsed.toString())}/`;
}

function getDashboardUrl(): string {
  const configuredPublicUrl = process.env.PUBLIC_APP_URL?.trim();
  if (configuredPublicUrl) {
    return normalizeDashboardOrigin(configuredPublicUrl);
  }

  const configuredOrigins = (process.env.FRONTEND_URL ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const preferredOrigin =
    configuredOrigins.find((origin) => {
      try {
        const parsed = new URL(origin);
        return isPublicOrigin(origin) && parsed.port === "3001";
      } catch {
        return false;
      }
    }) ??
    configuredOrigins.find((origin) => {
      try {
        const parsed = new URL(origin);
        return isLocalOrigin(origin) && parsed.port === "3001";
      } catch {
        return false;
      }
    }) ??
    configuredOrigins.find((origin) => isPublicOrigin(origin)) ??
    configuredOrigins.find((origin) => isLocalOrigin(origin)) ??
    configuredOrigins[0];

  if (preferredOrigin) {
    return normalizeDashboardOrigin(preferredOrigin);
  }

  return `${trimTrailingSlash(toPublicAppUrl("/"))}/`;
}

function formatStartupTimestamp(startedAt: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(startedAt) + " UTC";
}

function formatReason(reason: string): string {
  return reason
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getCliqWebhookUrl(): string | null {
  const webhookUrl = process.env.CLIQ_WEBHOOK_URL?.trim();
  return webhookUrl ? webhookUrl : null;
}

export function requireCliqWebhookUrl(): string {
  const webhookUrl = getCliqWebhookUrl();
  if (!webhookUrl) {
    throw new Error("Zoho Cliq is not configured. Set CLIQ_WEBHOOK_URL.");
  }

  return webhookUrl;
}

export function buildStartupAlertText(startedAt = new Date()): string {
  const dashboardUrl = getDashboardUrl();

  return [
    "WebRegression is up and running.",
    `Started at: ${formatStartupTimestamp(startedAt)}`,
    `Dashboard: ${dashboardUrl}`,
    "Status: Workers are online and auto-scan scheduling is active.",
  ].join("\n");
}

export function buildShutdownAlertText(reason: string, stoppedAt = new Date()): string {
  const dashboardUrl = getDashboardUrl();

  return [
    "WebRegression is shutting down.",
    `Stopped at: ${formatStartupTimestamp(stoppedAt)}`,
    `Dashboard: ${dashboardUrl}`,
    `Reason: ${formatReason(reason)}`,
  ].join("\n");
}

export async function postToCliq(webhookUrl: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Cliq webhook failed (${response.status}): ${details.slice(0, 500)}`);
  }
}
