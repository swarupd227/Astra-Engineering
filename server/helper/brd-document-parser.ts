import type { Request } from "express";
import JSZip from "jszip";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Minimal multipart/form-data parser to avoid extra dependencies
export async function parseMultipartFormData(
  req: Request
): Promise<{
  files: Array<{
    name: string;
    filename: string;
    contentType: string;
    data: Buffer;
  }>;
  fields: Record<string, string>;
}> {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary");
  }
  const boundary = boundaryMatch[1];
  const chunks: Buffer[] = [];

  return await new Promise((resolve, reject) => {
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const parts = buffer.toString("latin1").split(`--${boundary}`);
      const files: Array<{
        name: string;
        filename: string;
        contentType: string;
        data: Buffer;
      }> = [];
      const fields: Record<string, string> = {};

      for (const rawPart of parts) {
        const part = rawPart.trim();
        if (!part || part === "--") continue;
        const [rawHeaders, rawValue] = part.split("\r\n\r\n");
        if (!rawHeaders || rawValue === undefined) continue;

        const headerLines = rawHeaders.split("\r\n");
        const disposition = headerLines.find((line) =>
          line.toLowerCase().startsWith("content-disposition")
        );
        if (!disposition) continue;

        const nameMatch = disposition.match(/name="([^"]+)"/i);
        const filenameMatch = disposition.match(/filename="([^"]*)"/i);
        const contentTypeLine = headerLines.find((line) =>
          line.toLowerCase().startsWith("content-type")
        );
        const contentTypeValue = contentTypeLine
          ? contentTypeLine.split(":")[1].trim()
          : "application/octet-stream";

        // Trim the trailing boundary markers/CRLF
        const cleanedValue = rawValue
          .replace(/\r\n--$/, "")
          .replace(/\r\n$/, "");

        if (filenameMatch && filenameMatch[1]) {
          files.push({
            name: nameMatch?.[1] || "file",
            filename: filenameMatch[1],
            contentType: contentTypeValue,
            data: Buffer.from(cleanedValue, "latin1"),
          });
        } else if (nameMatch && nameMatch[1]) {
          fields[nameMatch[1]] = cleanedValue.trim();
        }
      }

      resolve({ files, fields });
    });

    req.on("error", (error) => reject(error));
  });
}

// Extract plain text from a DOCX buffer by reading word/document.xml
export async function extractTextFromDocxBuffer(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docFile = zip.file("word/document.xml");
    if (!docFile) return "";
    const xml = await docFile.async("string");

    // Extract text nodes inside w:t tags which hold run text in docx
    const matches = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g));
    const texts = matches.map((m) => m[1].replace(/\s+/g, " ").trim());
    return texts.join(" ").replace(/\s+/g, " ").trim();
  } catch (err) {
    console.error("[BRD] Failed to extract DOCX text:", err);
    return "";
  }
}

