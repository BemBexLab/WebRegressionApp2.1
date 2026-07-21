import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import { resolveDomainLifecycle } from "./domainLifecycle";
import { EmailJobData } from "../processors/email";

const DOMAIN_EXPIRY_ALERT_WINDOW_DAYS = 7;
const DOMAIN_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type WebsiteDomainRow = {
  id: string;
  name: string;
  url: string;
  domainName: string | null;
  domainExpiryAlertDays: number | null;
  domainExpiryAlertedAt: Date | null;
};

function buildWebsiteDomainUpdate(data: {
  domainName?: string | null;
  domainRegisteredAt?: Date | null;
  domainExpiresAt?: Date | null;
  domainLastCheckedAt: Date;
  domainCheckError: string | null;
  domainExpiryAlertDays?: number | null;
  domainExpiryAlertedAt?: Date | null;
}): Record<string, Date | number | string | null> {
  return {
    ...(data.domainName !== undefined ? { domainName: data.domainName } : {}),
    ...(data.domainRegisteredAt !== undefined
      ? { domainRegisteredAt: data.domainRegisteredAt }
      : {}),
    ...(data.domainExpiresAt !== undefined ? { domainExpiresAt: data.domainExpiresAt } : {}),
    domainLastCheckedAt: data.domainLastCheckedAt,
    domainCheckError: data.domainCheckError,
    ...(data.domainExpiryAlertDays !== undefined
      ? { domainExpiryAlertDays: data.domainExpiryAlertDays }
      : {}),
    ...(data.domainExpiryAlertedAt !== undefined
      ? { domainExpiryAlertedAt: data.domainExpiryAlertedAt }
      : {}),
  };
}

function getDaysUntilExpiry(expiresAt: Date, now = new Date()): number {
  const diffMs = expiresAt.getTime() - now.getTime();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

async function queueDomainExpiryAlert(
  emailQueue: Queue,
  website: WebsiteDomainRow,
  domainName: string,
  expiresAt: Date,
  daysUntilExpiry: number
): Promise<void> {
  const job: EmailJobData = {
    type: "DOMAIN_EXPIRY",
    websiteId: website.id,
    recipient: "zoho-cliq",
    websiteName: website.name,
    domainName,
    domainExpiresAt: expiresAt.toISOString(),
    daysUntilExpiry,
  };

  await emailQueue.add("email", job, {
    jobId: `domain-expiry-${website.id}-${daysUntilExpiry}`,
  });
}

export async function refreshAllWebsiteDomains(
  prisma: PrismaClient,
  emailQueue: Queue
): Promise<void> {
  const websites = (await prisma.website.findMany({
    select: {
      id: true,
      name: true,
      url: true,
      domainName: true,
      domainExpiryAlertDays: true,
      domainExpiryAlertedAt: true,
    },
    orderBy: { createdAt: "asc" },
  } as never)) as unknown as WebsiteDomainRow[];

  for (const website of websites) {
    const checkedAt = new Date();

    try {
      const domain = await resolveDomainLifecycle(website.url);
      const daysUntilExpiry = domain.expiresAt ? getDaysUntilExpiry(domain.expiresAt, checkedAt) : null;
      const shouldAlert =
        daysUntilExpiry !== null &&
        daysUntilExpiry >= 0 &&
        daysUntilExpiry <= DOMAIN_EXPIRY_ALERT_WINDOW_DAYS &&
        website.domainExpiryAlertDays !== daysUntilExpiry;

      await prisma.website.update({
        where: { id: website.id },
        data: buildWebsiteDomainUpdate({
          domainName: domain.domainName,
          domainRegisteredAt: domain.registeredAt,
          domainExpiresAt: domain.expiresAt,
          domainLastCheckedAt: checkedAt,
          domainCheckError: null,
          domainExpiryAlertDays:
            daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= DOMAIN_EXPIRY_ALERT_WINDOW_DAYS
              ? daysUntilExpiry
              : null,
          domainExpiryAlertedAt:
            daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= DOMAIN_EXPIRY_ALERT_WINDOW_DAYS
              ? checkedAt
              : null,
        }) as never,
      } as never);

      if (shouldAlert && domain.expiresAt) {
        await queueDomainExpiryAlert(
          emailQueue,
          website,
          domain.domainName,
          domain.expiresAt,
          daysUntilExpiry
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Domain registration lookup failed";
      await prisma.website.update({
        where: { id: website.id },
        data: buildWebsiteDomainUpdate({
          domainLastCheckedAt: checkedAt,
          domainCheckError: message,
        }) as never,
      } as never);
    }
  }
}

export function getDomainCheckIntervalMs(): number {
  return DOMAIN_CHECK_INTERVAL_MS;
}
