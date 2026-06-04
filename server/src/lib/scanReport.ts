import PDFDocument from "pdfkit";

export type ScanReportPage = {
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

export type ScanReportInput = {
  websiteName: string;
  websiteUrl: string;
  scanRunId: string;
  threshold: number;
  generatedAt?: Date;
  changedPages: ScanReportPage[];
  failedPages: ScanReportPage[];
  allPages: ScanReportPage[];
};

const INTERNAL_STORAGE_ORIGINS = [
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatChangeType(page: ScanReportPage): string {
  if (page.note?.includes("New page discovered")) return "New page detected";
  if (page.hasChanges) return "Visual difference detected";
  if (page.status === "FAILED") return "Scan failed";
  return "No significant change";
}

function resolveAssetUrl(url: string | null): string | null {
  if (!url) return null;

  const storageOrigin = process.env.SUPABASE_STORAGE_URL ?? "http://supabase-storage:5000";
  for (const origin of INTERNAL_STORAGE_ORIGINS) {
    if (url.startsWith(`${origin}/`)) {
      return `${storageOrigin}/${url.slice(`${origin}/`.length)}`;
    }
  }

  return url;
}

async function fetchImageBuffer(url: string | null): Promise<Buffer | null> {
  const resolvedUrl = resolveAssetUrl(url);
  if (!resolvedUrl) return null;

  try {
    const response = await fetch(resolvedUrl);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

function addKeyValue(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
  doc.font("Helvetica").text(value);
}

async function addPageSection(
  doc: PDFKit.PDFDocument,
  page: ScanReportPage,
  index: number
): Promise<void> {
  if (index > 0) {
    doc.addPage();
  }

  doc.fontSize(14).font("Helvetica-Bold").text(page.name);
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica");
  addKeyValue(doc, "URL", page.url);
  addKeyValue(doc, "Status", page.status);
  addKeyValue(doc, "Result", formatChangeType(page));
  addKeyValue(doc, "Difference", `${formatPercent(page.diffScore)} (${page.diffPixels} pixels)`);
  if (page.note) {
    addKeyValue(doc, "Note", page.note);
  }

  const [diffImage, currentImage, baselineImage] = await Promise.all([
    fetchImageBuffer(page.diffUrl),
    fetchImageBuffer(page.screenshotUrl),
    fetchImageBuffer(page.baselineUrl),
  ]);

  const images = [
    { label: "Difference Image", buffer: diffImage, source: page.diffUrl },
    { label: "Current Screenshot", buffer: currentImage, source: page.screenshotUrl },
    { label: "Baseline Screenshot", buffer: baselineImage, source: page.baselineUrl },
  ].filter((entry) => entry.buffer || entry.source);

  for (const image of images) {
    doc.moveDown();
    doc.fontSize(11).font("Helvetica-Bold").text(image.label);
    if (image.buffer) {
      const width = Math.min(500, doc.page.width - doc.page.margins.left - doc.page.margins.right);
      doc.moveDown(0.3);
      doc.image(image.buffer, undefined, undefined, {
        fit: [width, 260],
      });
    } else if (image.source) {
      doc.fontSize(10).font("Helvetica").text("Image could not be embedded in the PDF.");
      addKeyValue(doc, "Image URL", image.source);
    }
  }
}

export async function createScanPdfBuffer(input: ScanReportInput): Promise<Buffer> {
  const {
    websiteName,
    websiteUrl,
    scanRunId,
    threshold,
    changedPages,
    failedPages,
    allPages,
    generatedAt = new Date(),
  } = input;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", autoFirstPage: false });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    void (async () => {
      doc.addPage();
      doc.fontSize(18).font("Helvetica-Bold").text("WebRegression Scan Report");
      doc.moveDown(0.5);
      doc.fontSize(11).font("Helvetica");
      addKeyValue(doc, "Website", websiteName);
      addKeyValue(doc, "Base URL", websiteUrl);
      addKeyValue(doc, "Scan Run", scanRunId);
      addKeyValue(doc, "Threshold", formatPercent(threshold));
      addKeyValue(doc, "Generated", generatedAt.toISOString());
      addKeyValue(doc, "Changed Pages", String(changedPages.length));
      addKeyValue(doc, "Failed Pages", String(failedPages.length));
      addKeyValue(doc, "Total Pages Checked", String(allPages.length));

      doc.moveDown();
      doc.fontSize(14).font("Helvetica-Bold").text("Changed URLs Exceeding Threshold");
      doc.moveDown(0.5);
      doc.fontSize(10).font("Helvetica");
      if (changedPages.length === 0) {
        doc.text("No pages exceeded the configured threshold.");
      } else {
        for (const page of changedPages) {
          doc.text(`• ${page.url}`);
          doc.text(
            `  Difference: ${formatPercent(page.diffScore)} (${page.diffPixels} pixels)`,
            { indent: 8 }
          );
        }
      }

      if (failedPages.length > 0) {
        doc.moveDown();
        doc.fontSize(14).font("Helvetica-Bold").text("Failed Pages");
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica");
        for (const page of failedPages) {
          doc.text(`• ${page.url}`);
          doc.text(`  ${page.note ?? "Scan failed"}`, { indent: 8 });
        }
      }

      for (let index = 0; index < changedPages.length; index += 1) {
        await addPageSection(doc, changedPages[index], index);
      }

      doc.addPage();
      doc.fontSize(14).font("Helvetica-Bold").text("Full Page Summary");
      doc.moveDown(0.5);
      for (const page of allPages) {
        doc.fontSize(11).font("Helvetica-Bold").text(page.name);
        doc.fontSize(10).font("Helvetica").text(page.url);
        doc.text(`Status: ${page.status}`);
        doc.text(`Result: ${formatChangeType(page)}`);
        doc.text(`Difference: ${formatPercent(page.diffScore)} (${page.diffPixels} pixels)`);
        if (page.note) {
          doc.text(`Note: ${page.note}`);
        }
        doc.moveDown();
      }

      doc.end();
    })().catch(reject);
  });
}
