import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { processSvgForConfluence, svgToConfluenceHtml } from './svg-utils';

const execFileAsync = promisify(execFile);

/**
 * Finds the mmdc executable path.
 * Prefers npx (works with local or global installs), then checks node_modules/.bin, then PATH.
 */
async function findMmdcPath(): Promise<{ command: string; args: string[] }> {
  const isWindows = process.platform === 'win32';
  
  // Prefer npx (works if package is installed locally or globally)
  // npx will find mmdc in node_modules/.bin or use a globally installed version
  try {
    const npxCommand = isWindows ? 'npx.cmd' : 'npx';
    // Test if npx is available (quick check)
    await execFileAsync(npxCommand, ['--version'], { timeout: 5000 });
    console.log(`[MermaidUtils] Using npx to run mmdc`);
    return { command: npxCommand, args: ['--yes', 'mmdc'] }; // --yes to avoid prompts
  } catch (error: any) {
    // npx not available, continue to direct path
    console.log(`[MermaidUtils] npx not available: ${error.message}`);
  }

  // Try node_modules/.bin directly (works for local installs)
  const baseName = isWindows ? 'mmdc.cmd' : 'mmdc';
  const nodeModulesBin = path.join(process.cwd(), 'node_modules', '.bin', baseName);
  
  try {
    await fs.access(nodeModulesBin);
    console.log(`[MermaidUtils] Found mmdc at: ${nodeModulesBin}`);
    return { command: nodeModulesBin, args: [] };
  } catch {
    // File doesn't exist, continue to PATH
    console.log(`[MermaidUtils] mmdc not found at: ${nodeModulesBin}`);
  }

  // Last resort: assume mmdc is in PATH
  const fallbackCommand = isWindows ? 'mmdc.cmd' : 'mmdc';
  console.log(`[MermaidUtils] Falling back to PATH: ${fallbackCommand}`);
  return { command: fallbackCommand, args: [] };
}

/**
 * Renders Mermaid diagram code to SVG using Mermaid CLI (mmdc).
 * This is the ONLY rendering mechanism - no jsdom, no browser polyfills.
 * 
 * @param mermaidCode - The Mermaid diagram source code
 * @returns SVG string or null if rendering fails
 */
async function renderMermaidToSvg(mermaidCode: string): Promise<string | null> {
  const id = crypto.randomUUID();
  const tempDir = os.tmpdir();
  const inputFile = path.join(tempDir, `${id}.mmd`);
  const outputFile = path.join(tempDir, `${id}.svg`);

  try {
    // Write Mermaid code to temporary file
    await fs.writeFile(inputFile, mermaidCode, 'utf8');

    // Find mmdc executable
    const { command, args } = await findMmdcPath();

    // Execute mmdc CLI
    await execFileAsync(command, [
      ...args,
      '-i', inputFile,
      '-o', outputFile,
      '-b', 'transparent', // Transparent background
      '-w', '1200', // Width
      '-H', '800',  // Height
    ], {
      // Set timeout to 30 seconds (some complex diagrams may take time)
      timeout: 30000,
    });

    // Read the generated SVG
    let svg = await fs.readFile(outputFile, 'utf8');

    // Clean up temporary files
    await fs.unlink(inputFile).catch(() => {});
    await fs.unlink(outputFile).catch(() => {});

    if (typeof svg === 'string' && svg.trim().length > 0) {
      // Process SVG for Confluence (add xmlns, viewBox, proper dimensions)
      svg = processSvgForConfluence(svg.trim());
      return svg;
    }

    return null;
  } catch (error: any) {
    // Clean up temporary files on error
    await fs.unlink(inputFile).catch(() => {});
    await fs.unlink(outputFile).catch(() => {});

    const errorMsg = error.message || String(error);
    if (errorMsg.includes('ENOENT') || errorMsg.includes('spawn')) {
      console.error(`[MermaidUtils] mmdc executable not found. Please install: npm install @mermaid-js/mermaid-cli`);
      console.error(`[MermaidUtils] Error details: ${errorMsg}`);
    } else {
      console.error('[MermaidUtils] mmdc rendering failed:', errorMsg);
    }
    return null;
  }
}

