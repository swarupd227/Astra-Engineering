/**
 * Generates a "Miro-style" image-only BRD PDF for testing the vision-OCR
 * upload path. Each page is a rendered screenshot (real text baked into the
 * raster), so the PDF has NO selectable text layer — `pdf-parse` returns empty
 * and the upload MUST rely on extracting page images + vision-OCR.
 *
 * Usage: npx tsx scripts/generate-test-image-brd.ts [outputPath]
 */
import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";
import PDFDocument from "pdfkit";

const WIDTH = 1400;
const HEIGHT = 900;

const boards: Array<{ title: string; html: string }> = [
  {
    title: "Overview Board",
    html: `
      <div class="board" style="background:#fdf6e3;">
        <h1>Visual Requirements Board — Customer Onboarding Portal</h1>
        <div class="sticky yellow">Project: Self-service onboarding for SMB customers. Goal: reduce manual setup from 3 days to under 30 minutes.</div>
        <div class="sticky blue">Primary persona: Operations Analyst who configures new customer tenants.</div>
        <div class="sticky green">Success metric: 90% of tenants self-activate without support tickets.</div>
        <div class="sticky pink">Out of scope: billing integration (handled by Finance platform).</div>
      </div>`,
  },
  {
    title: "Functional Requirements Board",
    html: `
      <div class="board" style="background:#eef7ff;">
        <h1>Functional Requirements</h1>
        <table>
          <tr><th>ID</th><th>Requirement</th></tr>
          <tr><td>FR-101</td><td>The system shall allow an analyst to create a new tenant with name, region, and plan tier.</td></tr>
          <tr><td>FR-102</td><td>The system shall send an email invitation with a one-time activation link valid for 24 hours.</td></tr>
          <tr><td>FR-103</td><td>The system shall validate uploaded company logos (PNG/JPG, max 2MB) before saving.</td></tr>
          <tr><td>FR-104</td><td>The system shall let users import up to 5,000 contacts via CSV with row-level error reporting.</td></tr>
        </table>
      </div>`,
  },
  {
    title: "Wireframe Mockup Board",
    html: `
      <div class="board" style="background:#f4f0ff;">
        <h1>Wireframe: Tenant Setup Wizard (Step 2 of 4)</h1>
        <div class="mock">
          <div class="mock-bar">Tenant Setup &nbsp;›&nbsp; Branding</div>
          <div class="mock-row"><span class="lbl">Company name</span><span class="field"></span></div>
          <div class="mock-row"><span class="lbl">Primary color</span><span class="swatch"></span></div>
          <div class="mock-row"><span class="lbl">Logo upload</span><span class="dropzone">Drop file here</span></div>
          <div class="mock-actions"><span class="btn ghost">Back</span><span class="btn primary">Continue</span></div>
        </div>
        <div class="note">Annotation: The "Continue" button must stay disabled until a company name is entered (FR-105).</div>
      </div>`,
  },
  {
    title: "Process Flow Board",
    html: `
      <div class="board" style="background:#eefaf0;">
        <h1>Process Flow: Tenant Activation</h1>
        <div class="flow">
          <div class="node">Invite sent</div><div class="arrow">→</div>
          <div class="node">User clicks link</div><div class="arrow">→</div>
          <div class="node">Set password</div><div class="arrow">→</div>
          <div class="node">Configure branding</div><div class="arrow">→</div>
          <div class="node done">Tenant active</div>
        </div>
        <div class="note">Business rule BR-01: If the activation link expires, regenerate automatically and notify the analyst.</div>
        <div class="note">Business rule BR-02: A tenant cannot be activated without at least one admin user.</div>
      </div>`,
  },
  {
    title: "Non-Functional Requirements Board",
    html: `
      <div class="board" style="background:#fff0f3;">
        <h1>Non-Functional Requirements</h1>
        <table>
          <tr><th>ID</th><th>Requirement</th></tr>
          <tr><td>NFR-01</td><td>Tenant creation API must respond within 500ms at the 95th percentile.</td></tr>
          <tr><td>NFR-02</td><td>All data at rest must be encrypted with AES-256.</td></tr>
          <tr><td>NFR-03</td><td>The portal must meet WCAG 2.1 AA accessibility standards.</td></tr>
          <tr><td>NFR-04</td><td>The system must support 200 concurrent onboarding sessions without degradation.</td></tr>
        </table>
      </div>`,
  },
];

