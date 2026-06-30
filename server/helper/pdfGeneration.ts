/**
 * PDF and DOCX generation utilities for BRD export
 */

/**
 * Helper to create safe filename from title and version
 */
export function createSafeFilename(title: string, version: string, ext: string): string {
  const safeTitle = (title || 'document')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  const safeVersion = version ? `-${version.replace(/[^a-zA-Z0-9.-]/g, '')}` : '-1.0';
  return `BRD-${safeTitle}${safeVersion}.${ext}`;
}



/**
 * Strip the document title from the beginning of markdown content.
 * 
 * REASON FOR THIS FUNCTION:
 * The rawMarkdown often starts with "# Document Title" and may include version info.
 * To prevent duplication, we extract and remove this from the content BEFORE
 * rendering, since exportBRD adds the title/version separately.
 * 
 * This ensures the title appears EXACTLY ONCE on the first page.
 */
function stripTitleFromMarkdown(markdown: string, expectedTitle?: string): string {
  if (!markdown) return '';

  const lines = markdown.split('\n');
  let startIndex = 0;

  // Check if first non-empty line is an h1 heading
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Pattern 1: Markdown H1 ("# Title")
    const h1Match = trimmed.match(/^#\s+(.+)$/);
    if (h1Match) {
      startIndex = i + 1;
      break;
    }

    // Pattern 2: Numbered heading at start ("1. Title" or "1) Title")
    const numberedMatch = trimmed.match(/^[*#\s]*(\d+)[.)]\s+(.+)/);
    if (numberedMatch && numberedMatch[1] === '1') {
      startIndex = i + 1;
      break;
    }

    // Not a title line, so stop looking
    break;
  }

  // Also skip any immediate version line (e.g., "Version: X.X")
  if (startIndex < lines.length) {
    const nextLineContent = lines[startIndex].trim();
    if (nextLineContent.match(/^version\s*:/i) || nextLineContent.match(/^v[\d.]+/i)) {
      startIndex++;
    }
  }

  // Skip empty lines after title/version
  while (startIndex < lines.length && !lines[startIndex].trim()) {
    startIndex++;
  }

  return lines.slice(startIndex).join('\n');
}

/**
 * Export BRD to DOCX format
 * 
 * NOTE: PDF export has been moved to PDFKit-based endpoint (/api/brd/export-pdf)
 * for better Azure compatibility (no Chromium/Playwright dependencies required).
 * 
 * TITLE & VERSION HANDLING:
 * This function is responsible for rendering the document title and version EXACTLY ONCE.
 * We strip any existing title from the markdown to prevent duplication.
 * 
 * @param options Export options (DOCX only)
 * @returns Buffer containing the exported DOCX file
 */
export async function exportBRD(options: {
  format: 'docx';
  title: string;
  version: string;
  rawMarkdown: string;
  markdownToDocxBuffer: (content: string, title: string) => Promise<Buffer>;
}): Promise<Buffer> {
  const { format, title, version, rawMarkdown, markdownToDocxBuffer } = options;

  if (format === 'docx') {
    // For DOCX: Don't strip title here - let markdownToDocxBuffer handle it
    // Just pass the clean content with version info
    // markdownToDocxBuffer will prepend the title as markdown heading
    const cleanMarkdown = stripTitleFromMarkdown(rawMarkdown, title);

    // Build content starting with version info
    const docxContent = `**Version:** ${version}

${cleanMarkdown}`;

    // Pass to DOCX converter with title parameter
    // markdownToDocxBuffer will prepend: # Title
    // Then convert all markdown (title + version + content) to HTML
    return await markdownToDocxBuffer(docxContent, title);
  } else {
    throw new Error(`Unsupported format: ${format}. Use DOCX only. For PDF, use /api/brd/export-pdf endpoint with PDFKit`);
  }
}