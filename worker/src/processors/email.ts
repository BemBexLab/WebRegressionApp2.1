import { Job } from "bullmq";
import { PrismaClient, EmailNotificationType } from "@prisma/client";
import { createScanPdfBuffer, ScanReportPage } from "../lib/scanReport";
import { buildReportStorageKey, toPublicAppUrl, uploadFile } from "../lib/storage";
import { postToCliq, requireCliqWebhookUrl } from "../lib/cliq";

const prisma = new PrismaClient();

export type EmailJobData =
  | {
      type: "SCAN_COMPLETE" | "VISUAL_CHANGE" | "FAILURE";
      websiteId: string;
      scanRunId: string;
      recipient: string;
      websiteName: string;
      changedPages?: number;
      totalPages?: number;
      error?: string;
      diffThreshold?: number;
      maxDiffScore?: number;
    }
  | {
      type: "DOMAIN_EXPIRY";
      websiteId: string;
      recipient: string;
      websiteName: string;
      domainName: string;
      domainExpiresAt: string;
      daysUntilExpiry: number;
    };

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function getHighestDifference(pages: ScanReportPage[]): string {
  const measuredScores = pages
    .map((page) => page.diffScore)
    .filter((score) => Number.isFinite(score) && score > 0);

  if (measuredScores.length === 0) {
    return "N/A";
  }

  return formatPercent(Math.max(...measuredScores));
}

function buildSubject(
  type: EmailJobData["type"],
  websiteName: string,
  changedPages: number,
  totalPages: number
): string {
  if (type === "DOMAIN_EXPIRY") {
    return `[WebRegression] Domain renewal reminder for ${websiteName}`;
  }

  if (type === "FAILURE") {
    return `[WebRegression] Scan failure for ${websiteName}`;
  }

  if (type === "VISUAL_CHANGE") {
    return `[WebRegression] ${changedPages} page(s) changed on ${websiteName}`;
  }

  return `[WebRegression] Scan completed for ${websiteName} (${totalPages} pages checked)`;
}

function buildCliqTextReport(
  websiteName: string,
  websiteUrl: string,
  runType: "SCAN_COMPLETE" | "VISUAL_CHANGE" | "FAILURE",
  scanRunId: string,
  configuredThreshold: number,
  highestDifference: string,
  changedPages: ScanReportPage[],
  failedPages: ScanReportPage[],
  allPages: ScanReportPage[],
  reportUrl: string
): string {
  const allPagesFailed = allPages.length > 0 && failedPages.length === allPages.length;
  const lines = [
    `Website: ${websiteName}`,
    `Base URL: ${websiteUrl}`,
    `Scan Run: ${scanRunId}`,
    `Configured threshold: ${formatPercent(configuredThreshold)}`,
    `Highest difference: ${highestDifference}`,
    `Changed pages: ${changedPages.length}`,
    `Failed pages: ${failedPages.length}`,
    `Total pages checked: ${allPages.length}`,
    `PDF report: ${reportUrl}`,
  ];

  if (allPagesFailed) {
    lines.push("Status: Website not reachable or all pages failed.");
  } else if (failedPages.length > 0) {
    lines.push("Status: Some pages failed during the run.");
  }

  return lines.join("\n");
}

function toNotificationType(type: EmailJobData["type"]): EmailNotificationType {
  if (type === "DOMAIN_EXPIRY") return "DOMAIN_EXPIRY" as EmailNotificationType;
  if (type === "FAILURE") return "FAILURE";
  if (type === "VISUAL_CHANGE") return "VISUAL_CHANGE";
  return "SCAN_COMPLETE";
}

function buildDomainExpiryText(
  websiteName: string,
  websiteUrl: string,
  domainName: string,
  domainExpiresAt: string,
  daysUntilExpiry: number
): string {
  const dashboardUrl = toPublicAppUrl(`/websites`);
  const expiryDate = new Date(domainExpiresAt).toLocaleString();

  return [
    `Website: ${websiteName}`,
    `Base URL: ${websiteUrl}`,
    `Domain: ${domainName}`,
    `Expires on: ${expiryDate}`,
    `Renewal window: ${daysUntilExpiry} day(s) remaining`,
    `Dashboard: ${dashboardUrl}`,
    `Action: Renew the domain before it expires.`,
  ].join("\n");
}

