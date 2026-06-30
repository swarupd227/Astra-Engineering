import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

// Single shared converter. The GFM plugin gives us strikethrough, task lists
// and fenced code blocks. Table handling is overridden below.
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.use(gfm);

// Non-content elements that must never appear in the output. Word/Confluence
// pastes carry a big <style> block (@font-face, mso-*, @page) plus other head
// metadata; turndown would otherwise emit their CSS as raw text.
const NON_CONTENT_TAGS = [
  "style",
  "script",
  "head",
  "meta",
  "link",
  "title",
  "noscript",
];
turndown.remove(NON_CONTENT_TAGS as any);

function cleanCellText(node: Element): string {
  return (node.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");
}

/**
 * Convert ANY HTML <table> into a GFM pipe table.
 *
 * turndown-plugin-gfm only converts tables whose first row is entirely <th>,
 * and keeps everything else as raw HTML. Real-world tables (Confluence, Word,
 * Excel, Wikipedia) rarely meet that bar, so we build the Markdown ourselves:
 * we read each row's cells, expand colspan into blank columns, pad rows to a
 * uniform width, and always emit a header + separator row (GFM requires one –
 * if the source has no header we promote the first row).
 */
function htmlTableToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.rows);
  if (rows.length === 0) return "";

  const matrix: string[][] = rows.map((row) => {
    const cells: string[] = [];
    for (const cell of Array.from(row.cells)) {
      const text = cleanCellText(cell);
      const span = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10) || 1);
      cells.push(text);
      for (let s = 1; s < span; s++) cells.push("");
    }
    return cells;
  });

  const colCount = Math.max(...matrix.map((r) => r.length));
  if (colCount === 0) return "";

  const pad = (cells: string[]): string[] => {
    const out = [...cells];
    while (out.length < colCount) out.push("");
    return out;
  };
  const toLine = (cells: string[]): string => `| ${pad(cells).join(" | ")} |`;

  const header = toLine(matrix[0]);
  const separator = `| ${Array(colCount).fill("---").join(" | ")} |`;
  const body = matrix.slice(1).map(toLine);

  return `\n\n${[header, separator, ...body].join("\n")}\n\n`;
}

turndown.addRule("gfmTablesAll", {
  filter: "table",
  replacement: (content, node) => {
    try {
      const md = htmlTableToMarkdown(node as HTMLTableElement);
      return md || content;
    } catch {
      return content;
    }
  },
});

/**
 * Pre-clean rich clipboard HTML before Markdown conversion.
 *
 * Strips the markup that pollutes Confluence/Word/Excel pastes:
 *  - <style>/<script>/<head> metadata (Office style blocks: @font-face, mso-*),
 *  - HTML comments (Word wraps CSS and conditional blocks in comments, plus the
 *    CF_HTML StartFragment/EndFragment markers),
 *  - Office namespaced tags like <o:p>, <w:sdt>, <m:…> (unwrapped to keep text).
 */
export function cleanPastedHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Remove HTML comment nodes (this is where Word hides its CSS).
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
    const comments: Comment[] = [];
    let current = walker.nextNode();
    while (current) {
      comments.push(current as Comment);
      current = walker.nextNode();
    }
    comments.forEach((comment) => comment.parentNode?.removeChild(comment));

    // Remove non-content elements outright.
    doc.querySelectorAll(NON_CONTENT_TAGS.join(",")).forEach((el) => el.remove());

    // Unwrap Office namespaced elements (e.g. <o:p>) — keep their children.
    Array.from(doc.querySelectorAll("*")).forEach((el) => {
      if (el.tagName.includes(":")) {
        el.replaceWith(...Array.from(el.childNodes));
      }
    });

    return doc.body ? doc.body.innerHTML : html;
  } catch {
    return html;
  }
}

/**
 * Convert rich clipboard HTML into clean GFM Markdown.
 * Pre-cleans Office/Confluence junk, converts tables to pipe tables, and
 * collapses excess blank lines. Returns "" if conversion yields nothing.
 */
export function richHtmlToMarkdown(html: string): string {
  return turndown
    .turndown(cleanPastedHtml(html))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
