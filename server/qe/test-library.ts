/**
 * NAT 2.0 — Test Library
 * File-backed store for folders and recorded tests.
 * Persists to test-library.json in project root.
 * No DB migration required.
 */

import type { Express, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { qeAnthropicClient as visionClient } from './ai-client.js';
import { getRepoRoot } from '../utils/module-paths';
import { isAwsHosting } from '../platform/hosting';

function findLibraryScreenshot(testId: string): string | null {
  const testResultsDir = path.join(PROJECT_ROOT, 'test-results');
  if (!fs.existsSync(testResultsDir)) return null;
  const entries = fs.readdirSync(testResultsDir);
  // Playwright names folders like: lib-{testId}-Recorded-flow-chromium-...
  const prefix = `lib-${testId}`;
  const match = entries.find(e => e.includes(prefix));
  if (!match) return null;
  const dir = path.join(testResultsDir, match);
  if (!fs.statSync(dir).isDirectory()) return null;
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.png'));
  if (!files.length) return null;
  return path.join(dir, files[0]);
}

async function runVisualAnalysis(
  screenshotPath: string,
  errorOutput: string,
  onChunk: (text: string) => void
): Promise<string> {
  const base64 = fs.readFileSync(screenshotPath).toString('base64');
  const cleanError = errorOutput.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 3000);
  let full = '';
  try {
    const stream = visionClient.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          { type: 'text', text: `This screenshot was captured when a Playwright test FAILED.\n\nError:\n${cleanError}\n\nLook at the screenshot and explain:\n1. What state is the page in?\n2. What is visually wrong?\n3. Why did the test fail?\n4. What is the simplest fix?\n\nBe concise and plain English.` }
        ]
      }]
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        full += event.delta.text;
        onChunk(event.delta.text);
      }
    }
  } catch (err: any) {
    full = `Visual analysis unavailable: ${err.message}`;
    onChunk(full);
  }
  return full;
}

const PROJECT_ROOT = getRepoRoot();
const STORE_FILE = path.join(PROJECT_ROOT, 'test-library.json');
const PW_SCRIPTS_DIR = path.join(PROJECT_ROOT, 'recorded-scripts');
const PW_CONFIG = path.join(PROJECT_ROOT, 'playwright-recorder.config.ts');

function resolvePwCli(): string {
  const candidates = [
    path.join(PROJECT_ROOT, 'node_modules', '@playwright', 'test', 'cli.js'),
    path.join(PROJECT_ROOT, 'node_modules', 'playwright', 'cli.js'),
    path.join(PROJECT_ROOT, 'node_modules', 'playwright-core', 'cli.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestFolder {
  id: string;
  name: string;
  type: 'module' | 'suite';   // module = feature group; suite = smoke/regression/sanity
  parentId: string | null;    // null = root
  createdAt: number;
}

export interface RecordedTest {
  id: string;
  folderId: string;
  name: string;
  url: string;
  projectName?: string;       // optional project grouping (e.g. "RedikerAcademy")
  script: string;             // full .spec.ts content
  nlSteps: string[];          // natural language steps
  tags: string[];
  lastRunStatus: 'passed' | 'failed' | 'never';
  lastRunAt: number | null;
  lastRunDuration: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryRunResult {
  testId: string;
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

export interface LibraryRun {
  id: string;
  name: string;
  testIds: string[];
  status: 'running' | 'completed' | 'failed';
  passCount: number;
  failCount: number;
  results: LibraryRunResult[];
  startedAt: number;
  completedAt: number | null;
  clients: Response[];        // SSE clients (transient)
}

interface Store {
  folders: TestFolder[];
  tests: RecordedTest[];
}

// ─── File-backed Store ────────────────────────────────────────────────────────

function loadStore(): Store {
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    }
  } catch {}
  return { folders: defaultFolders(), tests: [] };
}

function saveStore() {
  try { fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2)); } catch {}
}