export async function processEmail(job: Job<EmailJobData>): Promise<void> {
  const { websiteId, websiteName, type } = job.data;

  if (type === "DOMAIN_EXPIRY") {
    const website = await prisma.website.findUnique({
      where: { id: websiteId },
      select: { url: true },
    });

    if (!website) {
      throw new Error(`Website context missing for domain expiry alert on ${websiteId}`);
    }

    const subject = buildSubject(type, websiteName, 0, 0);
    const text = buildDomainExpiryText(
      websiteName,
      website.url,
      job.data.domainName,
      job.data.domainExpiresAt,
      job.data.daysUntilExpiry
    );

    const notification = await prisma.emailNotification.create({
      data: {
        websiteId,
        type: toNotificationType(type),
        recipient: "zoho-cliq",
        subject,
        status: "PENDING",
      },
    });

    try {
      await postToCliq(requireCliqWebhookUrl(), text);

      await prisma.emailNotification.update({
        where: { id: notification.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.emailNotification.update({
        where: { id: notification.id },
        data: {
          status: "FAILED",
          error: message,
        },
      });

      throw error;
    }

    return;
  }

  const { scanRunId } = job.data;

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { url: true, scanConfig: { select: { threshold: true } } },
  });

  const scanRun = await prisma.scanRun.findUnique({
    where: { id: scanRunId },
    include: {
      pageResults: {
        orderBy: { createdAt: "asc" },
        include: {
          page: { select: { name: true, url: true } },
        },
      },
    },
  });

  if (!scanRun || !website) {
    throw new Error(`Scan report context missing for scan run ${scanRunId}`);
  }

  const threshold = website.scanConfig?.threshold ?? 0.3;
  const allPages: ScanReportPage[] = scanRun.pageResults.map((result) => ({
    name: result.page.name ?? result.page.url,
    url: result.page.url,
    status: result.status,
    hasChanges: result.hasChanges,
    diffScore: result.diffScore ?? 0,
    diffPixels: result.diffPixels ?? 0,
    diffUrl: result.diffUrl,
    screenshotUrl: result.screenshotUrl,
    baselineUrl: result.baselineUrl,
    note: result.error,
  }));

  const changedPages = allPages.filter((page) => page.hasChanges);
  const failedPages = allPages.filter((page) => page.status === "FAILED");
  const highestDifference = getHighestDifference(allPages);
  const subject = buildSubject(type, websiteName, changedPages.length, allPages.length);
  const pdfBuffer = await createScanPdfBuffer({
    websiteName,
    websiteUrl: website.url,
    scanRunId,
    threshold,
    changedPages,
    failedPages,
    allPages,
  });
  const reportStorageKey = buildReportStorageKey(websiteId, scanRunId);
  const reportPath = await uploadFile(reportStorageKey, pdfBuffer, "application/pdf");
  const reportUrl = toPublicAppUrl(reportPath);
  const text = buildCliqTextReport(
    websiteName,
    website.url,
    type,
    scanRunId,
    threshold,
    highestDifference,
    changedPages,
    failedPages,
    allPages,
    reportUrl
  );

  const notification = await prisma.emailNotification.create({
    data: {
      websiteId,
      scanRunId,
      type: toNotificationType(type),
      recipient: "zoho-cliq",
      subject,
      status: "PENDING",
    },
  });

  try {
    await postToCliq(requireCliqWebhookUrl(), text);

    await prisma.emailNotification.update({
      where: { id: notification.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.emailNotification.update({
      where: { id: notification.id },
      data: {
        status: "FAILED",
        error: message,
      },
    });

    throw error;
  }
}