/**
 * Attempts to repair broken Mermaid syntax using AI.
 * First tries to fix the syntax, then regenerates from context if fixing fails.
 * 
 * @param mermaidCode - The broken Mermaid code
 * @param context - Optional context (e.g., page title, page content) to help AI understand intent
 * @returns Fixed or regenerated Mermaid code or null if repair fails
 */
async function repairMermaidWithAI(mermaidCode: string, context: string = ''): Promise<string | null> {
  try {
    const { fixMermaidSyntax, regenerateMermaidDiagram } = await import('../../ai-service');
    
    // Step 1: Try to fix the existing syntax
    console.log('[MermaidUtils] Attempting to fix Mermaid syntax...');
    try {
      const fixedCode = await fixMermaidSyntax(mermaidCode, context);
      
      if (fixedCode && fixedCode.trim().length > 0) {
        console.log('[MermaidUtils] ✅ AI successfully fixed Mermaid syntax');
        return fixedCode.trim();
      }
    } catch (fixError: any) {
      console.log('[MermaidUtils] Fix attempt failed, trying regeneration...', fixError.message);
    }
    
    // Step 2: If fixing failed, try to regenerate from context
    console.log('[MermaidUtils] Attempting to regenerate Mermaid diagram from context...');
    try {
      // Fallback: try regenerateMermaidDiagram (uses original code as reference)
      const fallbackCode = await regenerateMermaidDiagram(mermaidCode, context);
      if (fallbackCode && fallbackCode.trim().length > 0) {
        console.log('[MermaidUtils] ✅ AI successfully regenerated Mermaid diagram (fallback)');
        return fallbackCode.trim();
      }
    } catch (regenerateError: any) {
      console.error('[MermaidUtils] Regeneration failed:', regenerateError.message);
    }
    
    return null;
  } catch (error: any) {
    console.error('[MermaidUtils] AI repair failed:', error.message);
    return null;
  }
}

/**
 * Creates a graceful fallback HTML block for unrenderable diagrams.
 * Preserves the original Mermaid source so it can be manually fixed later.
 * 
 * @param originalCode - The original Mermaid code that couldn't be rendered
 * @returns HTML fallback block
 */
function createMermaidErrorFallback(originalCode: string): string {
  return `
<div class="mermaid-error">
  ⚠️ Diagram could not be rendered. Original source preserved below.
</div>
<pre><code class="language-mermaid">
${originalCode}
</code></pre>
`;
}

/**
 * Detects ```mermaid code fences in markdown-like content and REPLACES them
 * with inline SVG using Mermaid CLI (mmdc).
 * 
 * Flow:
 * 1. Attempt to render using mmdc
 * 2. If rendering fails, attempt AI repair once, then retry
 * 3. If still fails, use graceful fallback (preserves original code)
 * 
 * This is called BEFORE markdown-to-HTML conversion so the SVG is preserved.
 * 
 * @param content - Markdown/HTML content that may contain Mermaid blocks
 * @param context - Optional context (e.g., page title) for AI repair
 * @returns Content with Mermaid blocks replaced by SVG or fallback HTML
 */
