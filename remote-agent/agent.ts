/**
 * NAT 2.0 — Remote Playwright Execution Agent
 *
 * Standalone Node.js process that:
 *  1. Connects to the NAT 2.0 server (raw WebSocket OR Socket.IO)
 *  2. Registers itself with available browser capabilities
 *  3. Receives execute_job messages and runs Playwright tests locally
 *  4. Streams step results, screenshots, and final summary back to the server
 *  5. Server relays everything to the NAT 2.0 UI via SSE
 *
 * Transport selection (auto, or override with AGENT_TRANSPORT):
 *   - SERVER_URL=ws://host:port/ws/execution-agent  → raw WebSocket (legacy)
 *   - SERVER_URL=http(s)://host[:port]              → Socket.IO namespace /execution-agent
 *   - AGENT_TRANSPORT=socket.io | ws                → explicit override
 *
 * Use Socket.IO when the deployment sits behind a proxy chain that only
 * allow-lists Socket.IO traffic on `/socket.io/*` (e.g. Hilti's
 * Akamai → ALB → Apache → ALB → Istio path).
 *
 * Start:
 *   cd remote-agent && npx tsx agent.ts
 *   SERVER_URL=ws://my-server:5000/ws/execution-agent npx tsx agent.ts
 *   SERVER_URL=https://my-server.example.com npx tsx agent.ts   # Socket.IO
 */

import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import * as os from 'os';

console.log('[Agent] starting…');

function resolveZipRoot(): string {
  const here = __dirname;
  if (fs.existsSync(path.join(here, '..', 'config.json'))) return path.resolve(here, '..');
  if (fs.existsSync(path.join(process.cwd(), 'config.json'))) return process.cwd();
  return process.cwd();
}

const ZIP_ROOT = resolveZipRoot();
console.log(`[Agent] ZIP root: ${ZIP_ROOT}`);

const BUNDLED_BROWSERS = path.join(ZIP_ROOT, 'browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(BUNDLED_BROWSERS)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = BUNDLED_BROWSERS;
  console.log(`[Agent] Using bundled browsers: ${BUNDLED_BROWSERS}`);
}

// Dynamic imports AFTER env setup (playwright reads PLAYWRIGHT_BROWSERS_PATH on require)
const WebSocket = require('ws');
const { chromium } = require('playwright');
type Browser = import('playwright').Browser;
type BrowserContext = import('playwright').BrowserContext;
type Page = import('playwright').Page;

