/**
 * Patch Applier: apply edits from fix agent to file contents and state.
 * Used by validation loop: write patched files to project dir and update state.modifiedFiles.
 */

import * as fs from "fs/promises";
import * as path from "path";

export interface TextEdit {
  /** File path (relative to project root) */
  filePath: string;
  /** Exact old content to replace (preferred). If not provided, use lineRange. */
  oldContent?: string;
  /** New content to insert in place of oldContent or line range */
  newContent: string;
  /** Optional: 1-based start line and end line instead of oldContent */
  startLine?: number;
  endLine?: number;
  /** When set, replaces the ENTIRE file content (used for full-file fixes of syntax errors) */
  fullContent?: string;
}

/**
 * Apply a single edit to file content.
 * Uses oldContent match first; if not provided, uses startLine/endLine.
 */
function applyEditToContent(currentContent: string, edit: TextEdit): string {
  const lines = currentContent.split("\n");
  if (edit.oldContent != null && edit.oldContent !== "") {
    const idx = currentContent.indexOf(edit.oldContent);
    if (idx !== -1) {
      return currentContent.slice(0, idx) + edit.newContent + currentContent.slice(idx + edit.oldContent.length);
    }
    // Fallback: try line range if oldContent didn't match
  }
  if (edit.startLine != null && edit.endLine != null) {
    const start = Math.max(0, edit.startLine - 1);
    const end = Math.min(lines.length, edit.endLine);
    const before = lines.slice(0, start).join("\n");
    const after = lines.slice(end).join("\n");
    return (before ? before + "\n" : "") + edit.newContent + (after ? "\n" + after : "");
  }
  return currentContent;
}

/**
 * Apply a list of edits to in-memory file contents (path -> content).
 * Returns a new map with updated contents. Does not mutate input.
 */
export function applyEditsToContents(
  contents: Map<string, string>,
  edits: TextEdit[]
): Map<string, string> {
  const result = new Map(contents);
  for (const edit of edits) {
    const normalizedPath = edit.filePath.replace(/\\/g, "/");
    if (edit.fullContent != null) {
      result.set(normalizedPath, edit.fullContent);
    } else {
      const current = result.get(normalizedPath) ?? "";
      result.set(normalizedPath, applyEditToContent(current, edit));
    }
  }
  return result;
}

/**
 * Apply edits to files on disk (project root) and return updated path -> content for state.modifiedFiles.
 * - Reads current content from disk (or uses provided contents map).
 * - Applies edits, writes back to disk, returns array of { path, content } for state.modifiedFiles.
 */
export async function applyPatchesToProject(
  projectRoot: string,
  edits: TextEdit[],
  currentContents?: Map<string, string>
): Promise<Array<{ path: string; content: string }>> {
  const pathToContent = new Map<string, string>();
  if (currentContents) {
    currentContents.forEach((v, k) => pathToContent.set(k, v));
  }
  for (const edit of edits) {
    const normalizedPath = edit.filePath.replace(/\\/g, "/");
    if (!pathToContent.has(normalizedPath)) {
      try {
        const fullPath = path.join(projectRoot, normalizedPath);
        const content = await fs.readFile(fullPath, "utf8");
        pathToContent.set(normalizedPath, content);
      } catch {
        pathToContent.set(normalizedPath, "");
      }
    }
  }
  const updated = applyEditsToContents(pathToContent, edits);
  const modified: Array<{ path: string; content: string }> = [];
  for (const edit of edits) {
    const normalizedPath = edit.filePath.replace(/\\/g, "/");
    const content = updated.get(normalizedPath);
    if (content != null) {
      const fullPath = path.join(projectRoot, normalizedPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf8");
      modified.push({ path: normalizedPath, content });
    }
  }
  return modified;
}
