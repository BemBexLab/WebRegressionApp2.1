import { Job } from "bullmq";
import { PrismaClient, EmailNotificationType } from "@prisma/client";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";

const prisma = new PrismaClient();

export type EmailJobData = {
  type: "SCAN_COMPLETE" | "VISUAL_CHANGE" | "FAILURE";
  websiteId: string;
  scanRunId: string;
  recipient: string;
  websiteName: string;
  changedPages?: number;
  totalPages?: number;
  error?: string;
};

type ScanPageSummary = {
  name: string;
  url: string;
  status: string;
  hasChanges: boolean;
  diffScore: number;
  diffPixels: number;
  diffUrl: string | null;
  screenshotUrl: string | null;
  baselineUrl: string | null;
  note: string | null;
};

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.");
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true",
    auth: { user, pass },
  });
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatChangeType(page: ScanPageSummary): string {
  if (page.note?.includes("New page discovered")) return "New page detected";
  if (page.hasChanges) return "Visual difference detected";
  if (page.status === "FAILED") return "Scan failed";
  return "No significant change";
}

function buildSubject(
  type: EmailJobData["type"],
  websiteName: string,
  changedPages: number,
  totalPages: number
): string {
  if (type === "FAILURE") {
    return `[WebRegression] Scan failure for ${websiteName}`;
  }

  if (type === "VISUAL_CHANGE") {
    return `[WebRegression] ${changedPages} page(s) changed on ${websiteName}`;
  }

  return `[WebRegression] Scan completed for ${websiteName} (${totalPages} pages checked)`;
}

function buildTextReport(
  websiteName: string,
  websiteUrl: string,
  scanRunId: string,
  threshold: number,
  changedPages: ScanPageSummary[],
  failedPages: ScanPageSummary[],
  allPages: ScanPageSummary[]
): string {
  const lines = [
    `Website: ${websiteName}`,
    `Base URL: ${websiteUrl}`,
    `Scan Run: ${scanRunId}`,
    `Threshold: ${formatPercent(threshold)}`,
    `Changed pages: ${changedPages.length}`,
    `Failed pages: ${failedPages.length}`,
    `Total pages checked: ${allPages.length}`,
    "",
    "Changed pages:",
  ];

  if (changedPages.length === 0) {
    lines.push("None");
  } else {
    for (const page of changedPages) {
      lines.push(
        `- ${page.name} | ${page.url} | ${formatChangeType(page)} | diff ${formatPercent(page.diffScore)} | pixels ${page.diffPixels}`
      );
      if (page.diffUrl) lines.push(`  Diff image: ${page.diffUrl}`);
    }
  }

  if (failedPages.length > 0) {
    lines.push("", "Failed pages:");
    for (const page of failedPages) {
      lines.push(`- ${page.name} | ${page.url} | ${page.note ?? "Scan failed"}`);
    }
  }

  return lines.join("\n");
}