interface AgentConfig { serverUrl?: string; agentId?: string; token?: string; transport?: 'ws' | 'socket.io'; }
function loadConfig(): AgentConfig {
  const p = path.join(ZIP_ROOT, 'config.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

const CONFIG = loadConfig();
const SERVER_URL = CONFIG.serverUrl || process.env.SERVER_URL || 'ws://localhost:4000/ws/execution-agent';
const AGENT_ID   = CONFIG.agentId   || process.env.AGENT_ID   || ('agent-' + randomBytes(4).toString('hex'));
const TOKEN      = CONFIG.token     || process.env.AGENT_TOKEN || '';
const AGENT_LABEL = process.env.AGENT_LABEL || '';
const AGENT_TAGS = (process.env.AGENT_TAGS || '').split(',').map(t => t.trim()).filter(Boolean);
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT = 20;
const PING_INTERVAL_MS = 30000;
const IGNORE_HTTPS_ERRORS = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === 'true';

type TransportKind = 'ws' | 'socket.io';

/**
 * Decide which transport to use given config + URL scheme.
 * Explicit AGENT_TRANSPORT/config.transport wins; otherwise infer from the
 * URL scheme (`http(s)://` → socket.io, anything else → raw ws).
 */
function resolveTransport(): TransportKind {
  const explicit = (CONFIG.transport || process.env.AGENT_TRANSPORT || '').toLowerCase().trim();
  if (explicit === 'socket.io' || explicit === 'socketio') return 'socket.io';
  if (explicit === 'ws' || explicit === 'websocket') return 'ws';
  if (/^https?:\/\//i.test(SERVER_URL)) return 'socket.io';
  return 'ws';
}

const TRANSPORT: TransportKind = resolveTransport();

// ─── Types (mirror server/agent-ws.ts) ───────────────────────────────────────

interface TestStep {
  action: string;
  expected?: string;
  testData?: string;
}

interface TestCase {
  testCaseId: string;
  title: string;
  category: string;
  priority: string;
  steps: TestStep[];
}

interface ExecuteJobMsg {
  type: 'execute_job';
  jobId: string;
  executionRunId: string;
  testCases: TestCase[];
  targetUrl: string;
  browser: string;
  headless: boolean;
  screenshotOnEveryStep: boolean;
  slowMo?: number;
}

// ─── Agent State ──────────────────────────────────────────────────────────────

/**
 * Transport-agnostic handle to the active connection. Both raw-WS and
 * Socket.IO clients populate one of these so the rest of the agent code
 * (runJob, ping timer, message dispatch) doesn't care which transport is in
 * use. `send({type, ...payload})` is the only push primitive.
 */
interface AgentTransportHandle {
  kind: TransportKind;
  send: (msg: { type: string;[k: string]: unknown }) => void;
  close: () => void;
}

let conn: AgentTransportHandle | null = null;
let reconnectAttempts = 0;
let pingTimer: NodeJS.Timeout | null = null;
let currentJobId: string | null = null;
let cancelRequested = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(msg: { type: string;[k: string]: unknown }): void {
  if (conn) conn.send(msg);
}

function log(msg: string): void {
  console.log(`[RemoteAgent][${AGENT_ID}] ${msg}`);
}

// ─── Playwright Execution ─────────────────────────────────────────────────────

async function captureScreenshot(page: Page): Promise<string | undefined> {
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
    return buf.toString('base64');
  } catch {
    return undefined;
  }
}

type ActionCmd = {
  command: string;
  target?: string;
  value?: string;
  locatorType?: string;
};

function parseAction(action: string, testData?: string): ActionCmd {
  const a = action.toLowerCase();

  if (a.includes('navigate to') || a.includes('go to') || a.includes('open url') || a.includes('open the')) {
    const url = action.match(/(https?:\/\/[^\s'"]+)/i)?.[1];
    return { command: 'open', target: url || '' };
  }
  if (a.includes('click') || a.includes('tap on') || a.includes('press button')) {
    const quoted = action.match(/["']([^"']+)["']/)?.[1] || action.replace(/^(click|tap on|press)\s+(on\s+)?(the\s+)?/i, '').trim();
    return { command: 'click', target: quoted };
  }
  if (a.includes('fill') || a.includes('type') || a.includes('enter') || a.includes('input')) {
    const quoted = action.match(/["']([^"']+)["']/)?.[1] || '';
    const val = testData || action.match(/\bwith\s+["']?(.+?)["']?\s*$/i)?.[1] || '';
    return { command: 'fill', target: quoted, value: val };
  }
  if (a.includes('select') || a.includes('choose')) {
    const quoted = action.match(/["']([^"']+)["']/)?.[1] || '';
    return { command: 'select', target: quoted, value: testData || '' };
  }
  if (a.includes('verify') || a.includes('assert') || a.includes('should')) {
    const text = action.match(/["']([^"']+)["']/)?.[1] || action.replace(/^.*?(verify|assert|should)\s*/i, '').trim();
    return { command: 'verify', target: text };
  }
  if (a.includes('wait') || a.includes('pause')) {
    const ms = action.match(/(\d+)/)?.[1] || '2000';
    return { command: 'wait', value: ms };
  }
  return { command: 'observe', target: action };
}

async function executeStep(page: Page, step: TestStep, timeout: number): Promise<void> {
  const cmd = parseAction(step.action, step.testData);

  switch (cmd.command) {
    case 'open':
      if (cmd.target?.startsWith('http')) {
        await page.goto(cmd.target, { waitUntil: 'networkidle', timeout });
      }
      break;

    case 'click': {
      const loc = page.getByText(cmd.target || '', { exact: false });
      if (await loc.count() > 0) {
        await loc.first().click({ timeout });
      } else {
        await page.locator(`text=${cmd.target}`).first().click({ timeout });
      }
      break;
    }

    case 'fill': {
      const target = cmd.target || '';
      let loc = page.getByLabel(target);
      if (await loc.count() === 0) loc = page.getByPlaceholder(target);
      if (await loc.count() === 0) loc = page.getByRole('textbox', { name: target });
      await loc.first().fill(cmd.value || '', { timeout });
      break;
    }

    case 'select': {
      const target = cmd.target || '';
      const loc = page.getByLabel(target).or(page.locator(`select[name*="${target}" i]`));
      await loc.first().selectOption(cmd.value || '', { timeout });
      break;
    }

    case 'verify': {
      const visible = await page.getByText(cmd.target || '', { exact: false })
        .isVisible({ timeout: 5000 }).catch(() => false);
      if (!visible) throw new Error(`Expected "${cmd.target}" to be visible`);
      break;
    }

    case 'wait':
      await page.waitForTimeout(Math.min(parseInt(cmd.value || '2000'), 10000));
      break;

    case 'observe':
    default:
      await page.waitForTimeout(300);
      break;
  }

  await page.waitForTimeout(500);
}

async function runJob(msg: ExecuteJobMsg): Promise<void> {
  const { jobId, testCases, targetUrl, headless, screenshotOnEveryStep, slowMo } = msg;
  cancelRequested = false;

  send({ type: 'job_accepted', jobId });

  const timeout = 30000;
  let browser: Browser | null = null;
  const startTime = Date.now();
  let passedTests = 0;
  let failedTests = 0;

  const emit = (event: string, data: object) => send({ type: event, jobId, data });

  try {
    emit('agent_status_update', { agent: 'Navigator', status: 'working', activity: 'Launching browser...' });

    browser = await chromium.launch({ headless, slowMo: slowMo || 0, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'NAT-2.0-RemoteAgent/1.0',
      ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS,
    });
    const page: Page = await context.newPage();

    const consoleErrors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push(e.message));

    emit('playwright_log', {
      timestamp: new Date().toISOString(), level: 'info', category: 'browser',
      message: `Browser ready (headless=${headless}) — running ${testCases.length} test(s) against ${targetUrl}`,
    });

    for (let i = 0; i < testCases.length; i++) {
      if (cancelRequested) break;

      const tc = testCases[i];
      emit('agent_status_update', { agent: 'Orchestrator', status: 'working', activity: `Executing test ${i + 1} of ${testCases.length}` });
      emit('playwright_log', { timestamp: new Date().toISOString(), level: 'info', category: 'test', message: `Starting: ${tc.title}` });
      emit('agent_status_update', { agent: 'Executor', status: 'working', activity: `Running: ${tc.title}` });

      const tcStart = Date.now();
      let tcStatus: 'passed' | 'failed' = 'passed';

      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout });
      } catch (navErr: any) {
        emit('playwright_log', { timestamp: new Date().toISOString(), level: 'warn', category: 'navigation', message: `Initial navigation warning: ${navErr.message}` });
      }

      for (let si = 0; si < tc.steps.length; si++) {
        if (cancelRequested) break;

        const step = tc.steps[si];
        const stepStart = Date.now();

        emit('step_progress', { stepIndex: si + 1, totalSteps: tc.steps.length });
        emit('playwright_log', { timestamp: new Date().toISOString(), level: 'info', category: 'action', message: `Step ${si + 1}: ${step.action}` });

        let stepStatus: 'passed' | 'failed' = 'passed';
        let stepError: string | undefined;
        let screenshot: string | undefined;

        try {
          await executeStep(page, step, timeout);
          if (screenshotOnEveryStep) {
            screenshot = await captureScreenshot(page);
          }
        } catch (err: any) {
          stepStatus = 'failed';
          stepError = err.message;
          tcStatus = 'failed';
          screenshot = await captureScreenshot(page);
          emit('playwright_log', { timestamp: new Date().toISOString(), level: 'error', category: 'result', message: `Step ${si + 1} FAILED — ${err.message}` });
        }

        if (screenshot) {
          emit('screenshot', { screenshot, step: `Test ${i + 1} — Step ${si + 1}`, testIndex: i + 1 });
        }

        emit('playwright_log', {
          timestamp: new Date().toISOString(),
          level: stepStatus === 'passed' ? 'info' : 'error',
          category: 'result',
          message: `Step ${si + 1} ${stepStatus.toUpperCase()}${stepError ? ' — ' + stepError : ''} (${Date.now() - stepStart}ms)`,
        });
      }

      if (tcStatus === 'passed') passedTests++; else failedTests++;

      emit('agent_status_update', { agent: 'Validator', status: 'working', activity: `Validating: ${tc.title}` });
      emit('test_complete', {
        testCaseId: tc.testCaseId,
        status: tcStatus,
        testIndex: i + 1,
        totalTests: testCases.length,
      });
      emit('playwright_log', {
        timestamp: new Date().toISOString(),
        level: tcStatus === 'passed' ? 'info' : 'error',
        category: 'result',
        message: `TEST ${tcStatus.toUpperCase()}: "${tc.title}" (${Date.now() - tcStart}ms)`,
      });
    }

    await context.close();

    emit('agent_status_update', { agent: 'Reporter', status: 'working', activity: 'Generating execution summary...' });

  } catch (err: any) {
    log(`Job ${jobId} error: ${err.message}`);
    send({ type: 'job_error', jobId, message: err.message });
    return;
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    currentJobId = null;
  }

  const duration = Date.now() - startTime;
  log(`Job ${jobId} complete — passed:${passedTests} failed:${failedTests} (${duration}ms)`);

  send({
    type: 'job_complete',
    jobId,
    summary: { passed: passedTests, failed: failedTests, skipped: 0, duration },
  });
}

// ─── Connection Lifecycle ─────────────────────────────────────────────────────

/**
 * Called once per transport when the connection becomes ready. Sends the
 * register payload and starts the keep-alive ping. Same payload shape works
 * for both transports because the WS path puts these fields directly on the
 * message and the Socket.IO server reads them from `socket.handshake.auth`
 * (which mirrors the same field names).
 */
function onConnected(): void {
  log(`Connected via ${TRANSPORT}. Registering...`);
  reconnectAttempts = 0;

  // For raw WS, the server's first-message-must-be-agent_register check
  // requires us to emit this. For Socket.IO the handshake auth already
  // carried the metadata, but resending it is harmless and keeps the
  // protocol contract uniform.
  send({
    type: 'agent_register',
    agentId: AGENT_ID,
    hostname: os.hostname(),
    capabilities: ['chromium'],
    ...(TOKEN ? { token: TOKEN } : {}),
    ...(AGENT_LABEL ? { label: AGENT_LABEL } : {}),
    ...(AGENT_TAGS.length ? { tags: AGENT_TAGS } : {}),
  });

  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => send({ type: 'ping' }), PING_INTERVAL_MS);
}

/** Shared dispatch for inbound protocol messages. */
function handleInbound(msg: Record<string, unknown>): void {
  switch (msg.type) {
    case 'registered':
      log(`Registered as ${msg.agentId}. Waiting for jobs...`);
      break;

    case 'execute_job':
      if (currentJobId) {
        send({ type: 'job_rejected', jobId: msg.jobId as string, reason: 'Agent is busy' });
        return;
      }
      currentJobId = msg.jobId as string;
      log(`Received job ${currentJobId}`);
      runJob(msg as unknown as ExecuteJobMsg).catch(err => {
        log(`Unhandled job error: ${err.message}`);
        send({ type: 'job_error', jobId: currentJobId as string, message: err.message });
        currentJobId = null;
      });
      break;

    case 'cancel_job':
      if (msg.jobId === currentJobId) {
        log(`Cancelling job ${currentJobId}`);
        cancelRequested = true;
      }
      break;

    case 'pong':
      break;

    case 'error':
      log(`Server error: ${msg.message}`);
      break;
  }
}

function onDisconnected(): void {
  log('Disconnected from server.');
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  conn = null;
  scheduleReconnect();
}

// ─── Transport: raw WebSocket ─────────────────────────────────────────────────

function connectWs(): void {
  log(`Connecting to ${SERVER_URL} (raw WebSocket)...`);
  const wsOptions: any = {};
  if (TOKEN) wsOptions.headers = { Authorization: `Bearer ${TOKEN}` };
  const ws = new WebSocket(SERVER_URL, wsOptions);

  conn = {
    kind: 'ws',
    send: (msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close: () => { try { ws.close(); } catch {} },
  };

  ws.on('open', onConnected);

  ws.on('message', (raw: Buffer) => {
    try {
      handleInbound(JSON.parse(raw.toString()));
    } catch {
      // ignore malformed payload
    }
  });

  ws.on('close', onDisconnected);
  ws.on('error', (err) => log(`WebSocket error: ${err.message}`));
}

// ─── Transport: Socket.IO ─────────────────────────────────────────────────────

/**
 * Strip any path/query off SERVER_URL when the user supplied a path-bearing
 * URL (legacy `ws://host/ws/execution-agent`). socket.io-client wants the
 * origin only -- the namespace is appended below.
 */
function deriveOriginFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

function connectSocketIO(): void {
  // Lazy require so the dependency only matters when this transport is selected.
  const { io: ioClient } = require('socket.io-client') as typeof import('socket.io-client');

  // Map ws://* → http://*, wss://* → https://* so legacy SERVER_URL values
  // still work when the user opts into Socket.IO via AGENT_TRANSPORT.
  const httpUrl = SERVER_URL
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://');
  const origin = deriveOriginFromUrl(httpUrl);
  const namespaceUrl = `${origin}/execution-agent`;

  log(`Connecting to ${namespaceUrl} (Socket.IO)...`);

  const socket = ioClient(namespaceUrl, {
    transports: ['websocket', 'polling'],
    reconnection: false, // we manage reconnect ourselves below
    auth: {
      token: TOKEN,
      agentId: AGENT_ID,
      hostname: os.hostname(),
      capabilities: ['chromium'],
      ...(AGENT_LABEL ? { label: AGENT_LABEL } : {}),
      ...(AGENT_TAGS.length ? { tags: AGENT_TAGS } : {}),
    },
  });

  conn = {
    kind: 'socket.io',
    send: (msg) => {
      if (socket.connected) {
        const { type, ...payload } = msg;
        socket.emit(type, payload);
      }
    },
    close: () => { try { socket.disconnect(); } catch {} },
  };

  socket.on('connect', onConnected);

  // Inbound protocol events: route them into the shared dispatcher by
  // synthesising a {type, ...payload} envelope.
  const inboundEvents = ['registered', 'execute_job', 'cancel_job', 'pong', 'error'] as const;
  for (const evt of inboundEvents) {
    socket.on(evt, (payload: Record<string, unknown> | undefined) => {
      handleInbound({ type: evt, ...(payload || {}) });
    });
  }

  socket.on('disconnect', onDisconnected);
  socket.on('connect_error', (err: Error) => log(`Socket.IO connect error: ${err.message}`));
}

function connect(): void {
  if (TRANSPORT === 'socket.io') connectSocketIO();
  else connectWs();
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT) {
    log('Max reconnect attempts reached. Exiting.');
    process.exit(1);
  }
  reconnectAttempts++;
  const delay = RECONNECT_DELAY_MS * Math.min(reconnectAttempts, 3);
  log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT})...`);
  setTimeout(connect, delay);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  log('Shutting down...');
  if (conn) conn.close();
  process.exit(0);
});

connect();
