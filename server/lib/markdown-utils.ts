/**
 * Generates a Table of Contents (TOC) for a given markdown string.
 * Currently filters for main numbered headings (e.g., "1. Introduction", "2. Scope").
 */
export function generateTestPlanToc(content: string): string {
  if (!content || content.trim().length < 100) return "";

  // Extract all standard markdown headings (h1-h6)
  const allHeadings = content.match(/^#{1,6}\s+.+$/gm) || [];
  
  // Filter for ONLY main numbered headings (e.g., 1., 2., 3., NOT 1.1, 2.7, etc.)
  const mainNumberedHeadings = allHeadings.filter((heading) => {
    const title = heading.replace(/^#{1,6}\s+/, '');
    // Match headings that start with ONLY a single digit followed by space or period
    // Exclude subsections like "1.1", "2.7", etc.
    return /^\d+[\s.]/.test(title) && !/^\d+\.\d/.test(title);
  });
  
  // Sort headings by their leading number in ascending order
  const sortedHeadings = mainNumberedHeadings.sort((a, b) => {
    const numA = parseInt(a.replace(/^#+\s+(\d+).*/, '$1'), 10);
    const numB = parseInt(b.replace(/^#+\s+(\d+).*/, '$1'), 10);
    return numA - numB;
  });
  
  if (sortedHeadings.length === 0) return "";

  // Generate Table of Contents with standard markdown links and sequential numbering
  const tableOfContents = sortedHeadings
    .map((heading, index) => {
      const rawTitle = heading.replace(/^#{1,6}\s+/, '');
      // Strip the existing leading number from the AI (e.g., "4. Title" -> "Title")
      const titleWithoutNumber = rawTitle.replace(/^\d+[\s.]+\s*/, '');
      
      // Use a consistent sequential number for the TOC display
      const sequentialNumber = index + 1;
      const displayTitle = `${sequentialNumber}. ${titleWithoutNumber}`;
      
      // Generate anchor ID following standard markdown conventions (lowercase, hyphenated)
      const anchor = rawTitle
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')  // Remove special chars
        .replace(/\s+/g, '-')      // Replace spaces with hyphens
        .replace(/-+/g, '-')       // Remove multiple hyphens
        .replace(/^-+|-+$/g, '');  // Remove leading/trailing hyphens
      
      return `- [${displayTitle}](#${anchor})`;
    })
    .join('\n');

  return tableOfContents;
}

/**
 * Combines a generated TOC with the original content.
 * Idempotent: won't inject if a TOC already exists.
 */
export function injectToc(content: string): string {
  if (!content) return content;
  
  // Don't inject if TOC already exists
  if (content.includes('## Table of Contents') || content.includes('# Table of Contents')) {
    return content;
  }

  const toc = generateTestPlanToc(content);
  if (!toc) return content;
  
  return `# Table of Contents\n\n${toc}\n\n---\n\n${content}`;
}

import { marked } from 'marked';

/**
 * Converts markdown to HTML for Azure DevOps work item descriptions.
 * Uses 'marked' for robust conversion including tables and lists.
 */
export function formatMarkdownForAdo(content: string): string {
  if (!content) return "";
  
  try {
    // Synchronous parse for standard markdown/GFM
    const html = marked.parse(content);
    return typeof html === 'string' ? html : String(html);
  } catch (error) {
    console.error("[Markdown Utils] Error converting markdown to ADO HTML:", error);
    // Fallback to basic conversion if marked fails
    return content
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  }
}