const pageHtml = (inner: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
  html,body { margin:0; padding:0; }
  .board { width:${WIDTH}px; height:${HEIGHT}px; padding:48px; position:relative; }
  h1 { font-size:38px; margin:0 0 28px; color:#1a1a2e; }
  .sticky { display:inline-block; width:520px; min-height:120px; margin:14px; padding:18px;
            font-size:22px; line-height:1.35; box-shadow:4px 6px 10px rgba(0,0,0,.15); transform:rotate(-1deg); }
  .sticky.yellow{background:#fff4b8;} .sticky.blue{background:#bfe3ff;}
  .sticky.green{background:#c8f7d0;} .sticky.pink{background:#ffc9d6; transform:rotate(1.5deg);}
  table { width:100%; border-collapse:collapse; font-size:24px; }
  th,td { border:2px solid #33415c; padding:14px 18px; text-align:left; }
  th { background:#33415c; color:#fff; }
  .mock { width:760px; border:3px solid #5b5b7a; border-radius:10px; background:#fff; padding:0 0 24px; }
  .mock-bar { background:#5b5b7a; color:#fff; padding:14px 20px; font-size:22px; border-radius:6px 6px 0 0; }
  .mock-row { display:flex; align-items:center; padding:18px 24px; font-size:22px; }
  .lbl { width:220px; color:#333; }
  .field { flex:1; height:40px; border:2px solid #aaa; border-radius:6px; }
  .swatch { width:60px; height:40px; background:#6c5ce7; border-radius:6px; }
  .dropzone { flex:1; height:70px; border:2px dashed #aaa; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#888; }
  .mock-actions { display:flex; justify-content:flex-end; gap:16px; padding:10px 24px 0; }
  .btn { padding:12px 28px; border-radius:8px; font-size:20px; }
  .btn.ghost { border:2px solid #888; color:#555; }
  .btn.primary { background:#6c5ce7; color:#fff; }
  .flow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:20px 0; }
  .node { background:#fff; border:3px solid #2d6a4f; color:#1b4332; padding:18px 22px; border-radius:10px; font-size:22px; }
  .node.done { background:#2d6a4f; color:#fff; }
  .arrow { font-size:34px; color:#2d6a4f; }
  .note { margin-top:22px; font-size:22px; color:#444; background:rgba(255,255,255,.6); padding:14px 18px; border-left:6px solid #888; }
</style></head><body>${inner}</body></html>`;

async function renderBoardsToPngs(): Promise<Buffer[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
    const pngs: Buffer[] = [];
    for (const board of boards) {
      await page.setContent(pageHtml(board.html), { waitUntil: "domcontentloaded" });
      const buf = (await page.screenshot({ type: "png" })) as Buffer;
      pngs.push(buf);
    }
    return pngs;
  } finally {
    await browser.close();
  }
}

function buildPdf(pngs: Buffer[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [WIDTH, HEIGHT], margin: 0 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    pngs.forEach((png, i) => {
      if (i > 0) doc.addPage({ size: [WIDTH, HEIGHT], margin: 0 });
      doc.image(png, 0, 0, { width: WIDTH, height: HEIGHT });
    });
    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}

(async () => {
  const outputPath =
    process.argv[2] || "C:/Users/gaganar/Downloads/Miro_Style_Image_BRD.pdf";
  console.log("Rendering boards with headless Chromium…");
  const pngs = await renderBoardsToPngs();
  console.log(`Rendered ${pngs.length} board image(s).`);
  await buildPdf(pngs, path.resolve(outputPath));
  const size = fs.statSync(outputPath).size;
  console.log(`Wrote ${outputPath} (${(size / 1024).toFixed(0)} KB, ${pngs.length} image-only pages).`);
})().catch((e) => {
  console.error("Failed to generate test PDF:", e);
  process.exit(1);
});
