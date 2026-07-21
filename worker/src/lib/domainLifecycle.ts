const RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const DOMAIN_LOOKUP_TIMEOUT_MS = parseInt(process.env.DOMAIN_LOOKUP_TIMEOUT_MS ?? "15000", 10);

type BootstrapRegistry = {
  services?: Array<[string[], string[]]>;
};

type RdapEvent = {
  eventAction?: string;
  eventDate?: string;
};

type RdapDomainResponse = {
  objectClassName?: string;
  ldhName?: string;
  unicodeName?: string;
  events?: RdapEvent[];
};

export type DomainLifecycle = {
  domainName: string;
  registeredAt: Date | null;
  expiresAt: Date | null;
};

let bootstrapCache: { fetchedAt: number; data: BootstrapRegistry } | null = null;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeHostname(websiteUrl: string): string {
  const hostname = new URL(websiteUrl).hostname.trim().toLowerCase().replace(/\.+$/, "");
  return hostname;
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function getDomainCandidates(hostname: string): string[] {
  const labels = hostname.split(".").filter(Boolean);
  const candidates: string[] = [];

  for (let index = 0; index <= labels.length - 2; index += 1) {
    candidates.push(labels.slice(index).join("."));
  }

  return candidates;
}

async function getBootstrapRegistry(): Promise<BootstrapRegistry> {
  const now = Date.now();
  if (bootstrapCache && now - bootstrapCache.fetchedAt < 24 * 60 * 60 * 1000) {
    return bootstrapCache.data;
  }

  const response = await fetch(RDAP_BOOTSTRAP_URL, {
    signal: AbortSignal.timeout(DOMAIN_LOOKUP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`RDAP bootstrap lookup failed (${response.status})`);
  }

  const data = (await response.json()) as BootstrapRegistry;
  bootstrapCache = { fetchedAt: now, data };
  return data;
}

async function getRdapBaseUrl(domain: string): Promise<string | null> {
  const registry = await getBootstrapRegistry();
  const services = registry.services ?? [];
  const domainLabels = domain.split(".");

  let bestMatchLength = -1;
  let bestUrl: string | null = null;

  for (const [suffixes, urls] of services) {
    for (const suffix of suffixes) {
      const suffixLabels = suffix.toLowerCase().split(".");
      const matches =
        domainLabels.length >= suffixLabels.length &&
        domainLabels.slice(-suffixLabels.length).join(".") === suffix.toLowerCase();

      if (!matches || suffixLabels.length <= bestMatchLength) continue;

      bestMatchLength = suffixLabels.length;
      bestUrl = urls[0] ?? null;
    }
  }

  return bestUrl ? `${trimTrailingSlash(bestUrl)}/` : null;
}

async function fetchRdapDomain(domain: string): Promise<RdapDomainResponse | null> {
  const baseUrl = await getRdapBaseUrl(domain);
  if (!baseUrl) return null;

  const response = await fetch(new URL(`domain/${encodeURIComponent(domain)}`, baseUrl), {
    headers: { accept: "application/rdap+json, application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(DOMAIN_LOOKUP_TIMEOUT_MS),
  });

  if (!response.ok) {
    if ([400, 404].includes(response.status)) {
      return null;
    }

    throw new Error(`RDAP domain lookup failed (${response.status})`);
  }

  return (await response.json()) as RdapDomainResponse;
}

function pickEventDate(events: RdapEvent[] | undefined, actions: string[]): Date | null {
  for (const action of actions) {
    const match = events?.find(
      (event) => event.eventAction?.toLowerCase() === action.toLowerCase()
    );

    const parsed = parseDate(match?.eventDate);
    if (parsed) return parsed;
  }

  return null;
}

export async function resolveDomainLifecycle(websiteUrl: string): Promise<DomainLifecycle> {
  const hostname = normalizeHostname(websiteUrl);

  if (!hostname || hostname === "localhost" || hostname === "0.0.0.0" || isIpAddress(hostname)) {
    throw new Error("Domain registration data is unavailable for local or IP-based hosts");
  }

  const candidates = getDomainCandidates(hostname);

  for (const candidate of candidates) {
    const rdap = await fetchRdapDomain(candidate);
    if (!rdap || rdap.objectClassName !== "domain") {
      continue;
    }

    const registeredAt = pickEventDate(rdap.events, ["registration", "reregistration"]);
    const expiresAt = pickEventDate(rdap.events, ["expiration", "registrar expiration"]);

    return {
      domainName: rdap.ldhName?.toLowerCase() ?? rdap.unicodeName ?? candidate,
      registeredAt,
      expiresAt,
    };
  }

  throw new Error("Unable to resolve RDAP domain registration data for this website");
}