function defaultFolders(): TestFolder[] {
  const now = Date.now();
  return [
    { id: 'f-modules',    name: 'Modules',    type: 'module', parentId: null, createdAt: now },
    { id: 'f-suites',     name: 'Suites',     type: 'suite',  parentId: null, createdAt: now },
    { id: 'f-smoke',      name: 'Smoke',      type: 'suite',  parentId: 'f-suites',  createdAt: now },
    { id: 'f-regression', name: 'Regression', type: 'suite',  parentId: 'f-suites',  createdAt: now },
    { id: 'f-sanity',     name: 'Sanity',     type: 'suite',  parentId: 'f-suites',  createdAt: now },
  ];
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

let store: Store = loadStore();

// In-memory run tracking (transient — resets on restart)
const activeRuns = new Map<string, LibraryRun>();

// ─── REST Routes ──────────────────────────────────────────────────────────────

export function registerTestLibraryRoutes(app: Express) {

  // ── Folders ────────────────────────────────────────────────────────────────

  // GET /api/test-library/folders — full folder tree
  app.get('/api/test-library/folders', (_req: Request, res: Response) => {
    res.json(store.folders);
  });

  // POST /api/test-library/folders — create folder
  app.post('/api/test-library/folders', (req: Request, res: Response) => {
    const { name, type = 'module', parentId = null } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const folder: TestFolder = { id: uid(), name, type, parentId, createdAt: Date.now() };
    store.folders.push(folder);
    saveStore();
    res.json(folder);
  });

  // PUT /api/test-library/folders/:id — rename
  app.put('/api/test-library/folders/:id', (req: Request, res: Response) => {
    const folder = store.folders.find(f => f.id === req.params.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    if (req.body.name) folder.name = req.body.name;
    if (req.body.parentId !== undefined) folder.parentId = req.body.parentId;
    saveStore();
    res.json(folder);
  });

  // DELETE /api/test-library/folders/:id
  app.delete('/api/test-library/folders/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    // Collect all descendant folder ids
    const toDelete = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const fid = queue.shift()!;
      toDelete.add(fid);
      store.folders.filter(f => f.parentId === fid).forEach(f => queue.push(f.id));
    }
    store.folders = store.folders.filter(f => !toDelete.has(f.id));
    // Move orphaned tests to root modules folder
    store.tests.forEach(t => { if (toDelete.has(t.folderId)) t.folderId = 'f-modules'; });
    saveStore();
    res.json({ success: true });
  });

  // ── Tests ──────────────────────────────────────────────────────────────────

  // GET /api/test-library/tests?folderId=xxx
  app.get('/api/test-library/tests', (req: Request, res: Response) => {
    const { folderId } = req.query;
    const tests = folderId
      ? store.tests.filter(t => t.folderId === folderId)
      : store.tests;
    // Return without full script for list view (perf)
    res.json(tests.map(t => ({ ...t, script: undefined })));
  });

  // GET /api/test-library/tests/:id — full test with script
  app.get('/api/test-library/tests/:id', (req: Request, res: Response) => {
    const test = store.tests.find(t => t.id === req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });
    res.json(test);
  });

  // POST /api/test-library/tests — save new test
  app.post('/api/test-library/tests', (req: Request, res: Response) => {
    const { folderId, name, url, script, nlSteps = [], tags = [], projectName } = req.body;
    if (!folderId || !name || !script) return res.status(400).json({ error: 'folderId, name, script required' });
    if (!store.folders.find(f => f.id === folderId)) return res.status(400).json({ error: 'Folder not found' });
    const now = Date.now();
    const test: RecordedTest = {
      id: uid(), folderId, name, url: url || '',
      ...(projectName ? { projectName } : {}),
      script, nlSteps, tags,
      lastRunStatus: 'never', lastRunAt: null, lastRunDuration: null,
      createdAt: now, updatedAt: now
    };
    store.tests.push(test);
    saveStore();
    res.json(test);
  });

  // PUT /api/test-library/tests/:id — update (rename, move folder, update script)
  app.put('/api/test-library/tests/:id', (req: Request, res: Response) => {
    const test = store.tests.find(t => t.id === req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });
    const { name, folderId, script, nlSteps, tags, projectName } = req.body;
    if (name) test.name = name;
    if (folderId) test.folderId = folderId;
    if (script) test.script = script;
    if (nlSteps) test.nlSteps = nlSteps;
    if (tags) test.tags = tags;
    if (projectName !== undefined) test.projectName = projectName || undefined;
    test.updatedAt = Date.now();
    saveStore();
    res.json(test);
  });

  // DELETE /api/test-library/tests/:id
  app.delete('/api/test-library/tests/:id', (req: Request, res: Response) => {
    const idx = store.tests.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Test not found' });
    store.tests.splice(idx, 1);
    saveStore();
    res.json({ success: true });
  });

  // GET /api/test-library/tests/:id/script — download .spec.ts
  app.get('/api/test-library/tests/:id/script', (req: Request, res: Response) => {
    const test = store.tests.find(t => t.id === req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${test.name.replace(/[^a-z0-9]/gi, '-')}.spec.ts"`);
    res.send(test.script);
  });

  // ── Bulk Execute ───────────────────────────────────────────────────────────

  // POST /api/test-library/execute — { testIds: string[], folderIds?: string[] }
  app.post('/api/test-library/execute', (req: Request, res: Response) => {
    const { testIds = [], folderIds = [], runName } = req.body as {
      testIds: string[]; folderIds: string[]; runName?: string;
    };

    // Expand folder selections to test ids
    const allTestIds = new Set<string>(testIds);
    folderIds.forEach(fid => {
      store.tests.filter(t => t.folderId === fid).forEach(t => allTestIds.add(t.id));
    });

    const selectedTests = store.tests.filter(t => allTestIds.has(t.id));
    if (selectedTests.length === 0) return res.status(400).json({ error: 'No tests selected' });

    const runId = `lib-run-${Date.now()}`;
    const run: LibraryRun = {
      id: runId,
      name: runName || `Run ${new Date().toLocaleTimeString()}`,
      testIds: selectedTests.map(t => t.id),
      status: 'running',
      passCount: 0,
      failCount: 0,
      results: [],
      startedAt: Date.now(),
      completedAt: null,
      clients: []
    };
    activeRuns.set(runId, run);
    res.json({ runId, testCount: selectedTests.length });

    // Run tests sequentially, streaming progress
    runTestsSequentially(run, selectedTests);
  });

  // GET /api/test-library/execute/:runId/stream — SSE
  app.get('/api/test-library/execute/:runId/stream', (req: Request, res: Response) => {
    const run = activeRuns.get(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Replay buffered results
    run.results.forEach(r => res.write(`data: ${JSON.stringify({ type: 'test_result', result: r })}\n\n`));

    if (run.status !== 'running') {
      res.write(`data: ${JSON.stringify({ type: 'run_complete', run: sanitizeRun(run) })}\n\n`);
      res.end();
      return;
    }

    run.clients.push(res);
    req.on('close', () => { run.clients = run.clients.filter(c => c !== res); });
  });

  // GET /api/test-library/runs — list all runs
  app.get('/api/test-library/runs', (_req: Request, res: Response) => {
    res.json(Array.from(activeRuns.values()).map(sanitizeRun).reverse());
  });

  // GET /api/test-library/stats — summary counts
  app.get('/api/test-library/stats', (_req: Request, res: Response) => {
    res.json({
      totalTests: store.tests.length,
      totalFolders: store.folders.length,
      passed: store.tests.filter(t => t.lastRunStatus === 'passed').length,
      failed: store.tests.filter(t => t.lastRunStatus === 'failed').length,
      never: store.tests.filter(t => t.lastRunStatus === 'never').length,
    });
  });
}

// ─── Sequential test runner ───────────────────────────────────────────────────

function sanitizeRun(run: LibraryRun) {
  const { clients: _c, ...rest } = run as any;
  return rest;
}

function broadcastRun(run: LibraryRun, event: object) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  run.clients.forEach(c => { try { c.write(payload); } catch {} });
}