// Extract structured markdown from a DOCX buffer, preserving headings and paragraphs
export async function extractMarkdownFromDocxBuffer(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docFile = zip.file("word/document.xml");
    if (!docFile) {
      return "";
    }
    const xml = await docFile.async("string");// First, extract all text content preserving paragraph breaks
    // Split by paragraph markers and process each
    const paragraphBlocks = xml.split(/<w:p[^>]*>/);
    const markdownLines: string[] = [];

    for (const block of paragraphBlocks) {
      if (!block.trim()) continue;

      // Extract paragraph style to detect headings
      const styleMatch = block.match(/<w:pStyle\s+w:val="([^"]+)"/i);
      const styleName = styleMatch ? styleMatch[1].toLowerCase() : "";

      // Extract all text runs within this paragraph
      const textMatches = Array.from(block.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gi));
      const paragraphText = textMatches.map((m) => m[1]).join("").trim();

      if (!paragraphText) continue;

      // Determine heading level based on style
      let headingPrefix = "";
      if (styleName.includes("heading1") || styleName.includes("title")) {
        headingPrefix = "# ";
      } else if (styleName.includes("heading2")) {
        headingPrefix = "## ";
      } else if (styleName.includes("heading3")) {
        headingPrefix = "### ";
      } else if (styleName.includes("heading4")) {
        headingPrefix = "#### ";
      } else if (styleName.includes("heading5")) {
        headingPrefix = "##### ";
      } else if (styleName.includes("heading6")) {
        headingPrefix = "###### ";
      }

      // Check for list items (numbered or bullet)
      const numIdMatch = block.match(/<w:numId\s+w:val="(\d+)"/i);
      const ilvlMatch = block.match(/<w:ilvl\s+w:val="(\d+)"/i);

      if (numIdMatch && !headingPrefix) {
        // It's a list item
        const indent = ilvlMatch ? "  ".repeat(parseInt(ilvlMatch[1], 10)) : "";
        markdownLines.push(`${indent}- ${paragraphText}`);
      } else {
        // Regular paragraph or heading
        markdownLines.push(`${headingPrefix}${paragraphText}`);
        if (!headingPrefix && paragraphText.length > 0) {
          // Add blank line after regular paragraphs for readability
          markdownLines.push("");
        }
      }
    }// If no structured content found, fall back to plain text extraction
    if (markdownLines.length === 0) {
      const allTextMatches = Array.from(xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gi));
      const plainText = allTextMatches.map((m) => m[1]).join(" ").replace(/\s+/g, " ").trim();
      if (plainText) {
        // Try to add some structure by detecting common patterns
        return convertPlainTextToMarkdown(plainText);
      }
      return "";
    }

    // Clean up: remove excessive blank lines
    const cleanedMarkdown = markdownLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return cleanedMarkdown;
  } catch (err) {
    console.error("[BRD] Failed to extract markdown from DOCX:", err);
    return "";
  }
}

/**
 * Extract embedded images from a DOCX buffer (zip archive).
 * Returns an array of image data objects with base64 content and media type.
 */
export async function extractImagesFromDocxBuffer(
  buffer: Buffer
): Promise<Array<{ data: string; mediaType: string; name: string }>> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const imageFiles = Object.keys(zip.files).filter((name) =>
      name.startsWith("word/media/") &&
      /\.(png|jpe?g|gif|webp)$/i.test(name)
    );

    const images: Array<{ data: string; mediaType: string; name: string }> = [];

    for (const fileName of imageFiles) {
      const file = zip.file(fileName);
      if (!file) continue;

      const data = await file.async("base64");
      const ext = path.extname(fileName).toLowerCase().replace(".", "");
      let mediaType = `image/${ext}`;
      if (ext === "jpg") mediaType = "image/jpeg";

      images.push({
        data,
        mediaType,
        name: path.basename(fileName),
      });
    }

    return images;
  } catch (err) {
    console.error("[BRD] Failed to extract images from DOCX:", err);
    return [];
  }
}

/**
 * Extract embedded raster images from a PDF buffer using pdfjs-dist.
 *
 * This is the PDF analogue of `extractImagesFromDocxBuffer` and exists to
 * support *image-based* PDFs — scanned documents and design-tool exports
 * (e.g. a Miro board exported to PDF) where the page content is a rasterized
 * image with little or no selectable text layer. `pdf-parse` returns empty
 * text for these, so without this fallback the BRD upload produces only a
 * "could not extract text" placeholder. The extracted PNGs are handed to the
 * vision-capable LLM extractor (`extractBrdInputFromDocumentText`) for OCR.
 *
 * Runs entirely in Node (no headless browser / native canvas) by reading the
 * page operator lists and decoding the image XObjects that pdf.js exposes,
 * then re-encoding them as PNG via the (already-installed) `pngjs` library.
 *
 * Large images are downscaled so the long edge is <= `maxDimension` to keep
 * the vision payload small and within model limits. Tiny images (logos,
 * bullets, icons) below `minDimension` are skipped.
 */
