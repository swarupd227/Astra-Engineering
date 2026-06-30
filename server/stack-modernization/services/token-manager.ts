/**
 * Smart Token Management for LLM Calls
 * 
 * Handles large code files by:
 * 1. Estimating token counts accurately
 * 2. Intelligently chunking/summarizing files that exceed budget
 * 3. Prioritizing important code sections (imports, class defs, function signatures)
 * 4. Providing budget-based file inclusion for prompt construction
 */

import type { ExtractedFile } from "../types";
import { sanitizeForContentFilter } from "./prompt-sanitizer";
import { MODEL_TOKEN_MAP, DEFAULT_MODEL_ID, NEW_API_MODEL_SUBSTRINGS } from "../../llm-config-constants";

/* ------------------------------------------------------------------ */
/*  Token Estimation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Estimate token count for a string.
 * Uses the ~4 chars per token heuristic for English/code text.
 * This is conservative — real tokenizers vary, but this keeps us safe.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * Model token limits (input and max output).
 * Values are driven by llm-config-constants.ts — edit that file to update.
 */
export const MODEL_TOKEN_LIMITS = MODEL_TOKEN_MAP;

/**
 * Detect whether a model name requires `max_completion_tokens` instead of `max_tokens`.
 * Driven entirely by NEW_API_MODEL_SUBSTRINGS in llm-config-constants.ts —
 * edit that list to add/remove model families without touching this file.
 */
export function isModernGptModel(model: string): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return NEW_API_MODEL_SUBSTRINGS.some((substr) => lower.includes(substr.toLowerCase()));
}

/**
 * Normalize LLM request params for the target model.
 *
 * GPT-5+ (and gpt-4.1, o3/o4-mini) differ from legacy models:
 *   - `max_completion_tokens` replaces `max_tokens`
 *   - `temperature` only supports the default (1); explicit 0 is rejected
 *
 * This helper transparently adjusts params so every call site can keep
 * using the legacy param names internally.
 */
export function normalizeRequestParams(params: Record<string, any>): Record<string, any> {
  const model: string = params.model ?? "";
  if (!isModernGptModel(model)) return params;

  const normalized = { ...params };

  // max_tokens → max_completion_tokens
  if (normalized.max_tokens != null && normalized.max_completion_tokens == null) {
    normalized.max_completion_tokens = normalized.max_tokens;
    delete normalized.max_tokens;
  }

  // temperature: 0 is unsupported — remove so the API uses its default (1)
  if (normalized.temperature != null && normalized.temperature !== 1) {
    delete normalized.temperature;
  }

  return normalized;
}

/**
 * Resolve the token-limit entry for a model.
 * Handles deployment names like "gpt-5.3-chat" by fuzzy-matching against known keys.
 */
function resolveModelLimits(model: string): { input: number; output: number } {
  if (MODEL_TOKEN_LIMITS[model]) return MODEL_TOKEN_LIMITS[model];
  for (const key of Object.keys(MODEL_TOKEN_LIMITS)) {
    if (key !== "default" && (model.includes(key) || key.includes(model))) {
      return MODEL_TOKEN_LIMITS[key];
    }
  }
  return MODEL_TOKEN_LIMITS["default"];
}

/**
 * Get the safe input token budget for a model, reserving space for output.
 */
export function getInputTokenBudget(model: string): number {
  const limits = resolveModelLimits(model);
  return Math.floor((limits.input - limits.output) * 0.85);
}

/**
 * Clamp a requested max_tokens value to the model's actual output limit.
 * Applies a 5% safety margin so the request never hits the hard ceiling.
 */
export function safeMaxTokens(requested: number, model: string): number {
  const limits = resolveModelLimits(model);
  const safeLimit = Math.floor(limits.output * 0.95);
  return Math.min(requested, safeLimit);
}

/**
 * Token budget reserved for the change summary injected between dependency layers.
 * This is deducted from the file content budget so the total stays within limits.
 */
export const CHANGE_SUMMARY_TOKEN_BUDGET = 2000;

/* ------------------------------------------------------------------ */
/*  Smart File Chunking                                                 */
/* ------------------------------------------------------------------ */

interface FileChunk {
  relativePath: string;
  content: string;
  originalSize: number;
  wasChunked: boolean;
  chunkInfo?: string;
}

/**
 * Intelligently chunk a single file's content to fit within a character budget.
 * 
 * Strategy:
 * 1. If file fits within budget, return as-is
 * 2. Otherwise, extract key sections:
 *    - File header (imports, package declarations) — first N lines
 *    - Class/interface/function signatures
 *    - Configuration sections (for manifest files)
 *    - File footer (exports) — last N lines
 *    - A summary note of what was omitted
 */