async function runTestsSequentially(run: LibraryRun, tests: RecordedTest[]) {
  // Ensure scripts dir exists
  if (!fs.existsSync(PW_SCRIPTS_DIR)) fs.mkdirSync(PW_SCRIPTS_DIR, { recursive: true });

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    broadcastRun(run, {
      type: 'test_start',
      testId: test.id,
      testName: test.name,
      index: i + 1,
      total: tests.length
    });

    const startMs = Date.now();
    const scriptPath = path.join(PW_SCRIPTS_DIR, `lib-${test.id}.spec.ts`);
    fs.writeFileSync(scriptPath, test.script);

    const result = await runSingleTest(run, test, scriptPath, startMs);
    run.results.push(result);

    if (result.status === 'passed') run.passCount++;
    else run.failCount++;

    // Update stored test status
    const stored = store.tests.find(t => t.id === test.id);
    if (stored) {
      stored.lastRunStatus = result.status === 'passed' ? 'passed' : 'failed';
      stored.lastRunAt = Date.now();
      stored.lastRunDuration = result.duration;
    }
    saveStore();

    broadcastRun(run, { type: 'test_result', result });

    // Visual failure analysis — find Playwright screenshot and ask Claude Vision
    if (result.status === 'failed') {
      // Give Playwright a moment to flush the screenshot to disk
      await new Promise(r => setTimeout(r, 900));
      const screenshotPath = findLibraryScreenshot(test.id);
      if (screenshotPath) {
        broadcastRun(run, { type: 'visual_analysis_start', testId: test.id });
        await runVisualAnalysis(screenshotPath, result.error || 'Test failed', (chunk) => {
          broadcastRun(run, { type: 'visual_analysis_chunk', testId: test.id, text: chunk });
        });
        broadcastRun(run, { type: 'visual_analysis_done', testId: test.id });
      }
    }

    // Cleanup script
    try { fs.unlinkSync(scriptPath); } catch {}
  }

  run.status = run.failCount === 0 ? 'completed' : 'failed';
  run.completedAt = Date.now();
  saveStore();

  broadcastRun(run, {
    type: 'run_complete',
    run: sanitizeRun(run)
  });

  run.clients.forEach(c => { try { c.end(); } catch {} });
}