export async function extractImagesFromPdfBuffer(
  buffer: Buffer,
  opts: {
    maxPages?: number;
    maxImages?: number;
    maxDimension?: number;
    minDimension?: number;
  } = {}
): Promise<Array<{ data: string; mediaType: string; name: string }>> {
  const maxPages = opts.maxPages ?? 15;
  const maxImages = opts.maxImages ?? 10;
  const maxDimension = opts.maxDimension ?? 1600;
  const minDimension = opts.minDimension ?? 64;

  try {
    // Use the legacy ESM build — it is the variant already proven to work in
    // this codebase's Node/server context (see server/qe/ssrs-powerbi-service.ts).
    const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pngjsModule: any = await import("pngjs");
    const PNG = pngjsModule.PNG || pngjsModule.default?.PNG || pngjsModule.default;
    if (!PNG) {
      console.error("[BRD] pngjs PNG export not found; cannot rasterize PDF images.");
      return [];
    }

    const uint8 = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({
      data: uint8,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
      // Force raw bitmap data (not ImageBitmap/OffscreenCanvas) so we can
      // re-encode the pixels ourselves in Node.
      isOffscreenCanvasSupported: false,
    });
    const pdfDoc = await loadingTask.promise;

    const crypto = await import("crypto");
    const OPS = pdfjsLib.OPS || {};
    const images: Array<{ data: string; mediaType: string; name: string }> = [];
    const seenObjIds = new Set<string>();
    // Content hashes of already-emitted images. The same artwork is frequently
    // referenced from multiple pages (and via both page-local `objs` and the
    // shared `commonObjs`), which would otherwise burn the limited vision-image
    // budget on duplicates.
    const seenContentHashes = new Set<string>();

    const pagesToScan = Math.min(pdfDoc.numPages, maxPages);

    for (let pageNum = 1; pageNum <= pagesToScan && images.length < maxImages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const opList = await page.getOperatorList();

      // Collect referenced image XObject ids on this page (in paint order).
      const imageRefs: Array<{ objId: string; inlineData?: any }> = [];
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];
        if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
          const objId = args?.[0];
          if (typeof objId === "string") imageRefs.push({ objId });
        } else if (fn === OPS.paintInlineImageXObject) {
          // Inline images carry their decoded data directly in the args.
          imageRefs.push({ objId: `inline_p${pageNum}_${i}`, inlineData: args?.[0] });
        }
      }

      for (const ref of imageRefs) {
        if (images.length >= maxImages) break;
        if (seenObjIds.has(ref.objId)) continue;
        seenObjIds.add(ref.objId);

        try {
          const imgObj = ref.inlineData
            ? ref.inlineData
            : await getPdfImageObject(page, ref.objId);
          if (!imgObj) continue;

          const png = pdfImageObjectToPng(imgObj, { maxDimension, minDimension, PNG });
          if (!png) continue;

          const contentHash = crypto.createHash("sha1").update(png).digest("hex");
          if (seenContentHashes.has(contentHash)) continue;
          seenContentHashes.add(contentHash);

          images.push({
            data: png.toString("base64"),
            mediaType: "image/png",
            name: `${ref.objId}.png`,
          });
        } catch (imgErr) {
          console.warn(`[BRD] Failed to decode PDF image ${ref.objId}:`, imgErr);
        }
      }

      // Release page resources eagerly for large documents.
      page.cleanup?.();
    }

    try {
      await pdfDoc.destroy?.();
    } catch {
      // ignore
    }

    return images;
  } catch (err) {
    console.error("[BRD] Failed to extract images from PDF:", err);
    return [];
  }
}

/**
 * Resolve a pdf.js image XObject by id. After `getOperatorList()` resolves,
 * the object is usually available synchronously, but `objs.get(id, cb)` waits
 * for resolution if it isn't. Some images live on `commonObjs` instead of the
 * page-scoped `objs`.
 */
async function getPdfImageObject(page: any, objId: string): Promise<any> {
  const store = objId.startsWith("g_") ? page.commonObjs : page.objs;
  return await new Promise((resolve) => {
    let settled = false;
    const done = (val: any) => {
      if (settled) return;
      settled = true;
      resolve(val ?? null);
    };
    try {
      // Fast path: already resolved.
      if (store?.has?.(objId)) {
        done(store.get(objId));
        return;
      }
    } catch {
      // fall through to callback form
    }
    try {
      store.get(objId, (val: any) => done(val));
    } catch {
      done(null);
    }
    // Safety timeout so a never-resolving object can't hang the upload.
    setTimeout(() => done(null), 5000);
  });
}

/**
 * Convert a pdf.js image object ({ width, height, kind, data } or { bitmap })
 * into a PNG Buffer, downscaling oversized images. Returns null for images
 * that are too small, empty, or in an unrecognized layout.
 */
