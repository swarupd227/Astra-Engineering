/**
 * Mermaid Syntax Extractor
 * Extracts Mermaid code blocks from wiki content and marks their location
 */

export interface MermaidBlock {
  id: string;
  syntax: string;
  sourceFile: string;
  position: number;
  blockIndex: number;
  fullMatch: string;
  startIndex: number;
  endIndex: number;
}

export interface MermaidExtractionResult {
  blocks: MermaidBlock[];
  /** Content with ::: mermaid fences normalized to ```mermaid (indices match blocks). */
  normalizedContent: string;
}

/**
 * Normalize Azure DevOps-style ::: mermaid fences to standard ```mermaid blocks.
 */
export function normalizeMermaidFences(content: string): string {
  return content
    .replace(/:::\s*mermaid\s*\n([\s\S]*?)\n:::/gi, (_match, code) => `\`\`\`mermaid\n${String(code).trim()}\n\`\`\``)
    .replace(/:::\s*mermaid\s+([\s\S]*?):::/gi, (_match, code) => `\`\`\`mermaid\n${String(code).trim()}\n\`\`\``);
}

/**
 * Extracts all Mermaid code blocks from content.
 * Indices are relative to normalizedContent — use that string when splicing replacements.
 */
export function extractMermaidBlocks(
  content: string,
  sourceFile: string
): MermaidExtractionResult {
  if (!content || content.trim().length === 0) {
    return { blocks: [], normalizedContent: content || '' };
  }

  const normalizedContent = normalizeMermaidFences(content);
  const blocks: MermaidBlock[] = [];
  const mermaidBlockRegex = /```mermaid\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let blockIndex = 0;

  while ((match = mermaidBlockRegex.exec(normalizedContent)) !== null) {
    const syntax = match[1]?.trim() ?? '';
    if (!syntax) continue;

    blockIndex++;
    const fullMatch = match[0];
    const offset = match.index;

    blocks.push({
      id: `${sourceFile}_${blockIndex}`,
      syntax,
      sourceFile,
      position: offset,
      blockIndex,
      fullMatch,
      startIndex: offset,
      endIndex: offset + fullMatch.length,
    });
  }

  blocks.sort((a, b) => a.position - b.position);

  console.log(`[MermaidExtractor] Extracted ${blocks.length} Mermaid block(s) from "${sourceFile}"`);

  return { blocks, normalizedContent };
}

/**
 * Extracts Mermaid blocks from multiple wiki pages
 */
export function extractMermaidFromPages(
  pages: Array<{ title: string; content: string }>
): Map<string, MermaidBlock[]> {
  const result = new Map<string, MermaidBlock[]>();

  for (const page of pages) {
    const { blocks } = extractMermaidBlocks(page.content, page.title);
    if (blocks.length > 0) {
      result.set(page.title, blocks);
    }
  }

  console.log(`[MermaidExtractor] Extracted Mermaid blocks from ${result.size} page(s)`);

  return result;
}