export function chunkFileContent(content: string, maxChars: number, filePath: string): string {
  if (!content) return "";
  if (content.length <= maxChars) return content;

  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const lines = content.split('\n');
  
  // For manifest/config files, use a different strategy
  if (['json', 'xml', 'csproj', 'yaml', 'yml', 'toml', 'cfg', 'config', 'properties'].includes(ext)) {
    return chunkConfigFile(lines, maxChars, content.length);
  }
  
  // For code files, extract structured sections
  return chunkCodeFile(lines, maxChars, content.length, ext);
}

/**
 * Chunk config/manifest files — keep the start (structure) and summarize.
 */
function chunkConfigFile(lines: string[], maxChars: number, originalLength: number): string {
  const headerLines = Math.min(lines.length, Math.floor(maxChars / 50));
  const header = lines.slice(0, headerLines).join('\n');
  
  if (header.length <= maxChars - 100) {
    const remaining = maxChars - header.length - 100;
    const tailLines = [];
    let tailLen = 0;
    for (let i = lines.length - 1; i >= headerLines; i--) {
      if (tailLen + lines[i].length + 1 > remaining) break;
      tailLines.unshift(lines[i]);
      tailLen += lines[i].length + 1;
    }
    const omitted = lines.length - headerLines - tailLines.length;
    if (omitted > 0) {
      return `${header}\n\n/* ... ${omitted} lines omitted (${originalLength} chars total) ... */\n\n${tailLines.join('\n')}`;
    }
    return `${header}\n${tailLines.join('\n')}`;
  }
  
  return `${header.slice(0, maxChars - 80)}\n\n/* ... truncated (${originalLength} chars total, ${lines.length} lines) ... */`;
}

/**
 * Chunk code files — extract imports, signatures, key structures, exports.
 */
function chunkCodeFile(lines: string[], maxChars: number, originalLength: number, ext: string): string {
  const sections: string[] = [];
  let usedChars = 0;
  const budget = maxChars - 200; // Reserve for summary markers

  // Section 1: Imports/package declarations (first meaningful lines)
  const importSection = extractImportSection(lines, ext);
  if (importSection.length > 0 && usedChars + importSection.length <= budget) {
    sections.push(`// === IMPORTS & DECLARATIONS ===\n${importSection}`);
    usedChars += importSection.length + 35;
  }

  // Section 2: Class/function signatures and key structures
  const signatures = extractSignatures(lines, ext);
  if (signatures.length > 0 && usedChars + signatures.length <= budget * 0.6) {
    sections.push(`\n// === KEY SIGNATURES & STRUCTURES ===\n${signatures}`);
    usedChars += signatures.length + 40;
  }

  // Section 3: Fill remaining budget with actual code (prioritize beginning)
  const remainingBudget = budget - usedChars;
  if (remainingBudget > 200) {
    const startLine = findCodeStartLine(lines, ext);
    const codeBody = lines.slice(startLine).join('\n');
    
    if (codeBody.length <= remainingBudget) {
      sections.push(`\n// === CODE BODY ===\n${codeBody}`);
    } else {
      // Take from beginning and end of code body
      const halfBudget = Math.floor(remainingBudget / 2);
      const bodyStart = codeBody.slice(0, halfBudget);
      const bodyEnd = codeBody.slice(-Math.floor(halfBudget * 0.6));
      const omittedChars = codeBody.length - halfBudget - Math.floor(halfBudget * 0.6);
      
      sections.push(`\n// === CODE BODY (beginning) ===\n${bodyStart}`);
      sections.push(`\n// ... ${omittedChars} characters omitted from middle ...`);
      sections.push(`\n// === CODE BODY (end) ===\n${bodyEnd}`);
    }
  }

  // Add file summary
  sections.push(`\n// === FILE SUMMARY: ${originalLength} chars, ${lines.length} lines total ===`);

  return sections.join('\n');
}

/**
 * Extract import/package/using statements from the top of the file.
 */
