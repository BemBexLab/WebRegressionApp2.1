import { Job } from "bullmq";
import nodemailer from "nodemailer";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "localhost",
  port: parseInt(process.env.SMTP_PORT ?? "1025", 10),
  secure: process.env.SMTP_SECURE === "true",
  auth:
    process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
});

const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@webregression.local";

export interface EmailJobData {
  type: "SCAN_COMPLETE" | "VISUAL_CHANGE" | "FAILURE";
  websiteId: string;
  scanRunId: string;
  recipient: string;
  websiteName: string;
  changedPages?: number;
  totalPages?: number;
  error?: string;
}

function buildSubject(data: EmailJobData): string {
  switch (data.type) {
    case "VISUAL_CHANGE":
      return `[WebRegression] Visual changes detected on ${data.websiteName}`;
    case "FAILURE":
      return `[WebRegression] Scan failed for ${data.websiteName}`;
    case "SCAN_COMPLETE":
      return `[WebRegression] Scan complete for ${data.websiteName} — no changes`;
  }
}

function buildHtml(data: EmailJobData): string {
  const dashboardUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/websites/${data.websiteId}/scans/${data.scanRunId}`;

  if (data.type === "VISUAL_CHANGE") {
    return `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
        <h2 style="color:#ea580c;">⚠ Visual Changes Detected</h2>
        <p>A scan of <strong>${data.websiteName}</strong> found visual changes.</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:4px 8px;color:#6b7280;">Pages scanned</td><td style="padding:4px 8px;font-weight:600;">${data.totalPages}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280;">Pages with changes</td><td style="padding:4px 8px;font-weight:600;color:#ea580c;">${data.changedPages}</td></tr>
        </table>
        <a href="${dashboardUrl}" style="display:inline-block;background:#111827;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;">View scan results →</a>
      </div>
    `;
  }

  if (data.type === "FAILURE") {
    return `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
        <h2 style="color:#dc2626;">✕ Scan Failed</h2>
        <p>The scan for <strong>${data.websiteName}</strong> encountered errors.</p>
        ${data.error ? `<pre style="background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:6px;font-size:13px;">${data.error}</pre>` : ""}
        <a href="${dashboardUrl}" style="display:inline-block;background:#111827;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;">View scan results →</a>
      </div>
    `;
  }

  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#16a34a;">✓ Scan Complete — No Changes</h2>
      <p>A scan of <strong>${data.websiteName}</strong> completed with no visual changes detected.</p>
      <table style="border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:4px 8px;color:#6b7280;">Pages scanned</td><td style="padding:4px 8px;font-weight:600;">${data.totalPages}</td></tr>
      </table>
      <a href="${dashboardUrl}" style="display:inline-block;background:#111827;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;">View scan results →</a>
    </div>
  `;
}

export async function processEmail(job: Job<EmailJobData>): Promise<void> {
  const data = job.data;

  const notification = await prisma.emailNotification.create({
    data: {
      websiteId: data.websiteId,
      scanRunId: data.scanRunId,
      type: data.type,
      recipient: data.recipient,
      subject: buildSubject(data),
      status: "PENDING",
    },
  });

  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: data.recipient,
      subject: notification.subject,
      html: buildHtml(data),
    });

    await prisma.emailNotification.update({
      where: { id: notification.id },
      data: { status: "SENT", sentAt: new Date() },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.emailNotification.update({
      where: { id: notification.id },
      data: { status: "FAILED", error: errorMsg },
    });
    throw err;
  }
}
