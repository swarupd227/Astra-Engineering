/**
 * document-extractor.ts
 *
 * Extracts plain text from uploaded files so they can be included as context
 * in the AI test-case generation pipeline.
 *
 * Supported formats (all packages already present in package.json):
 *   .txt / .md / .feature / .spec.ts / .spec.js / .json  → read as-is
 *   .pdf  → pdf-parse
 *   .xlsx / .xls                                          → xlsx
 *   .docx                                                 → mammoth (fallback: raw text scan)
 *
 * Per-file cap: 8 000 characters (truncated with notice).
 */

import * as fs from "fs";
import * as path from "path";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExtractedDocument {
  /** Original file name supplied by the client */
  fileName: string;
  /** Detected file extension / type */
  fileType: string;
  /** Extracted plain text (max 8 000 chars) */
  content: string;
  /** Character count AFTER truncation */
  charCount: number;
  /** Whether the content was truncated */
  truncated: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CHARS = 8_000;

// Plain-text MIME types and extensions that need no special processing
const PLAIN_TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".feature",
  ".spec.ts", ".spec.js", ".ts", ".js",
  ".json", ".yaml", ".yml", ".csv",
]);

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Extract readable text from a file buffer.
 *
 * @param buffer   Raw file bytes
 * @param fileName Original file name (used for extension detection)
 * @param mimeType MIME type hint from the multipart upload
 */
export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ExtractedDocument> {
  const ext = path.extname(fileName).toLowerCase();

  let rawText: string;

  try {
    if (PLAIN_TEXT_EXTS.has(ext) || mimeType.startsWith("text/")) {
      rawText = extractPlainText(buffer);
    } else if (ext === ".pdf" || mimeType === "application/pdf") {
      rawText = await extractPdf(buffer, fileName);
    } else if (
      ext === ".xlsx" ||
      ext === ".xls" ||
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel"
    ) {
      rawText = extractXlsx(buffer, fileName);
    } else if (
      ext === ".docx" ||
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      rawText = await extractDocx(buffer, fileName);
    } else {
      // Unknown type — attempt UTF-8 decode, strip non-printable chars
      console.warn(`[DocumentExtractor] Unknown type for "${fileName}" (${mimeType}), falling back to raw UTF-8`);
      rawText = extractPlainText(buffer);
    }
  } catch (err: any) {
    console.error(`[DocumentExtractor] Extraction failed for "${fileName}":`, err?.message ?? err);
    rawText = `[Extraction failed for ${fileName}: ${err?.message ?? "unknown error"}]`;
  }

  // Normalise whitespace: collapse blank lines, trim lines
  const normalised = normaliseWhitespace(rawText);

  // Enforce per-document cap
  const truncated = normalised.length > MAX_CHARS;
  const content = truncated
    ? normalised.slice(0, MAX_CHARS) +
      `\n\n[... content truncated — original length ${normalised.length} chars, limit ${MAX_CHARS} ...]`
    : normalised;

  return {
    fileName,
    fileType: ext || mimeType,
    content,
    charCount: content.length,
    truncated,
  };
}

// ─── Format-specific extractors ───────────────────────────────────────────────

function extractPlainText(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

async function extractPdf(buffer: Buffer, fileName: string): Promise<string> {
  try {
    // pdf-parse is a CommonJS module; dynamic import handles ESM interop
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return result.text ?? "";
  } catch (err: any) {
    console.warn(`[DocumentExtractor] pdf-parse failed for "${fileName}":`, err?.message);
    // Fallback: extract printable ASCII from the binary
    return extractPrintableAscii(buffer);
  }
}

function extractXlsx(buffer: Buffer, fileName: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const lines: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      lines.push(`=== Sheet: ${sheetName} ===`);
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      lines.push(csv);
    }

    return lines.join("\n");
  } catch (err: any) {
    console.warn(`[DocumentExtractor] xlsx extraction failed for "${fileName}":`, err?.message);
    return extractPlainText(buffer);
  }
}

async function extractDocx(buffer: Buffer, fileName: string): Promise<string> {
  try {
    // mammoth is NOT in package.json — attempt dynamic import and fall back gracefully
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  } catch (importErr) {
    // mammoth not installed — fall back to raw printable-text extraction
    console.warn(
      `[DocumentExtractor] mammoth not available for "${fileName}", using raw text fallback`
    );
    return extractPrintableAscii(buffer);
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Scans a binary buffer and returns a string of printable ASCII characters,
 * reconstructing word-like sequences. Useful as a last-resort fallback for
 * binary formats (DOCX, PDF) when the proper parser is unavailable.
 */
function extractPrintableAscii(buffer: Buffer): string {
  const WORD_MIN_LEN = 3;
  const words: string[] = [];
  let current = "";

  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    // Printable ASCII range + common whitespace
    if ((c >= 0x20 && c <= 0x7e) || c === 0x09 || c === 0x0a || c === 0x0d) {
      current += String.fromCharCode(c);
    } else {
      if (current.trim().length >= WORD_MIN_LEN) {
        words.push(current.trim());
      }
      current = "";
    }
  }
  if (current.trim().length >= WORD_MIN_LEN) {
    words.push(current.trim());
  }

  return words.join(" ");
}

/**
 * Collapses runs of blank lines and trims each line.
 * Removes lines that contain only whitespace.
 */
function normaliseWhitespace(text: string): string {
  const lines = text.split(/\r?\n/);
  const cleaned: string[] = [];
  let consecutiveBlanks = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      consecutiveBlanks++;
      if (consecutiveBlanks <= 1) {
        cleaned.push(""); // allow at most one consecutive blank line
      }
    } else {
      consecutiveBlanks = 0;
      cleaned.push(line);
    }
  }

  return cleaned.join("\n").trim();
}