function extractImportSection(lines: string[], ext: string): string {
  const importPatterns: Record<string, RegExp[]> = {
    'ts':   [/^import\s/, /^export\s.*from/, /^require\(/, /^\/\//, /^\/\*/, /^\s*\*/, /^\s*$/],
    'tsx':  [/^import\s/, /^export\s.*from/, /^require\(/, /^\/\//, /^\/\*/, /^\s*\*/, /^\s*$/],
    'js':   [/^import\s/, /^export\s.*from/, /^require\(/, /^const.*=.*require/, /^\/\//, /^\/\*/, /^\s*\*/, /^\s*$/],
    'jsx':  [/^import\s/, /^export\s.*from/, /^require\(/, /^\/\//, /^\/\*/, /^\s*\*/, /^\s*$/],
    'java': [/^package\s/, /^import\s/, /^\/\//, /^\/\*/, /^\s*\*/, /^\s*$/],
    'cs':   [/^using\s/, /^namespace\s/, /^\/\//, /^\/\*/, /^\s*\*/, /^\s*$/, /^#/],
    'py':   [/^import\s/, /^from\s.*import/, /^#/, /^\s*$/, /^"""/],
    'go':   [/^package\s/, /^import\s/, /^\/\//, /^\s*$/, /^\t"/],
  };
  
  const patterns = importPatterns[ext] || [/^import\s/, /^using\s/, /^package\s/, /^from\s/, /^\/\//, /^\/\*/, /^\s*\*/, /^\s*$/];
  const importLines: string[] = [];
  let consecutiveMisses = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (patterns.some(p => p.test(trimmed))) {
      importLines.push(line);
      consecutiveMisses = 0;
    } else if (trimmed === '') {
      importLines.push(line);
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
      if (consecutiveMisses > 2) break;
    }
  }
  
  return importLines.join('\n');
}

/**
 * Extract class declarations, function signatures, interface definitions.
 */
function extractSignatures(lines: string[], ext: string): string {
  const sigPatterns: RegExp[] = [
    // TypeScript/JavaScript
    /^\s*(export\s+)?(default\s+)?(async\s+)?function\s+\w+/,
    /^\s*(export\s+)?(default\s+)?class\s+\w+/,
    /^\s*(export\s+)?interface\s+\w+/,
    /^\s*(export\s+)?type\s+\w+/,
    /^\s*(export\s+)?enum\s+\w+/,
    /^\s*(export\s+)?const\s+\w+\s*[=:]/,
    // Java
    /^\s*(public|private|protected)\s+(static\s+)?(class|interface|enum|abstract)\s/,
    /^\s*(public|private|protected)\s+(static\s+)?(void|int|String|boolean|long|double|float)\s+\w+\s*\(/,
    /^\s*@\w+/,
    // C#
    /^\s*(public|private|protected|internal)\s+(static\s+)?(class|interface|struct|enum|record)\s/,
    /^\s*(public|private|protected|internal)\s+(static\s+)?(async\s+)?(Task|void|int|string|bool)\s+\w+\s*\(/,
    /^\s*\[.*\]/,
    // Python
    /^\s*class\s+\w+/,
    /^\s*def\s+\w+/,
    /^\s*async\s+def\s+\w+/,
    /^\s*@\w+/,
  ];

  const signatures: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (sigPatterns.some(p => p.test(line))) {
      // Include the signature line and the next line (for opening brace or params)
      signatures.push(line);
      if (i + 1 < lines.length && (lines[i + 1].trim().startsWith('{') || lines[i + 1].trim().startsWith('('))) {
        signatures.push(lines[i + 1]);
      }
    }
  }
  
  return signatures.join('\n');
}

/**
 * Find where actual code starts (after imports/declarations).
 */
function findCodeStartLine(lines: string[], ext: string): number {
  let lastImportLine = 0;
  const importPatterns = [/^import\s/, /^using\s/, /^package\s/, /^from\s.*import/, /^require\(/];
  
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    if (importPatterns.some(p => p.test(lines[i].trim()))) {
      lastImportLine = i;
    }
  }
  
  return Math.min(lastImportLine + 1, lines.length);
}

/* ------------------------------------------------------------------ */
/*  Budget-Based File Selection                                         */
/* ------------------------------------------------------------------ */

interface BudgetOptions {
  /** Total character budget for all files combined */
  totalCharBudget: number;
  /** Maximum characters per individual file */
  maxCharsPerFile: number;
  /** Maximum number of files to include */
  maxFiles: number;
  /** File extensions to prioritize */
  priorityExtensions?: string[];
}

interface PreparedFile {
  relativePath: string;
  content: string;
  originalSize: number;
  wasChunked: boolean;
}

/**
 * Select and prepare files within a token budget.
 * 
 * Strategy:
 * 1. Sort files by relevance (manifest files first, then by size)
 * 2. Include files up to budget, chunking large ones
 * 3. Return prepared files with metadata
 */
export function prepareFilesWithinBudget(
  files: ExtractedFile[],
  options: BudgetOptions
): PreparedFile[] {
  const { totalCharBudget, maxCharsPerFile, maxFiles, priorityExtensions } = options;
  
  if (!files || files.length === 0) return [];
  
  // Priority sort: manifests first, then priority extensions, then by size (smaller first)
  const manifestPatterns = [
    'package.json', 'pom.xml', '.csproj', 'requirements.txt', 'Cargo.toml', 'go.mod', 'build.gradle',
    'libman.json', 'bower.json', 'global.json', 'nuget.config', 'packages.config', '.sln', 'Directory.Build.props',
    'tsconfig.json', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg',
    'settings.gradle', 'gradle.properties', 'Gemfile', 'composer.json',
  ];
  
  const sorted = [...files].sort((a, b) => {
    const aIsManifest = manifestPatterns.some(p => a.relativePath?.includes(p));
    const bIsManifest = manifestPatterns.some(p => b.relativePath?.includes(p));
    if (aIsManifest && !bIsManifest) return -1;
    if (!aIsManifest && bIsManifest) return 1;
    
    if (priorityExtensions) {
      const aExt = a.relativePath?.split('.').pop()?.toLowerCase() || '';
      const bExt = b.relativePath?.split('.').pop()?.toLowerCase() || '';
      const aIsPriority = priorityExtensions.includes(aExt);
      const bIsPriority = priorityExtensions.includes(bExt);
      if (aIsPriority && !bIsPriority) return -1;
      if (!aIsPriority && bIsPriority) return 1;
    }
    
    // Smaller files first (more files = more context breadth)
    return (a.size || 0) - (b.size || 0);
  });
  
  const result: PreparedFile[] = [];
  let usedChars = 0;
  
  for (const file of sorted) {
    if (result.length >= maxFiles) break;
    if (usedChars >= totalCharBudget) break;
    if (!file.content) continue;
    
    const remainingBudget = totalCharBudget - usedChars;
    const fileBudget = Math.min(maxCharsPerFile, remainingBudget);
    
    if (fileBudget < 200) break; // Not enough room for meaningful content
    
    const chunked = chunkFileContent(file.content, fileBudget, file.relativePath || '');
    
    result.push({
      relativePath: file.relativePath || 'unknown',
      content: chunked,
      originalSize: file.content.length,
      wasChunked: chunked.length < file.content.length,
    });
    
    usedChars += chunked.length;
  }
  
  return result;
}

/* ------------------------------------------------------------------ */
/*  Prompt Size Estimation & Safety                                     */
/* ------------------------------------------------------------------ */

/**
 * Estimate total prompt size and warn if it's too large.
 */
export function estimatePromptSize(systemPrompt: string, userPrompt: string): {
  systemTokens: number;
  userTokens: number;
  totalTokens: number;
  isOverBudget: (model: string) => boolean;
  recommendation: string;
} {
  const systemTokens = estimateTokens(systemPrompt);
  const userTokens = estimateTokens(userPrompt);
  const totalTokens = systemTokens + userTokens;
  
  return {
    systemTokens,
    userTokens,
    totalTokens,
    isOverBudget: (model: string) => totalTokens > getInputTokenBudget(model),
    recommendation: totalTokens > 100000 
      ? "CRITICAL: Prompt exceeds safe limits. Reduce code file content significantly."
      : totalTokens > 50000 
        ? "WARNING: Prompt is large. Consider reducing file content."
        : "OK: Prompt is within safe limits."
  };
}

/**
 * Calculate the character budget available for code files in a prompt,
 * given the system prompt, static prompt text, and model.
 */
export function calculateCodeBudget(
  systemPrompt: string,
  staticPromptText: string,
  model: string = DEFAULT_MODEL_ID
): number {
  const tokenBudget = getInputTokenBudget(model);
  const systemTokens = estimateTokens(systemPrompt);
  const staticTokens = estimateTokens(staticPromptText);
  const availableTokens = tokenBudget - systemTokens - staticTokens;
  
  // Convert back to chars (conservative: 3.5 chars per token)
  const charBudget = Math.max(0, Math.floor(availableTokens * 3.5));
  
  
  return charBudget;
}

/**
 * Format prepared files into prompt-ready text blocks.
 * Sanitizes content to prevent Azure OpenAI content filter rejections.
 */
export function formatFilesForPrompt(files: PreparedFile[], header: string = "Code Files"): string {
  if (files.length === 0) return `## ${header}\nNo files available.`;

  const blocks = files.map(f => {
    const chunkNote = f.wasChunked
      ? ` (chunked from ${f.originalSize} chars)`
      : '';
    const safeContent = sanitizeForContentFilter(f.content, "standard");
    return `### ${f.relativePath}${chunkNote}\n\`\`\`\n${safeContent}\n\`\`\``;
  });

  return `## ${header} (${files.length} files)\n\n${blocks.join('\n\n')}`;
}
