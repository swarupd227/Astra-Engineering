/**
 * Fix Validation Agent: propose minimal edits from build/test failures using RAG doc chunks.
 * Enriched with version context from user selections and auto-reads affected files from disk.
 */

import * as path from "path";
import * as fs from "fs/promises";
import type { StackModernizationState } from "../types";
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens, estimateTokens, MODEL_TOKEN_LIMITS } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";
import type { ParsedIssue } from "../../code-execution/parsers";
import type { TextEdit } from "../services/patch-applier";
import type { StackType } from "../../code-execution/types";

export interface FixValidationInput {
  state: StackModernizationState;
  projectPath: string;
  stack: StackType;
  parsedIssues: ParsedIssue[];
  lastStdout: string;
  lastStderr: string;
  fileContents?: Record<string, string>;
}

const EDIT_SCHEMA = `Respond with a JSON array of edits. Each edit:
{ "filePath": "relative/path/to/file.ext", "oldContent": "exact old snippet to replace", "newContent": "replacement" }
Or use line range: "startLine": 1, "endLine": 5, "newContent": "..." (1-based).
Use filePath relative to project root. Only include edits that fix the reported issues.`;

const FULL_FILE_EDIT_SCHEMA = `Respond with a JSON array. For files with SYNTAX ERRORS (missing braces, semicolons, parentheses, etc.),
return the COMPLETE corrected file using "fullContent":
{ "filePath": "relative/path/to/file.ext", "fullContent": "...entire corrected file content..." }

For .csproj or other small targeted fixes, you may use the patch format:
{ "filePath": "relative/path/to/file.ext", "oldContent": "exact old snippet", "newContent": "replacement" }

CRITICAL: When returning fullContent, you MUST return the COMPLETE file — do NOT truncate or abbreviate.
CRITICAL: PRESERVE ALL original business logic — only fix syntax errors and framework patterns.
Do NOT remove, simplify, or alter any business logic, API endpoints, service registrations, or application behavior.`;

const SYNTAX_ERROR_CODES = new Set([
  "CS1022", "CS1002", "CS1026", "CS1513", "CS0116", "CS8124", "CS8803", "CS1525",
  "CS1003", "CS1031", "CS1001",
]);

// Regex patterns for extracting file paths from raw output
const OUTPUT_FILE_PATTERNS = [
  /([A-Za-z]:\\[^\s(]+|\/[^\s(]+)\((\d+),(\d+)\)/g,
  /\[([A-Za-z]:\\[^\]]+\.csproj)\]/g,
  /\s+in\s+([A-Za-z]:\\[^:]+|\/[^:]+):line\s+(\d+)/g,
  /File\s+["']([^"']+)["'],\s*line\s+(\d+)/g,
];

/**
 * Build version context from user selections to inject into the LLM prompt.
 */
function buildVersionContext(state: StackModernizationState): string {
  const selections = state.userSelections ?? [];
  if (selections.length === 0) return "(No version selections available)";

  return selections
    .map((s) => `- **${s.package}**: current ${s.currentVersion} -> target ${s.selectedVersion} (${s.category})`)
    .join("\n");
}

/**
 * Build repo profile context for the LLM prompt.
 */
function buildRepoContext(state: StackModernizationState): string {
  const profile = (state as any).repoProfile;
  if (!profile) return "";
  const parts: string[] = [];
  if (profile.projectType) parts.push(`Project type: ${profile.projectType}`);
  if (profile.languages?.length) parts.push(`Languages: ${profile.languages.join(", ")}`);
  if (profile.runtimeVersions) {
    for (const [k, v] of Object.entries(profile.runtimeVersions)) {
      parts.push(`${k}: ${v}`);
    }
  }
  return parts.join("\n");
}

/**
 * Extract file paths from raw stdout/stderr that might not be in parsedIssues.
 */
function extractFilesFromRawOutput(stdout: string, stderr: string, projectPath: string): Set<string> {
  const combined = `${stdout}\n${stderr}`;
  const paths = new Set<string>();
  const projectPathNorm = projectPath.replace(/\\/g, "/").replace(/\/$/, "");

  for (const pattern of OUTPUT_FILE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(combined)) !== null) {
      let filePath = m[1].replace(/\\/g, "/").trim();
      if (filePath.toLowerCase().startsWith(projectPathNorm.toLowerCase() + "/")) {
        filePath = filePath.slice(projectPathNorm.length + 1);
      }
      if (filePath && !filePath.includes("*") && filePath.length < 300) {
        paths.add(filePath);
      }
    }
  }

  return paths;
}