function pdfImageObjectToPng(
  imgObj: any,
  opts: { maxDimension: number; minDimension: number; PNG: any }
): Buffer | null {
  const { maxDimension, minDimension, PNG } = opts;
  const width: number = imgObj?.width;
  const height: number = imgObj?.height;
  if (!width || !height || width < minDimension || height < minDimension) {
    return null;
  }

  const data: Uint8Array | Uint8ClampedArray | undefined = imgObj?.data;
  if (!data || data.length === 0) {
    // ImageBitmap-backed objects expose `bitmap` instead of `data`; we cannot
    // read those without a canvas, so skip (isOffscreenCanvasSupported:false
    // should prevent this path).
    return null;
  }

  // Build an RGBA buffer (length width*height*4) from the source layout.
  const pixelCount = width * height;
  let rgba: Uint8Array;

  // pdf.js ImageKind: 1=GRAYSCALE_1BPP, 2=RGB_24BPP, 3=RGBA_32BPP.
  const kind = imgObj?.kind;
  if (kind === 3 || data.length === pixelCount * 4) {
    // Copy into a fresh, offset-0 Uint8Array regardless of the source view
    // type (Uint8Array / Uint8ClampedArray) so the PNG encoder reads the
    // correct bytes.
    rgba = Uint8Array.from(data);
  } else if (kind === 2 || data.length === pixelCount * 3) {
    rgba = new Uint8Array(pixelCount * 4);
    for (let i = 0, j = 0; i < pixelCount; i++) {
      rgba[j++] = data[i * 3];
      rgba[j++] = data[i * 3 + 1];
      rgba[j++] = data[i * 3 + 2];
      rgba[j++] = 255;
    }
  } else if (data.length === pixelCount) {
    // 8-bit grayscale (one byte per pixel).
    rgba = new Uint8Array(pixelCount * 4);
    for (let i = 0, j = 0; i < pixelCount; i++) {
      const g = data[i];
      rgba[j++] = g;
      rgba[j++] = g;
      rgba[j++] = g;
      rgba[j++] = 255;
    }
  } else if (kind === 1) {
    // 1-bit packed grayscale: each row is ceil(width/8) bytes.
    const rowBytes = Math.ceil(width / 8);
    rgba = new Uint8Array(pixelCount * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * rowBytes + (x >> 3)];
        const bit = (byte >> (7 - (x & 7))) & 1;
        const g = bit ? 255 : 0;
        const j = (y * width + x) * 4;
        rgba[j] = g;
        rgba[j + 1] = g;
        rgba[j + 2] = g;
        rgba[j + 3] = 255;
      }
    }
  } else {
    // Unknown layout — don't risk producing garbage.
    return null;
  }

  // Downscale (nearest-neighbour) if the long edge exceeds maxDimension.
  let outWidth = width;
  let outHeight = height;
  let outRgba = rgba;
  const longEdge = Math.max(width, height);
  if (longEdge > maxDimension) {
    const scale = maxDimension / longEdge;
    outWidth = Math.max(1, Math.round(width * scale));
    outHeight = Math.max(1, Math.round(height * scale));
    outRgba = new Uint8Array(outWidth * outHeight * 4);
    for (let y = 0; y < outHeight; y++) {
      const srcY = Math.min(height - 1, Math.floor(y / scale));
      for (let x = 0; x < outWidth; x++) {
        const srcX = Math.min(width - 1, Math.floor(x / scale));
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * outWidth + x) * 4;
        outRgba[dstIdx] = rgba[srcIdx];
        outRgba[dstIdx + 1] = rgba[srcIdx + 1];
        outRgba[dstIdx + 2] = rgba[srcIdx + 2];
        outRgba[dstIdx + 3] = rgba[srcIdx + 3];
      }
    }
  }

  const png = new PNG({ width: outWidth, height: outHeight });
  png.data = Buffer.from(outRgba.buffer, outRgba.byteOffset, outRgba.byteLength);
  return PNG.sync.write(png);
}

