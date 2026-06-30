/**
 * Mermaid to SVG Conversion Service
 * Converts Mermaid syntax to SVG using Puppeteer (full browser rendering)
 * 
 * Flow: Mermaid Syntax → SVG → Data URI → HTML → Confluence
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';
import { createRequire } from 'module';
import { processSvgForConfluence } from './svg-utils';

let browserInstance: puppeteer.Browser | null = null;

/**
 * Detects errors that mean the cached browser is dead and must be discarded
 * (anything else can be a transient per-page issue we don't want to throw away
 * the whole browser for).
 */
function isFatalBrowserError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('Protocol error') ||
    msg.includes('Connection closed') ||
    msg.includes('Target closed') ||
    msg.includes('browser has disconnected') ||
    msg.includes('Browser closed') ||
    msg.includes('Session closed') ||
    msg.includes('Most likely the page has been closed') ||
    msg.includes('Navigation failed')
  );
}

/**
 * Get or create a Puppeteer browser instance.
 * If the cached instance has died (e.g. previous render crashed it) we drop it
 * and launch a fresh one — previously a single crash would poison every
 * subsequent diagram for the lifetime of the process.
 */
async function getBrowser(): Promise<puppeteer.Browser> {
  if (browserInstance) {
    try {
      // `isConnected()` is the cheap, synchronous health check Puppeteer exposes.
      if ((browserInstance as any).connected === false || (typeof browserInstance.isConnected === 'function' && !browserInstance.isConnected())) {
        console.warn('[MermaidToSvg] Cached browser is disconnected — recreating');
        browserInstance = null;
      }
    } catch {
      browserInstance = null;
    }
  }

  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    // Auto-clear cache when the browser dies on us so the next call relaunches.
    browserInstance.on('disconnected', () => {
      console.warn('[MermaidToSvg] Puppeteer browser disconnected — will relaunch on next call');
      browserInstance = null;
    });
  }
  return browserInstance;
}

/**
 * Close the browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (err) {
      console.warn('[MermaidToSvg] Error closing browser:', err);
    }
    browserInstance = null;
  }
}

// Resolve the bundled mermaid.min.js path once at module load. Falls back to
// the CDN at runtime if (a) the bundled file is missing or (b) Puppeteer fails
// to inject it. Bundling locally lets the converter work in air-gapped /
// corporate / Azure App Service environments that can't reach jsdelivr.
const mermaidLocalPathPromise: Promise<string | null> = (async () => {
  // 1) Use createRequire so this works regardless of CJS/ESM build target.
  try {
    const req = createRequire(import.meta.url);
    const resolved = req.resolve('mermaid/dist/mermaid.min.js');
    await fs.access(resolved);
    console.log(`[MermaidToSvg] Using bundled mermaid.min.js at ${resolved}`);
    return resolved;
  } catch {
    // fall through
  }
  // 2) Fall back to direct node_modules lookup from cwd (works for esbuild bundle).
  const cwdPath = path.join(process.cwd(), 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
  try {
    await fs.access(cwdPath);
    console.log(`[MermaidToSvg] Using bundled mermaid.min.js at ${cwdPath}`);
    return cwdPath;
  } catch {
    console.warn('[MermaidToSvg] Bundled mermaid.min.js not found — falling back to CDN at runtime');
    return null;
  }
})();

// Cleanup browser on process exit
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    await closeBrowser();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await closeBrowser();
    process.exit(0);
  });
  
  process.on('exit', async () => {
    await closeBrowser();
  });
}

/**
 * Converts Mermaid syntax to SVG using Puppeteer (full browser rendering).
 *
 * Resilience features:
 *   - Loads mermaid.min.js from the bundled npm package first, falling back to
 *     jsdelivr only if the local file isn't readable. Works in air-gapped /
 *     corp-network / Azure App Service environments.
 *   - 30s selector timeout (was 10s) to accommodate large sequence/class
 *     diagrams that the prompts ask the LLM to produce.
 *   - On a fatal browser/protocol error the cached browser is discarded and
 *     the render is retried once with a fresh browser. Previously one crash
 *     poisoned every subsequent diagram.
 *
 * @param mermaidSyntax - The Mermaid diagram syntax
 * @returns SVG string
 */
export async function mermaidToSvg(mermaidSyntax: string): Promise<string> {
  return await mermaidToSvgInternal(mermaidSyntax, /*retry*/ true);
}