/**
 * Read files from disk that aren't already in the provided fileContents map.
 */
async function autoReadMissingFiles(
  projectPath: string,
  parsedIssues: ParsedIssue[],
  stdout: string,
  stderr: string,
  existingContents: Record<string, string>
): Promise<Record<string, string>> {
  const result = { ...existingContents };

  // Gather all paths from parsed issues
  const neededPaths = new Set<string>();
  for (const issue of parsedIssues) {
    if (issue.file) neededPaths.add(issue.file);
  }

  // Also extract from raw output
  const rawPaths = extractFilesFromRawOutput(stdout, stderr, projectPath);
  for (const p of rawPaths) neededPaths.add(p);

  // Read missing files from disk
  for (const relPath of neededPaths) {
    if (result[relPath] && result[relPath].length > 0) continue;
    try {
      const fullPath = path.isAbsolute(relPath)
        ? relPath
        : path.join(projectPath, relPath);
      result[relPath] = await fs.readFile(fullPath, "utf8");
    } catch {
      // File not found on disk
    }
  }

  return result;
}

/**
 * Deduplicate issues: group by errorCode + root message pattern, keep at most 3 examples per group.
 */
function deduplicateIssues(issues: ParsedIssue[]): { summary: string; dedupedIssues: ParsedIssue[] } {
  const groups = new Map<string, ParsedIssue[]>();
  for (const issue of issues) {
    const key = `${issue.errorCode || issue.type}::${(issue.message || "").replace(/['"][^'"]+['"]/g, "X").slice(0, 80)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(issue);
  }

  const deduped: ParsedIssue[] = [];
  const summaryParts: string[] = [];
  for (const [key, group] of groups) {
    const kept = group.slice(0, 3);
    deduped.push(...kept);
    if (group.length > 3) {
      summaryParts.push(`- ${key.split("::")[0]}: ${group.length} occurrences (showing 3, ${group.length - 3} more with same pattern in files: ${group.slice(3).map(g => g.file || "?").join(", ")})`);
    }
  }

  const summary = summaryParts.length > 0
    ? `\n## Deduplicated error summary (${issues.length} total errors, ${deduped.length} shown)\n${summaryParts.join("\n")}\nFix the ROOT CAUSE of each error group — e.g., add missing ProjectReferences or NuGet packages to the .csproj rather than editing each .cs file individually.`
    : "";

  return { summary, dedupedIssues: deduped };
}

/**
 * Find and read .csproj files in the project that might need fixing.
 */
async function readCsprojFiles(projectPath: string, existingContents: Record<string, string>): Promise<Record<string, string>> {
  const result = { ...existingContents };
  async function scanDir(dir: string, depth: number) {
    if (depth > 4) return;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !["node_modules", ".git", "bin", "obj", ".vs"].includes(entry.name)) {
          await scanDir(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".csproj")) {
          const full = path.join(dir, entry.name);
          const rel = path.relative(projectPath, full).replace(/\\/g, "/");
          if (!result[rel]) {
            try {
              result[rel] = await fs.readFile(full, "utf8");
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* skip */ }
  }
  await scanDir(projectPath, 0);
  return result;
}

/**
 * Detect if the majority of errors in a file are syntax errors that need full-file replacement.
 * Returns a map of filePath -> true if that file should use full-file replacement.
 */
function detectSyntaxErrorFiles(parsedIssues: ParsedIssue[]): Map<string, boolean> {
  const fileSyntaxCounts = new Map<string, { syntax: number; total: number }>();
  for (const issue of parsedIssues) {
    if (!issue.file) continue;
    const counts = fileSyntaxCounts.get(issue.file) ?? { syntax: 0, total: 0 };
    counts.total++;
    if (issue.errorCode && SYNTAX_ERROR_CODES.has(issue.errorCode)) {
      counts.syntax++;
    }
    fileSyntaxCounts.set(issue.file, counts);
  }

  const result = new Map<string, boolean>();
  for (const [file, counts] of fileSyntaxCounts) {
    if (counts.syntax > 0 && counts.syntax / counts.total > 0.5) {
      result.set(file, true);
    }
  }
  return result;
}

/**
 * Propose edits to fix build/test failures. Uses RAG chunks, affected file contents,
 * version context, and repo profile.
 * When syntax errors dominate a file, uses full-file replacement strategy.
 */
export async function proposeFixes(input: FixValidationInput): Promise<TextEdit[]> {
  const { state, projectPath, stack, parsedIssues, lastStdout, lastStderr } = input;
  const forceFullFile = (input as any).forceFullFile === true;

  let fileContents = await autoReadMissingFiles(
    projectPath,
    parsedIssues,
    lastStdout,
    lastStderr,
    input.fileContents ?? {}
  );

  fileContents = await readCsprojFiles(projectPath, fileContents);

  const { queryDocs } = await import("../../code-execution/rag/query");
  const query = [lastStdout, lastStderr, ...parsedIssues.map((i) => i.message)].join("\n").slice(0, 2000);
  const docChunks = await queryDocs(stack as "dotnet" | "python", query, 5);

  const { summary: dedupSummary, dedupedIssues } = deduplicateIssues(parsedIssues);

  const issuesBlock = dedupedIssues
    .map(
      (i) =>
        `- [${i.type}${i.severity ? "/" + i.severity : ""}] ${i.errorCode ? i.errorCode + " " : ""}${i.file ?? "unknown"}:${i.line ?? "?"} ${i.testName ?? ""} ${i.message}${i.snippet ? `\n  Context:\n${i.snippet}` : ""}`
    )
    .join("\n");

  const csprojEntries = Object.entries(fileContents).filter(([p]) => p.endsWith(".csproj"));
  const otherEntries = Object.entries(fileContents)
    .filter(([p, c]) => !p.endsWith(".csproj") && c.length > 0)
    .slice(0, 10);

  const versionContext = buildVersionContext(state);
  const repoContext = buildRepoContext(state);
  const docsBlock = docChunks.length ? `## Relevant documentation\n${docChunks.map((t) => t).join("\n\n---\n\n")}` : "";

  // Detect if syntax errors dominate — if so, use full-file replacement
  const syntaxErrorFiles = detectSyntaxErrorFiles(parsedIssues);
  const useSyntaxFixStrategy = forceFullFile || syntaxErrorFiles.size > 0;

  if (useSyntaxFixStrategy) {
    const filesToReplace = forceFullFile
      ? new Set(parsedIssues.map(i => i.file).filter(Boolean) as string[])
      : syntaxErrorFiles;

    // Build a focused prompt for files needing full replacement (only files with syntax errors, not .csproj)
    const syntaxFilesBlock: string[] = [];
    const patchFilesBlock: string[] = [];

    for (const [filePath, content] of [...csprojEntries, ...otherEntries]) {
      if (!content || content.length === 0) continue;
      if (filesToReplace.has(filePath) && content.length <= 15000) {
        syntaxFilesBlock.push(`### ${filePath} (FULL REPLACEMENT NEEDED — syntax errors)\n\`\`\`\n${content}\n\`\`\``);
      } else {
        patchFilesBlock.push(`### ${filePath}\n\`\`\`\n${content.slice(0, 6000)}\n\`\`\``);
      }
    }

    const prompt = `You are a senior engineer fixing build failures in a ${stack} project.
The files below have SYNTAX ERRORS (missing braces, semicolons, parentheses, mixed top-level/namespace patterns).
Line-range patches have been tried and FAILED. You MUST return the COMPLETE corrected file content.

## Target Version Context
${versionContext}

## Repository Profile
${repoContext || "(Not available)"}

## Build failures (${parsedIssues.length} total)
${issuesBlock}
${dedupSummary}

## FILES NEEDING FULL REPLACEMENT (return complete corrected content using "fullContent")
${syntaxFilesBlock.join("\n\n") || "(None)"}

## Other files (use patch format if needed)
${patchFilesBlock.join("\n\n") || "(None)"}

${docsBlock}

## CRITICAL INSTRUCTIONS
- For files marked "FULL REPLACEMENT NEEDED": return the COMPLETE corrected file using { "filePath": "...", "fullContent": "..." }
- PRESERVE ALL original business logic, API endpoints, service registrations, middleware — only fix syntax errors
- Do NOT remove, simplify, or shorten any business code
- For C# Program.cs: ensure the file uses either minimal hosting (top-level statements only, no namespace/class) or traditional (namespace + class + Main method). Do not mix both.
- Verify ALL braces {}, parentheses (), semicolons ; are correctly matched
- The returned code MUST compile without any syntax errors
- For .csproj or non-syntax issues, use the standard patch format: { "filePath": "...", "oldContent": "...", "newContent": "..." }

${FULL_FILE_EDIT_SCHEMA}

JSON array of edits:`;

    const edits = await callLLMForEdits(state, prompt);
    if (edits.length > 0) return edits;
  }

  // Standard patch-based strategy
  const filesBlock = [...csprojEntries, ...otherEntries]
    .filter(([, content]) => content.length > 0)
    .map(([filePath, content]) => `### ${filePath}\n\`\`\`\n${content.slice(0, 6000)}\n\`\`\``)
    .join("\n\n");

  const prompt = `You are a senior engineer fixing build/test failures in a ${stack} project.

## Target Version Context (user-selected upgrades)
${versionContext}

IMPORTANT: All fixes MUST be compatible with the target versions above.
For example, if upgrading to .NET 10, use net10.0 TFM, not net8.0.
If upgrading EF Core to 10.x, ensure all EF Core packages use the same 10.x version.

## Repository Profile
${repoContext || "(Not available)"}

## Build/Test failures (${parsedIssues.length} total)
${issuesBlock}
${dedupSummary}

## Affected file contents (project root relative paths)
${filesBlock || "(No file contents provided)"}

${docsBlock}

## Instructions
- THINK ABOUT ROOT CAUSES FIRST. Many individual CS0234/CS0246 "missing assembly reference" errors share a common root cause:
  - The .csproj file is missing <ProjectReference> entries to project assemblies
  - The .csproj file is missing NuGet <PackageReference> entries (e.g., Microsoft.EntityFrameworkCore, Microsoft.AspNetCore.Mvc.Testing)
  - FIX THE .csproj FIRST rather than editing each .cs file individually.
- After fixing .csproj, if individual .cs files have wrong using/import statements, fix those too.
- PRESERVE ALL original business logic — only fix compilation errors, do NOT remove or alter business code.
- Prefer oldContent/newContent replacements; use startLine/endLine only if the exact snippet is ambiguous.
- Keep filePath relative to project root (e.g. src/Program.cs not /workspace/src/Program.cs).
- You MUST propose at least one edit. If you see missing assembly references, add ProjectReferences or PackageReferences to the .csproj.
- For syntax errors in C# files (missing braces, semicolons, etc.), you may return the complete file using: { "filePath": "...", "fullContent": "...entire file..." }

### Common fix patterns
- **CS0234/CS0246 "type or namespace does not exist"**: The .csproj is missing a <ProjectReference>. Add it.
- **CS1022/CS1002/CS1026/CS1513 (syntax errors)**: The file has unmatched braces, missing semicolons, or mixed top-level/namespace patterns. Return the full corrected file using "fullContent".
- **CS0116/CS8803 "namespace cannot directly contain members" / "top-level statements must precede"**: The file mixes top-level statements with namespace declarations. Choose ONE pattern and rewrite consistently.
- **Missing WebApplicationFactory<>**: Add \`<PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="X.*" />\` to the test .csproj.
- **Missing EntityFrameworkCore namespaces**: Add \`<PackageReference Include="Microsoft.EntityFrameworkCore.InMemory" Version="X.*" />\` to the test .csproj.
- **NU1102** (package not found): Package absorbed into shared framework. REMOVE the PackageReference.
- **NU1605** (package downgrade): All packages in same family must use SAME version.

${EDIT_SCHEMA}

JSON array of edits:`;

  const edits = await callLLMForEdits(state, prompt);

  if (edits.length === 0 && parsedIssues.length > 0) {
    const rawErrors = [lastStdout, lastStderr].filter(Boolean).join("\n").slice(0, 4000);

    const csprojBlock = csprojEntries
      .map(([filePath, content]) => `### ${filePath}\n\`\`\`\n${content}\n\`\`\``)
      .join("\n\n");

    const retryPrompt = `You are a senior engineer. The previous fix attempt returned NO edits. You MUST propose at least one edit.

## Raw build output (first 4000 chars)
${rawErrors}

## Target versions
${versionContext}

## .csproj files
${csprojBlock || "(None found)"}

## Source files
${otherEntries.slice(0, 5).map(([p, c]) => `### ${p}\n\`\`\`\n${c.slice(0, 3000)}\n\`\`\``).join("\n\n")}

CRITICAL: PRESERVE ALL business logic. Only fix compilation errors.
For syntax errors (missing braces/semicolons), return the full corrected file using "fullContent".
For missing references, add ProjectReferences or PackageReferences to the .csproj.

${FULL_FILE_EDIT_SCHEMA}

JSON array of edits:`;

    return callLLMForEdits(state, retryPrompt);
  }

  return edits;
}

const FIX_SYSTEM_CONTENT = `You output only a valid JSON array of edit objects. No markdown, no explanation.
CRITICAL: You MUST output at least one edit. If you see build errors, there is ALWAYS something to fix.
Focus on ROOT CAUSES: missing ProjectReferences in .csproj, missing NuGet packages, wrong using statements.
For syntax errors (missing braces, semicolons), use "fullContent" to return the COMPLETE corrected file.
PRESERVE ALL business logic — only fix compilation issues.`;

/**
 * Split a large prompt into batches if the estimated input + output exceeds
 * model limits. Returns one or more prompts that each fit within budget.
 */
function splitPromptIfNeeded(prompt: string, model: string): string[] {
  const limits = MODEL_TOKEN_LIMITS[model] || MODEL_TOKEN_LIMITS["default"];
  const systemOverhead = estimateTokens(FIX_SYSTEM_CONTENT);
  const inputLimit = Math.floor(limits.input * 0.90) - systemOverhead;
  const promptTokens = estimateTokens(prompt);

  if (promptTokens <= inputLimit) return [prompt];

  // Split by file sections: look for "### " headings
  const sections = prompt.split(/(?=^### )/m);
  const header = sections[0]; // everything before first file section
  const fileSections = sections.slice(1);

  if (fileSections.length <= 1) {
    // Can't split further — truncate
    const charLimit = Math.floor(inputLimit * 3.5);
    return [prompt.slice(0, charLimit)];
  }

  const headerTokens = estimateTokens(header);
  const batches: string[] = [];
  let currentBatch = header;
  let currentTokens = headerTokens;

  for (const section of fileSections) {
    const sectionTokens = estimateTokens(section);
    if (currentTokens + sectionTokens > inputLimit && currentBatch !== header) {
      batches.push(currentBatch);
      currentBatch = header;
      currentTokens = headerTokens;
    }
    currentBatch += section;
    currentTokens += sectionTokens;
  }
  if (currentBatch !== header) batches.push(currentBatch);

  return batches;
}

async function callLLMForEdits(state: StackModernizationState, prompt: string): Promise<TextEdit[]> {
  const { client, model } = getLLMClient(state.llmProvider);
  const maxTokens = safeMaxTokens(AGENT_TOKEN_BUDGETS.fixValidation, model);
  const budgetBlock = buildBudgetConstraint("fixValidation", "code");

  const batches = splitPromptIfNeeded(prompt, model);
  const allEdits: TextEdit[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const response = await trackedLLMCall(client, {
      model,
      messages: [
        { role: "system", content: `${budgetBlock}\n\n${FIX_SYSTEM_CONTENT}` },
        { role: "user", content: batch },
      ],
      temperature: 0,
      max_tokens: maxTokens,
    }, { analysisId: state.analysisId, phase: "validation", agent: "FixValidation" });

    const content = response?.choices?.[0]?.message?.content ?? "";
    const raw = content.replace(/```json?\s*/i, "").replace(/```\s*$/, "").trim();

    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) {
        continue;
      }
      const edits = arr
        .filter((e: any) => e && (e.filePath || e.path) && (e.newContent != null || e.fullContent != null))
        .map((e: any) => ({
          filePath: (e.filePath ?? e.path ?? "").replace(/^\/workspace\/?/, ""),
          oldContent: e.oldContent,
          newContent: e.fullContent ? "" : String(e.newContent),
          startLine: e.startLine,
          endLine: e.endLine,
          fullContent: e.fullContent ? String(e.fullContent) : undefined,
        }));
      const fullFileCount = edits.filter((e: TextEdit) => e.fullContent).length;
      const patchCount = edits.length - fullFileCount;
      allEdits.push(...edits);
    } catch (err) {
    }
  }

  return allEdits;
}