export async function replaceMermaidWithSvg(
  content: string,
  context: string = ''
): Promise<string> {
  if (!content || (!content.includes('```mermaid') && !content.toLowerCase().includes('::: mermaid'))) {
    return content;
  }

  // Normalize Azure DevOps-style mermaid blocks (::: mermaid) to standard ```mermaid fences
  // Handle various formats:
  // - ::: mermaid\n<code>\n:::
  // - ::: mermaid <code> :::
  // - :::mermaid\n<code>\n:::
  let workingContent = content
    // Multi-line blocks: ::: mermaid\n<code>\n::: (most common format)
    .replace(/:::\s*mermaid\s*\n([\s\S]*?)\n:::/gi, (_, code) => {
      return '```mermaid\n' + String(code).trim() + '\n```';
    })
    // Single-line blocks: ::: mermaid <code> :::  
    .replace(/:::\s*mermaid\s+([\s\S]*?):::/gi, (_, code) => {
      return '```mermaid\n' + String(code).trim() + '\n```';
    })
    // Handle blocks without newline after ::: mermaid (::: mermaid<code>:::)
    .replace(/:::\s*mermaid([\s\S]*?):::/gi, (_, code) => {
      const trimmedCode = String(code).trim();
      // Only replace if it looks like Mermaid code (contains graph, flowchart, sequence, etc.)
      if (trimmedCode && (trimmedCode.includes('graph') || trimmedCode.includes('flowchart') || 
          trimmedCode.includes('sequence') || trimmedCode.includes('class') || 
          trimmedCode.includes('state') || trimmedCode.includes('er') || trimmedCode.includes('gantt'))) {
        return '```mermaid\n' + trimmedCode + '\n```';
      }
      return `::: mermaid${code}:::`;
    });

  const mermaidBlockRegex = /```mermaid\s*([\s\S]*?)```/g;
  const blocks: Array<{ fullMatch: string; code: string; index: number }> = [];

  // Collect all mermaid blocks
  let match: RegExpExecArray | null;
  while ((match = mermaidBlockRegex.exec(workingContent)) !== null) {
    const fullMatch = match[0];
    const code = match[1]?.trim() ?? '';
    if (code) {
      blocks.push({ fullMatch, code, index: match.index });
    }
  }

  if (blocks.length === 0) {
    return workingContent;
  }

  console.log(`[MermaidUtils] Found ${blocks.length} Mermaid diagram(s) to convert to SVG using mmdc`);

  // Replace each block with SVG (process in reverse to preserve indices)
  let result = workingContent;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    let mermaidCode = block.code;
    let svg: string | null = null;
    let repairAttempted = false;

    console.log(`[MermaidUtils] Rendering Mermaid diagram ${i + 1}/${blocks.length}...`);

    // Extract context around this diagram for better AI regeneration
    let diagramContext = context;
    if (workingContent) {
      const startContext = Math.max(0, block.index - 500);
      const endContext = Math.min(workingContent.length, block.index + block.fullMatch.length + 500);
      const surroundingText = workingContent.substring(startContext, endContext);
      // Remove the mermaid block itself from context
      const contextWithoutBlock = surroundingText.replace(/```mermaid[\s\S]*?```/g, '');
      if (contextWithoutBlock.trim().length > 50) {
        diagramContext = `${context}\n\n${contextWithoutBlock.trim().substring(0, 1000)}`;
      }
    }

    // Step 1: Attempt initial render
    svg = await renderMermaidToSvg(mermaidCode);

    // Step 2: If rendering failed, attempt AI repair (with regeneration fallback), then retry
    if (!svg && !repairAttempted) {
      console.log(`[MermaidUtils] Initial render failed for diagram ${i + 1}, attempting AI repair/regeneration...`);
      const repairedCode = await repairMermaidWithAI(mermaidCode, diagramContext);
      
      if (repairedCode) {
        repairAttempted = true;
        mermaidCode = repairedCode;
        console.log(`[MermaidUtils] Retrying render with AI-repaired/regenerated code for diagram ${i + 1}...`);
        svg = await renderMermaidToSvg(mermaidCode);
      }
    }

    // Step 3: Replace with SVG or fallback
    if (svg) {
      // Successfully rendered - convert to Confluence HTML format (data URI + img tag)
      // This matches the reference implementation that successfully renders in Confluence
      const confluenceHtml = svgToConfluenceHtml(svg, `Diagram ${i + 1}`);
      result = result.substring(0, block.index) + confluenceHtml + result.substring(block.index + block.fullMatch.length);
      console.log(`[MermaidUtils] ✅ Successfully converted Mermaid diagram ${i + 1} to SVG and HTML (${svg.length} chars SVG)`);
    } else {
      // Failed after repair attempt - use graceful fallback
      const fallback = createMermaidErrorFallback(block.code);
      result = result.substring(0, block.index) + fallback + result.substring(block.index + block.fullMatch.length);
      console.log(`[MermaidUtils] ⚠️ Diagram ${i + 1} could not be rendered after AI repair, using fallback`);
    }
  }

  return result;
}