// Convert plain text to markdown WITHOUT inventing section headings.
// We deliberately do NOT promote ALL-CAPS lines, keyword-prefixed lines, or
// arbitrary numbered lines to markdown headings here, because doing so on
// extracted PDF/legacy-doc text fabricates structure that is not actually in
// the source document and pollutes downstream BRD section parsing.
//
// Only structural cues that are highly likely to be real section numbers
// (e.g., "1.2 Foo" / "2.3.1 Bar") are promoted. Everything else is preserved
// as a paragraph. The caller (LLM extraction) is responsible for semantic
// section mapping.
export function convertPlainTextToMarkdown(text: string): string {
  // Split on real newlines, not on sentence punctuation. Sentence-splitting
  // turned acronyms and abbreviations into independent "lines" that the old
  // heuristics then promoted to headings.
  const rawLines = text.split(/\r?\n/);
  const markdownLines: string[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      // Preserve paragraph breaks
      if (markdownLines.length > 0 && markdownLines[markdownLines.length - 1] !== "") {
        markdownLines.push("");
      }
      continue;
    }

    // Strict numbered-section detection: requires "<number>(.<number>)* " followed
    // by a capitalized word and a reasonably short line. This matches "1 Introduction",
    // "2.3 Scope", "4.1.2 User Roles", but NOT "1. The system shall..." or random
    // numbered sentences in body paragraphs.
    const numberedSectionMatch = trimmed.match(/^(\d+(?:\.\d+)*)\s+([A-Z][^.]{0,80})$/);
    if (numberedSectionMatch && trimmed.length < 100) {
      const dotCount = (numberedSectionMatch[1].match(/\./g) || []).length;
      const headingLevel = Math.min(dotCount + 1, 4);
      markdownLines.push(`${"#".repeat(headingLevel)} ${trimmed}`);
      continue;
    }

    // Bullet/list pass-through (preserve list semantics from the source)
    if (/^[\u2022\u2023\u25E6\u2043\u2219\u00b7\-\*]\s+/.test(trimmed)) {
      markdownLines.push(`- ${trimmed.replace(/^[\u2022\u2023\u25E6\u2043\u2219\u00b7\-\*]\s+/, "")}`);
      continue;
    }
    if (/^\d+[\.\)]\s+/.test(trimmed)) {
      markdownLines.push(trimmed);
      continue;
    }

    // Default: keep the line as a regular paragraph. Do NOT add a synthetic
    // period or promote to a heading.
    markdownLines.push(trimmed);
  }

  return markdownLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Extract markdown from a PDF buffer using pdf-parse
// Uses pdf-parse v1.1.1 which has a simple function-based API without worker files
// Note: pdf-parse/index.js has debug code that tries to read a test file during module load.
// We bypass this by loading the underlying library directly (pdf-parse/lib/pdf-parse.js)
// which doesn't have the debug code.
export async function extractMarkdownFromPdfBuffer(buffer: Buffer): Promise<string> {
  try {// pdf-parse v1.1.1 exports a simple function (no workers, no classes)
    // This works reliably in Azure and other serverless environments
    let pdfParseFn: any;

    if (typeof require !== 'undefined') {
      // CommonJS context
      // Bypass pdf-parse/index.js (which has debug code that tries to read a test file)
      // and load the underlying library directly (pdf-parse/lib/pdf-parse.js)
      try {
        // Load the underlying pdf-parse library directly, bypassing the index.js wrapper
        // This avoids the debug code that runs during module initialization
        const pdfParseLibPath = require.resolve('pdf-parse/lib/pdf-parse.js');
        pdfParseFn = require(pdfParseLibPath);
      } catch (libErr: any) {
        // Fallback: try loading the main module (in case direct path doesn't work)
        console.warn("[BRD] Failed to load pdf-parse library directly, trying main module:", libErr?.message);
        try {
          pdfParseFn = require('pdf-parse');
        } catch (requireErr: any) {
          // If it fails due to debug mode test file error, that's expected - log and re-throw
          if (requireErr?.code === 'ENOENT' && requireErr?.path?.includes('test/data/05-versions-space.pdf')) {
            console.error("[BRD] pdf-parse debug mode error. The library should be loaded directly, but that also failed.");
            throw new Error("Failed to load pdf-parse library. Both direct and wrapper imports failed.");
          }
          throw requireErr;
        }
      }
    } else {
      // ESM context - use dynamic import
      // In ESM, module.parent doesn't exist, so debug mode shouldn't trigger
      // But we'll still try the direct path first to be safe
      try {
        const pdfParseLibModule = await import('pdf-parse/lib/pdf-parse.js') as any;
        pdfParseFn = pdfParseLibModule.default || pdfParseLibModule;
      } catch (libErr) {
        // Fallback: try the main module
        console.warn("[BRD] Failed to load pdf-parse library directly in ESM, trying main module");
        const pdfParseModule = await import('pdf-parse') as any;
        pdfParseFn = pdfParseModule.default || pdfParseModule;
      }
    }

    // Validate we have a function
    if (!pdfParseFn || typeof pdfParseFn !== 'function') {
      throw new Error("pdf-parse module did not export a function. Please ensure pdf-parse v1.1.1 is installed.");
    }// Use pdf-parse function directly (simple API, no workers needed)
    const pdfData = await pdfParseFn(buffer);

    const rawText = pdfData.text || "";
    const numPages = pdfData.numpages || 0; if (!rawText || rawText.trim().length === 0) {
      console.warn("[BRD] PDF extraction returned empty text. PDF might be image-based or corrupted.");
      return "";
    }

    return processPdfTextToMarkdown(rawText);
  } catch (err) {
    console.error("[BRD] Failed to extract markdown from PDF:", err);
    return "";
  }
}