function runSingleTest(
  run: LibraryRun,
  test: RecordedTest,
  scriptPath: string,
  startMs: number
): Promise<LibraryRunResult> {
  return new Promise(resolve => {
    const nodeBin = process.execPath;
    const pwCli = resolvePwCli();
    const relScript = path.relative(PROJECT_ROOT, scriptPath).replace(/\\/g, '/');

    // On AWS / Linux servers there is no X display — match recorder-ws.ts:
    // omit --headed so playwright-recorder.config.ts controls headless mode.
    const pwArgs = [pwCli, 'test', relScript, '--reporter=list'];
    if (!isAwsHosting() && process.platform !== 'linux') pwArgs.push('--headed');
    pwArgs.push('--config', PW_CONFIG);
    const proc = spawn(nodeBin, pwArgs, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
      shell: false
    });

    let output = '';
    let errorLines: string[] = [];

    proc.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      output += text;
      // Stream individual output lines to clients
      text.split('\n').filter(l => l.trim()).forEach(line => {
        broadcastRun(run, { type: 'output', testId: test.id, line: line.trim() });
      });
    });

    proc.stderr.on('data', (d: Buffer) => {
      const lines = d.toString().split('\n').filter(l => l.trim());
      errorLines.push(...lines);
      lines.forEach(line => broadcastRun(run, { type: 'output', testId: test.id, line, isError: true }));
    });

    proc.on('close', (code: number) => {
      const duration = Date.now() - startMs;
      const passed = code === 0;
      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
      const pickErrorLine = (lines: string[]) => {
        const cleaned = lines.map(stripAnsi);
        return (
          cleaned.find(l => /Error:/i.test(l)) ||
          cleaned.find(l => /(TimeoutError|expect\(|strict mode)/i.test(l)) ||
          cleaned.filter(Boolean).slice(-5).join(' | ') ||
          undefined
        );
      };
      const errorMsg = passed ? undefined : (
        pickErrorLine(errorLines) ||
        pickErrorLine(output.split('\n')) ||
        'Test failed'
      );
      resolve({
        testId: test.id,
        testName: test.name,
        status: passed ? 'passed' : 'failed',
        duration,
        error: errorMsg
      });
    });

    proc.on('error', (err: Error) => {
      resolve({
        testId: test.id,
        testName: test.name,
        status: 'failed',
        duration: Date.now() - startMs,
        error: err.message
      });
    });
  });
}