function buildHtmlReport(
  websiteName: string,
  websiteUrl: string,
  scanRunId: string,
  threshold: number,
  changedPages: ScanPageSummary[],
  failedPages: ScanPageSummary[],
  allPages: ScanPageSummary[]
): string {
  const changedItems =
    changedPages.length === 0
      ? "<li>No pages exceeded the configured threshold.</li>"
      : changedPages
          .map(
            (page) => `
              <li>
                <strong>${page.name}</strong><br/>
                ${page.url}<br/>
                ${formatChangeType(page)}<br/>
                Change amount: ${formatPercent(page.diffScore)} (${page.diffPixels} pixels)<br/>
                ${page.note ? `Note: ${page.note}<br/>` : ""}
                ${page.diffUrl ? `Diff image: <a href="${page.diffUrl}">${page.diffUrl}</a><br/>` : ""}
                ${page.screenshotUrl ? `Current screenshot: <a href="${page.screenshotUrl}">${page.screenshotUrl}</a><br/>` : ""}
              </li>
            `
          )
          .join("");

  const failedItems =
    failedPages.length === 0
      ? ""
      : `
        <h3>Failed Pages</h3>
        <ul>
          ${failedPages
            .map(
              (page) => `
                <li>
                  <strong>${page.name}</strong><br/>
                  ${page.url}<br/>
                  ${page.note ?? "Scan failed"}
                </li>
              `
            )
            .join("")}
        </ul>
      `;

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2>WebRegression Alert</h2>
      <p><strong>Website:</strong> ${websiteName}</p>
      <p><strong>Base URL:</strong> ${websiteUrl}</p>
      <p><strong>Scan Run:</strong> ${scanRunId}</p>
      <p><strong>Threshold:</strong> ${formatPercent(threshold)}</p>
      <p><strong>Changed Pages:</strong> ${changedPages.length}</p>
      <p><strong>Failed Pages:</strong> ${failedPages.length}</p>
      <p><strong>Total Pages Checked:</strong> ${allPages.length}</p>
      <h3>Detected Changes</h3>
      <ul>${changedItems}</ul>
      ${failedItems}
      <p>A PDF report is attached with the complete scan summary.</p>
    </div>
  `;
}

function createPdfBuffer(
  websiteName: string,
  websiteUrl: string,
  scanRunId: string,
  threshold: number,
  changedPages: ScanPageSummary[],
  failedPages: ScanPageSummary[],
  allPages: ScanPageSummary[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("WebRegression Scan Report");
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Website: ${websiteName}`);
    doc.text(`Base URL: ${websiteUrl}`);
    doc.text(`Scan Run: ${scanRunId}`);
    doc.text(`Threshold: ${formatPercent(threshold)}`);
    doc.text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown();
    doc.text(`Changed Pages: ${changedPages.length}`);
    doc.text(`Failed Pages: ${failedPages.length}`);
    doc.text(`Total Pages Checked: ${allPages.length}`);
    doc.moveDown();

    doc.fontSize(14).text("Changed Pages");
    doc.moveDown(0.5);
    if (changedPages.length === 0) {
      doc.fontSize(11).text("No pages exceeded the configured threshold.");
    } else {
      for (const page of changedPages) {
        doc.fontSize(11).text(`${page.name}`);
        doc.fontSize(10).text(page.url);
        doc.text(`Change type: ${formatChangeType(page)}`);
        doc.text(`Change amount: ${formatPercent(page.diffScore)} (${page.diffPixels} pixels)`);
        if (page.note) doc.text(`Note: ${page.note}`);
        if (page.diffUrl) doc.text(`Diff image: ${page.diffUrl}`);
        if (page.screenshotUrl) doc.text(`Current screenshot: ${page.screenshotUrl}`);
        if (page.baselineUrl) doc.text(`Baseline screenshot: ${page.baselineUrl}`);
        doc.moveDown();
      }
    }

    if (failedPages.length > 0) {
      doc.addPage();
      doc.fontSize(14).text("Failed Pages");
      doc.moveDown(0.5);
      for (const page of failedPages) {
        doc.fontSize(11).text(`${page.name}`);
        doc.fontSize(10).text(page.url);
        doc.text(`Status: ${page.status}`);
        doc.text(`Reason: ${page.note ?? "Scan failed"}`);
        doc.moveDown();
      }
    }

    doc.addPage();
    doc.fontSize(14).text("Full Page Summary");
    doc.moveDown(0.5);
    for (const page of allPages) {
      doc.fontSize(11).text(`${page.name}`);
      doc.fontSize(10).text(page.url);
      doc.text(`Status: ${page.status}`);
      doc.text(`Change amount: ${formatPercent(page.diffScore)} (${page.diffPixels} pixels)`);
      doc.text(`Result: ${formatChangeType(page)}`);
      if (page.note) doc.text(`Note: ${page.note}`);
      doc.moveDown();
    }

    doc.end();
  });
}

function toNotificationType(type: EmailJobData["type"]): EmailNotificationType {
  if (type === "FAILURE") return "FAILURE";
  if (type === "VISUAL_CHANGE") return "VISUAL_CHANGE";
  return "SCAN_COMPLETE";
}

export async function processEmail(job: Job<EmailJobData>): Promise<void> {
  const { recipient, websiteId, scanRunId, websiteName, type } = job.data;

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

  const threshold = website.scanConfig?.threshold ?? 0.01;
  const allPages: ScanPageSummary[] = scanRun.pageResults.map((result) => ({
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

  const subject = buildSubject(type, websiteName, changedPages.length, allPages.length);
  const text = buildTextReport(
    websiteName,
    website.url,
    scanRunId,
    threshold,
    changedPages,
    failedPages,
    allPages
  );
  const html = buildHtmlReport(
    websiteName,
    website.url,
    scanRunId,
    threshold,
    changedPages,
    failedPages,
    allPages
  );
  const pdfBuffer = await createPdfBuffer(
    websiteName,
    website.url,
    scanRunId,
    threshold,
    changedPages,
    failedPages,
    allPages
  );

  const notification = await prisma.emailNotification.create({
    data: {
      websiteId,
      scanRunId,
      type: toNotificationType(type),
      recipient,
      subject,
      status: "PENDING",
    },
  });

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.FROM_EMAIL ?? process.env.SMTP_USER,
      to: recipient,
      subject,
      text,
      html,
      attachments: [
        {
          filename: `scan-report-${scanRunId}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

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