// Convert legacy binary .doc (Word 97-2003) files to modern .docx using LibreOffice/soffice.
// This runs on the server and requires `soffice` to be available on the PATH.
export async function convertLegacyDocToDocx(buffer: Buffer): Promise<Buffer> {
  const tmpBaseDir = os.tmpdir();
  const tmpDir = await fs.mkdtemp(path.join(tmpBaseDir, "devx-doc-convert-"));
  const inputPath = path.join(tmpDir, "input.doc");
  const outputPath = path.join(tmpDir, "input.docx");

  await fs.writeFile(inputPath, buffer);

  try {
    const cmd = `soffice --headless --convert-to docx --outdir "${tmpDir}" "${inputPath}"`;
    await execAsync(cmd);

    const converted = await fs.readFile(outputPath);
    if (!converted || converted.length === 0) {
      throw new Error("Converted .docx file is empty or missing.");
    }

    return converted;
  } catch (err) {
    console.error("[BRD] Legacy .doc to .docx conversion failed:", err);
    throw err;
  } finally {
    try {
      await fs.unlink(inputPath).catch(() => { });
      await fs.unlink(outputPath).catch(() => { });
      await fs.rmdir(tmpDir).catch(() => { });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Validate and normalise user-attached diagram/image files received via
 * multipart upload (keyed as `diagram_image_0`, `diagram_image_1`, …).
 *
 * Rules:
 *  - Only raster image MIME types are accepted (image/png, image/jpeg,
 *    image/webp, image/gif). Non-image files are silently skipped.
 *  - Maximum `maxImages` files (default 10). Excess files are silently dropped.
 *  - Maximum `maxBytesPerImage` bytes per image (default 10 MB). Over-size
 *    images are silently skipped.
 *
 * Returns an array ready to pass straight to `callExtractionLlm` / the
 * `imagesForExtraction` pipeline.
 */
export function validateAndNormaliseUserImages(
  files: Array<{ name: string; filename: string; contentType: string; data: Buffer }>,
  opts: { maxImages?: number; maxBytesPerImage?: number } = {}
): Array<{ data: string; mediaType: string; name: string }> {
  const maxImages = opts.maxImages ?? 10;
  const maxBytesPerImage = opts.maxBytesPerImage ?? 10 * 1024 * 1024; // 10 MB

  const ALLOWED_IMAGE_MIMES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
  ]);

  const result: Array<{ data: string; mediaType: string; name: string }> = [];

  for (const file of files) {
    if (result.length >= maxImages) break;

    // Normalise MIME: fall back to extension-based guess if content-type is
    // generic (octet-stream) or empty.
    let mediaType = (file.contentType || "").toLowerCase().split(";")[0].trim();
    if (!ALLOWED_IMAGE_MIMES.has(mediaType)) {
      const ext = path.extname(file.filename || "").toLowerCase();
      const extToMime: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
      };
      mediaType = extToMime[ext] || "";
    }

    if (!ALLOWED_IMAGE_MIMES.has(mediaType)) {
      console.warn(
        `[BRD] validateAndNormaliseUserImages: skipping non-image file "${file.filename}" (contentType="${file.contentType}")`,
      );
      continue;
    }

    if (file.data.length > maxBytesPerImage) {
      console.warn(
        `[BRD] validateAndNormaliseUserImages: skipping oversized image "${file.filename}" (${(file.data.length / 1024 / 1024).toFixed(1)} MB > ${maxBytesPerImage / 1024 / 1024} MB limit)`,
      );
      continue;
    }

    result.push({
      data: file.data.toString("base64"),
      mediaType: mediaType === "image/jpg" ? "image/jpeg" : mediaType,
      name: file.filename || file.name,
    });
  }

  return result;
}

