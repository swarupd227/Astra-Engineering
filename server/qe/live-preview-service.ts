import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { getBrowserExecutablePath } from './playwright-setup';

interface LivePreviewSession {
  id: string;
  url: string;
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  isRunning: boolean;
  isCapturing: boolean;
  intervalId: NodeJS.Timeout | null;
  timeoutId: NodeJS.Timeout | null;
  lastScreenshot: string | null;
  onScreenshot: (base64Data: string) => void;
  createdAt: number;
}

const activeSessions: Map<string, LivePreviewSession> = new Map();
const MAX_SESSION_DURATION = 5 * 60 * 1000;
const MAX_CONCURRENT_SESSIONS = 10;

function isPublicUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    
    const privatePatterns = [
      /^localhost$/,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^0\./,
      /\.local$/,
      /^169\.254\./,
      /^::1$/,
      /^fc00:/,
      /^fe80:/,
      /^metadata\.google\.internal$/,
      /^instance-data$/,
    ];
    
    for (const pattern of privatePatterns) {
      if (pattern.test(hostname)) {
        return false;
      }
    }
    
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

export async function startLivePreview(
  sessionId: string,
  url: string,
  onScreenshot: (base64Data: string) => void,
  refreshInterval: number = 2000
): Promise<{ success: boolean; error?: string }> {
  try {
    if (activeSessions.size >= MAX_CONCURRENT_SESSIONS) {
      return { success: false, error: 'Maximum concurrent sessions reached. Please try again later.' };
    }

    await stopLivePreview(sessionId);

    console.log(`[LivePreview] Starting live preview for session ${sessionId}: ${url}`);

    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    if (!isPublicUrl(normalizedUrl)) {
      return { success: false, error: 'Cannot preview private or internal URLs for security reasons.' };
    }

    const browser = await chromium.launch({
      headless: true,
      executablePath: getBrowserExecutablePath() ?? undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    try {
      await page.goto(normalizedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    } catch (navError: any) {
      console.error(`[LivePreview] Navigation error: ${navError.message}`);
      await browser.close();
      return { success: false, error: `Failed to load website: ${navError.message}` };
    }

    const session: LivePreviewSession = {
      id: sessionId,
      url: normalizedUrl,
      browser,
      context,
      page,
      isRunning: true,
      isCapturing: false,
      intervalId: null,
      timeoutId: null,
      lastScreenshot: null,
      onScreenshot,
      createdAt: Date.now()
    };

    await captureAndSendScreenshot(session);

    session.intervalId = setInterval(async () => {
      if (session.isRunning && session.page && !session.isCapturing) {
        await captureAndSendScreenshot(session);
      }
    }, refreshInterval);

    session.timeoutId = setTimeout(async () => {
      console.log(`[LivePreview] Session ${sessionId} timed out after ${MAX_SESSION_DURATION / 1000}s`);
      await stopLivePreview(sessionId);
    }, MAX_SESSION_DURATION);

    activeSessions.set(sessionId, session);

    console.log(`[LivePreview] Session ${sessionId} started successfully`);
    return { success: true };

  } catch (error: any) {
    console.error(`[LivePreview] Error starting session: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function captureAndSendScreenshot(session: LivePreviewSession): Promise<void> {
  if (session.isCapturing) return;
  
  try {
    if (!session.page || !session.isRunning) return;
    
    session.isCapturing = true;

    const screenshotBuffer = await session.page.screenshot({
      type: 'jpeg',
      quality: 70,
      fullPage: false
    });

    const base64Data = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
    
    session.onScreenshot(base64Data);
    session.lastScreenshot = base64Data;

  } catch (error: any) {
    if (error.message?.includes('Target page, context or browser has been closed')) {
      session.isRunning = false;
      if (session.intervalId) {
        clearInterval(session.intervalId);
        session.intervalId = null;
      }
    } else {
      console.error(`[LivePreview] Screenshot error: ${error.message}`);
    }
  } finally {
    session.isCapturing = false;
  }
}

export async function stopLivePreview(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  console.log(`[LivePreview] Stopping session ${sessionId}`);

  session.isRunning = false;

  if (session.intervalId) {
    clearInterval(session.intervalId);
    session.intervalId = null;
  }
  
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }

  try {
    if (session.browser) {
      await session.browser.close();
    }
  } catch (error: any) {
    console.error(`[LivePreview] Error closing browser: ${error.message}`);
  }

  activeSessions.delete(sessionId);
  console.log(`[LivePreview] Session ${sessionId} stopped`);
}

export async function scrollPreview(sessionId: string, direction: 'up' | 'down'): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session || !session.page) return;

  try {
    const scrollAmount = direction === 'down' ? 300 : -300;
    await session.page.evaluate((amount) => {
      window.scrollBy(0, amount);
    }, scrollAmount);
    
    await captureAndSendScreenshot(session);
  } catch (error: any) {
    console.error(`[LivePreview] Scroll error: ${error.message}`);
  }
}

export async function refreshPreview(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session || !session.page) return;

  try {
    await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await captureAndSendScreenshot(session);
  } catch (error: any) {
    console.error(`[LivePreview] Refresh error: ${error.message}`);
  }
}

export async function navigatePreviewTo(sessionId: string, url: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session || !session.page || !session.isRunning) return;

  if (!isPublicUrl(url)) return;

  try {
    const sessionOrigin = new URL(session.url).origin;
    const targetOrigin = new URL(url).origin;
    if (sessionOrigin !== targetOrigin) return;
  } catch {
    return;
  }

  try {
    await session.page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 15000 
    });
    await captureAndSendScreenshot(session);
  } catch (error: any) {
    console.error(`[LivePreview] Navigation error for ${url}: ${error.message}`);
  }
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}

process.on('exit', async () => {
  for (const [sessionId] of activeSessions) {
    await stopLivePreview(sessionId);
  }
});