async function mermaidToSvgInternal(mermaidSyntax: string, retry: boolean): Promise<string> {
  const SELECTOR_TIMEOUT_MS = Number(process.env.MERMAID_RENDER_TIMEOUT_MS) || 30_000;
  let browser: puppeteer.Browser;
  try {
    browser = await getBrowser();
  } catch (launchErr) {
    throw new Error(`Failed to launch Puppeteer browser: ${launchErr instanceof Error ? launchErr.message : String(launchErr)}`);
  }

  let page: puppeteer.Page | null = null;
  try {
    page = await browser.newPage();

    // Minimal shell — we inject the mermaid library and diagram source via
    // Puppeteer APIs so we don't depend on networkidle from a CDN fetch.
    await page.setContent(
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
      `<body><div class="mermaid"></div></body></html>`,
      { waitUntil: 'load', timeout: SELECTOR_TIMEOUT_MS }
    );

    // 1) Inject the mermaid library — prefer the bundled file.
    const localPath = await mermaidLocalPathPromise;
    let injected = false;
    if (localPath) {
      try {
        await page.addScriptTag({ path: localPath });
        injected = true;
      } catch (err) {
        console.warn('[MermaidToSvg] Local mermaid.min.js injection failed, falling back to CDN:', err);
      }
    }
    if (!injected) {
      await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js' });
    }

    // 2) Render the diagram inside the page and surface any Mermaid parse
    //    errors as a JS exception we can catch (instead of waiting forever
    //    for a selector that will never appear).
    const svg = await page.evaluate(async (source: string) => {
      const m = (window as any).mermaid;
      if (!m || typeof m.initialize !== 'function') {
        throw new Error('Mermaid library failed to load');
      }
      m.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis', diagramPadding: 20 },
        gantt: { useMaxWidth: false },
        sequence: { useMaxWidth: false, diagramMarginX: 50, diagramMarginY: 10 },
      });
      try {
        const { svg } = await m.render('mermaidDiagram', source);
        return svg;
      } catch (e: any) {
        throw new Error('Mermaid parse error: ' + (e?.message || e?.str || String(e)));
      }
    }, mermaidSyntax);

    if (!svg || typeof svg !== 'string') {
      throw new Error('Failed to render Mermaid diagram - empty SVG');
    }

    return processSvgForConfluence(svg);
  } catch (error) {
    // If the browser crashed mid-render, drop the cached instance and retry
    // once with a fresh one. Anything else (Mermaid parse errors, timeouts on
    // a healthy browser) is the caller's problem to handle (they show the
    // visible "diagram failed" fallback added in confluence-service.ts).
    if (retry && isFatalBrowserError(error)) {
      console.warn('[MermaidToSvg] Fatal browser error — recycling instance and retrying once:', error instanceof Error ? error.message : error);
      browserInstance = null;
      try { if (page) await page.close({ runBeforeUnload: false }); } catch { /* ignore */ }
      return await mermaidToSvgInternal(mermaidSyntax, /*retry*/ false);
    }
    console.error('[MermaidToSvg] Error converting Mermaid to SVG:', error);
    throw new Error(`Failed to convert Mermaid to SVG: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Converts SVG to Data URI (base64 encoded)
 * @param svg - SVG string
 * @returns Data URI string
 */
export function svgToDataUri(svg: string): string {
  // Ensure SVG is properly formatted
  const processedSvg = processSvgForConfluence(svg);
  
  // Encode SVG for data URI (base64)
  const svgBase64 = Buffer.from(processedSvg, 'utf-8').toString('base64');
  return `data:image/svg+xml;charset=utf-8;base64,${svgBase64}`;
}

/**
 * Converts SVG to PNG Data URI by rasterizing the rendered SVG in Puppeteer.
 * This is useful for Word/html-to-docx paths that do not reliably render
 * inline SVG data URIs.
 */
export async function svgToPngDataUri(svg: string): Promise<string> {
  const processedSvg = processSvgForConfluence(svg);
  const browser = await getBrowser();
  let page: puppeteer.Page | null = null;

  try {
    page = await browser.newPage();

    await page.setContent(
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#fff;">${processedSvg}</body></html>`,
      { waitUntil: 'load', timeout: 30_000 }
    );

    const svgHandle = await page.$('svg');
    if (!svgHandle) {
      throw new Error('SVG element not found for PNG conversion');
    }

    const pngBuffer = await svgHandle.screenshot({ type: 'png' });
    return `data:image/png;base64,${pngBuffer.toString('base64')}`;
  } catch (error) {
    throw new Error(`Failed to convert SVG to PNG: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore page close errors during cleanup
      }
    }
  }
}

/**
 * Converts SVG to Confluence HTML format
 * Embeds SVG as data URI in img tag
 * @param svg - SVG string
 * @param title - Diagram title/alt text
 * @returns HTML string for Confluence
 */
export function svgToConfluenceHtml(svg: string, title: string = 'Diagram'): string {
  try {
    const svgDataUri = svgToDataUri(svg);
    
    // Embed as image using SVG data URI - Confluence should render this
    return `
      <p style="text-align: center; padding: 20px;">
        <img src="${svgDataUri}" alt="${title}" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto;" />
      </p>
    `;
  } catch (error) {
    console.warn('[MermaidToSvg] Failed to create SVG data URI, using direct embedding:', error);
    // Fallback to direct SVG embedding
    const processedSvg = processSvgForConfluence(svg);
    return `
      <div style="text-align: center; padding: 20px; overflow-x: auto;">
        <div style="max-width: 100%; margin: 0 auto;">
          ${processedSvg}
        </div>
      </div>
    `;
  }
}

/**
 * Converts Mermaid syntax directly to Confluence HTML
 * Complete flow: Mermaid → SVG → Data URI → HTML
 * @param mermaidSyntax - The Mermaid diagram syntax
 * @param title - Diagram title
 * @returns HTML string ready for Confluence
 */
export async function mermaidToConfluenceHtml(
  mermaidSyntax: string,
  title: string = 'Diagram'
): Promise<string> {
  // Step 1: Mermaid → SVG
  const svg = await mermaidToSvg(mermaidSyntax);
  
  // Step 2: SVG → Data URI → HTML
  const html = svgToConfluenceHtml(svg, title);
  
  return html;
}