// Helper function to process extracted PDF text into markdown
export function processPdfTextToMarkdown(rawText: string): string {
  // Enhanced processing to handle tables, structured content, and preserve formatting
  const lines = rawText.split("\n");
  const markdownLines: string[] = [];
  let inList = false;
  let inTable = false;
  let tableRows: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Detect table-like content (multiple columns separated by spaces/tabs)
    const hasMultipleColumns = line.split(/\s{2,}|\t/).length >= 3 && line.length > 20;
    const isTableRow = hasMultipleColumns && !line.match(/^[#\-\*]/);

    if (isTableRow && !inTable) {
      // Start of a table
      inTable = true;
      tableRows = [];
    }

    if (inTable) {
      if (isTableRow) {
        // Convert table row to markdown table format
        const cells = line.split(/\s{2,}|\t/).filter((cell: string) => cell.trim().length > 0);
        if (cells.length >= 2) {
          tableRows.push(cells.join(" | "));
        } else {
          // Not a table row, close table and process as regular content
          if (tableRows.length > 0) {
            // Add markdown table
            markdownLines.push(""); // Empty line before table
            markdownLines.push(tableRows.join("\n"));
            markdownLines.push(""); // Empty line after table
          }
          inTable = false;
          tableRows = [];
        }
      } else {
        // End of table
        if (tableRows.length > 0) {
          markdownLines.push(""); // Empty line before table
          markdownLines.push(tableRows.join("\n"));
          markdownLines.push(""); // Empty line after table
        }
        inTable = false;
        tableRows = [];
      }
    }

    if (!line) {
      if (inList) {
        inList = false;
      }
      if (!inTable) {
        markdownLines.push("");
      }
      continue;
    }

    if (inTable) {
      continue; // Already handled above
    }

    // Only promote highly-structural numbered section labels to headings.
    // Examples that match: "1 Introduction", "2.3 Scope", "4.1.2 User Roles".
    // We deliberately do NOT promote ALL-CAPS lines or keyword-prefixed lines
    // (e.g., "Requirements", "Scope") to headings here — extracted PDF text
    // contains many such fragments (page footers, table cells, emphasized
    // phrases) that turning into headings creates fabricated BRD sections.
    const numberedSectionMatch = line.match(/^(\d+(?:\.\d+)*)\s+([A-Z][^.]{0,80})$/);
    const isStrictNumberedSection = !!numberedSectionMatch && line.length < 100;

    if (isStrictNumberedSection) {
      const dotCount = (numberedSectionMatch![1].match(/\./g) || []).length;
      const headingLevel = Math.min(dotCount + 1, 4);
      markdownLines.push(`${"#".repeat(headingLevel)} ${line}`);
    } else if (/^[\u2022\u2023\u25E6\u2043\u2219•\-\*]\s/.test(line)) {
      // Bullet point
      inList = true;
      markdownLines.push(`- ${line.replace(/^[\u2022\u2023\u25E6\u2043\u2219•\-\*]\s*/, "")}`);
    } else if (/^\d+[\.\)]\s/.test(line)) {
      // Numbered list item
      inList = true;
      markdownLines.push(line);
    } else {
      // Regular paragraph - preserve as-is to maintain formatting
      markdownLines.push(line);
    }
  }

  // Close any remaining table
  if (inTable && tableRows.length > 0) {
    markdownLines.push(""); // Empty line before table
    markdownLines.push(tableRows.join("\n"));
    markdownLines.push(""); // Empty line after table
  }

  // Clean up: remove excessive blank lines
  const cleanedMarkdown = markdownLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleanedMarkdown;
}
