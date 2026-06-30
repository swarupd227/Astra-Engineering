/**
 * NAT 2.0 — agent-ws.ts
 * WebSocket server for remote Playwright execution agents.
 *
 * Architecture:
 *   Remote Agent connects to /ws/execution-agent
 *   Server sends  execute_job  → Agent runs Playwright → Agent streams back results
 *   Server relays results to the SSE stream watched by the NAT 2.0 UI
 *
 * Message flow:
 *   Agent → Server: agent_register, job_accepted, step_result, test_result, job_complete, ping
 *   Server → Agent: execute_job, cancel_job, pong
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { randomBytes } from 'crypto';
import type { Server as SocketIOServer, Socket as IOSocket } from 'socket.io';

function getAllowedTokens(): Set<string> {
  const list = process.env.AGENT_TOKENS || process.env.AGENT_TOKEN || '';
  return new Set(list.split(',').map(s => s.trim()).filter(Boolean));
}

function extractBearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

let devModeWarned = false;

export function isAgentAuthorized(req: IncomingMessage): boolean {
  const allowed = getAllowedTokens();
  if (allowed.size === 0) {
    if (!devModeWarned) {
      console.warn('[AgentWS] DEV MODE — no AGENT_TOKENS configured, accepting all WS connections');
      devModeWarned = true;
    }
    return true;
  }
  const token = extractBearerToken(req);
  return token != null && allowed.has(token);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentJobPayload {
  executionRunId: string;
  testCases: Array<{
    testCaseId: string;
    title: string;
    category: string;
    priority: string;
    steps: Array<{ action: string; expected?: string; testData?: string }>;
  }>;
  targetUrl: string;
  browser: string;
  headless: boolean;
  screenshotOnEveryStep: boolean;
  slowMo?: number;
}

export interface SseCallback {
  sendEvent: (event: string, data: unknown) => void;
  isCancelled: () => boolean;
}

interface PendingJob {
  jobId: string;
  payload: AgentJobPayload;
  sse: SseCallback;
  resolve: (summary: JobSummary) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

interface JobSummary {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

/**
 * Transport-agnostic handle for an agent connection. The same agent registry
 * (the `agents` Map below) holds raw WebSocket clients (legacy `/ws/execution-agent`)
 * and Socket.IO clients (the `/execution-agent` namespace mounted on the
 * shared `/socket.io/` path) side-by-side. Server-side code that pushes to an
 * agent should call `agent.send(type, payload)` and `agent.close()` instead
 * of touching the underlying transport object directly.
 */
type AgentTransport = 'ws' | 'socket.io';

interface ConnectedAgent {
  agentId: string;
  hostname: string;
  capabilities: string[];
  label: string;
  tags: string[];
  transport: AgentTransport;
  send: (type: string, payload?: Record<string, unknown>) => void;
  close: (code?: number, reason?: string) => void;
  /**
   * Underlying transport object. Kept for back-compat with code that still
   * accesses `.ws` directly; new code should prefer `send`/`close` above.
   */
  ws?: WebSocket;
  status: 'idle' | 'busy';
  currentJobId: string | null;
  lastPingAt: number;
  tenantId?: string;
}

// ─── Agent Registry ───────────────────────────────────────────────────────────

const agents = new Map<string, ConnectedAgent>();
const pendingJobs = new Map<string, PendingJob>();

const JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function generateJobId(): string {
  return 'job-' + randomBytes(6).toString('hex');
}

/**
 * Returns true when at least one idle agent is connected.
 */
export function hasAvailableAgent(): boolean {
  return Array.from(agents.values()).some(a => a.status === 'idle');
}

/**
 * Returns the count of connected agents and their statuses.
 */
export function getAgentStatus(): { total: number; idle: number; busy: number; agents: Array<{ agentId: string; hostname: string; status: string; label: string; tags: string[] }> } {
  const all = Array.from(agents.values());
  const idle = all.filter(a => a.status === 'idle').length;
  const busy = all.filter(a => a.status === 'busy').length;
  const list = all.map(a => ({ agentId: a.agentId, hostname: a.hostname, status: a.status, label: a.label, tags: a.tags }));
  return { total: agents.size, idle, busy, agents: list };
}

/**
 * Dispatch a job to an available remote agent.
 * Returns a promise that resolves when the job completes.
 * Throws if no agent is available.
 */
export function dispatchJobToAgent(payload: AgentJobPayload, sse: SseCallback): Promise<JobSummary> {
  // Find first idle agent
  const targetAgent: ConnectedAgent | null = Array.from(agents.values()).find(a => a.status === 'idle') || null;

  if (!targetAgent) {
    return Promise.reject(new Error('No idle remote execution agent available'));
  }

  const jobId = generateJobId();
  const agent = targetAgent;

  return new Promise<JobSummary>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingJobs.delete(jobId);
      agent.status = 'idle';
      agent.currentJobId = null;
      reject(new Error(`Job ${jobId} timed out after ${JOB_TIMEOUT_MS / 1000}s`));
    }, JOB_TIMEOUT_MS);

    pendingJobs.set(jobId, { jobId, payload, sse, resolve, reject, timeout });

    // Mark agent busy
    agent.status = 'busy';
    agent.currentJobId = jobId;

    // Send job to agent
    agent.send('execute_job', { jobId, ...payload });

    console.log(`[AgentWS] Dispatched job ${jobId} to agent ${agent.agentId} (${agent.hostname}) via ${agent.transport}`);
  });
}

/**
 * Cancel an in-progress job (best-effort).
 */
export function cancelJob(executionRunId: string): void {
  const jobEntry = Array.from(pendingJobs.entries()).find(([, job]) => job.payload.executionRunId === executionRunId);
  if (!jobEntry) return;
  const [jobId, job] = jobEntry;
  const runningAgent = Array.from(agents.values()).find(a => a.currentJobId === jobId);
  if (runningAgent) {
    runningAgent.send('cancel_job', { jobId });
  }
  clearTimeout(job.timeout);
  pendingJobs.delete(jobId);
}

// ─── Incoming Message Handler ─────────────────────────────────────────────────

function handleAgentMessage(agent: ConnectedAgent, msg: Record<string, unknown>): void {
  switch (msg.type) {

    case 'ping':
      agent.lastPingAt = Date.now();
      agent.send('pong');
      break;

    case 'job_accepted':
      console.log(`[AgentWS] Agent ${agent.agentId} accepted job ${msg.jobId}`);
      break;

    case 'agent_status_update': {
      const job = pendingJobs.get(msg.jobId as string);
      if (!job) break;
      job.sse.sendEvent('agent_status', msg.data);
      break;
    }

    case 'playwright_log': {
      const job = pendingJobs.get(msg.jobId as string);
      if (!job) break;
      job.sse.sendEvent('playwright_log', msg.data);
      break;
    }

    case 'step_progress': {
      const job = pendingJobs.get(msg.jobId as string);
      if (!job) break;
      job.sse.sendEvent('step_progress', msg.data);
      break;
    }

    case 'screenshot': {
      const job = pendingJobs.get(msg.jobId as string);
      if (!job) break;
      job.sse.sendEvent('screenshot', msg.data);
      break;
    }

    case 'test_complete': {
      const job = pendingJobs.get(msg.jobId as string);
      if (!job) break;
      job.sse.sendEvent('test_complete', msg.data);
      break;
    }

    case 'job_complete': {
      const job = pendingJobs.get(msg.jobId as string);
      if (!job) break;

      clearTimeout(job.timeout);
      pendingJobs.delete(msg.jobId as string);

      agent.status = 'idle';
      agent.currentJobId = null;

      const summary = msg.summary as JobSummary;
      console.log(`[AgentWS] Job ${msg.jobId} complete — passed:${summary?.passed} failed:${summary?.failed}`);
      job.resolve(summary || { passed: 0, failed: 0, skipped: 0, duration: 0 });
      break;
    }

    case 'job_error': {
      const job = pendingJobs.get(msg.jobId as string);
      if (!job) break;

      clearTimeout(job.timeout);
      pendingJobs.delete(msg.jobId as string);

      agent.status = 'idle';
      agent.currentJobId = null;

      job.sse.sendEvent('execution_error', { message: msg.message || 'Remote agent reported an error' });
      job.reject(new Error(String(msg.message || 'Remote agent error')));
      break;
    }
  }
}

// ─── WebSocket Server Setup ───────────────────────────────────────────────────

// Parse WS_ALLOWED_ORIGINS for agent connections
function isAgentOriginAllowed(origin: string | undefined): boolean {
  const raw = process.env.WS_ALLOWED_ORIGINS;
  if (!raw) return true;
  if (!origin) return true; // Node ws client sends no Origin — allow (agent containers)
  const allowed = new Set(raw.split(',').map(o => o.trim()).filter(Boolean));
  return allowed.has(origin);
}

const STALE_AGENT_THRESHOLD_MS = 90_000; // 90 seconds without ping = stale
let _agentTokenWarningLogged = false;
let _staleSweeperStarted = false;

/**
 * Start the cross-transport stale agent sweeper exactly once. Called from
 * both setupAgentWebSocket and setupAgentSocketIO -- the second caller is a
 * no-op. Sweeper iterates the shared `agents` Map regardless of transport.
 */
function ensureStaleSweeper(): void {
  if (_staleSweeperStarted) return;
  _staleSweeperStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, agent] of agents.entries()) {
      if (now - agent.lastPingAt > STALE_AGENT_THRESHOLD_MS) {
        console.log(`[AgentWS] Stale agent sweep: closing ${id} (no ping in ${Math.round((now - agent.lastPingAt) / 1000)}s, transport=${agent.transport})`);
        try { agent.close(4001, 'Stale connection'); } catch {}
      }
    }
  }, 60_000);
}

export function setupAgentWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  ensureStaleSweeper();

  wss.on('connection', (ws: WebSocket, req: any) => {
    // Origin allowlist check
    const origin = req?.headers?.origin;
    if (!isAgentOriginAllowed(origin)) {
      console.warn(`[AgentWS] Rejected connection from origin: ${origin}`);
      ws.close(4003, 'Origin not allowed');
      return;
    }

    let agent: ConnectedAgent | null = null;

    ws.on('message', (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // First message must be agent_register
      if (!agent) {
        if (msg.type !== 'agent_register') {
          ws.send(JSON.stringify({ type: 'error', message: 'First message must be agent_register' }));
          ws.close();
          return;
        }

        // Validate AGENT_TOKEN if configured
        const expectedToken = process.env.AGENT_TOKEN;
        if (expectedToken) {
          const clientToken = msg.token as string;
          if (clientToken !== expectedToken) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid AGENT_TOKEN' }));
            ws.close(4401, 'Unauthorized');
            console.warn(`[AgentWS] Rejected agent — invalid token from ${(msg.hostname as string) || 'unknown'}`);
            return;
          }
        } else if (!_agentTokenWarningLogged) {
          console.warn('[AgentWS] AGENT_TOKEN not set — accepting agents without authentication (dev mode)');
          _agentTokenWarningLogged = true;
        }

        const agentId = (msg.agentId as string) || ('agent-' + randomBytes(4).toString('hex'));
        agent = {
          agentId,
          hostname: (msg.hostname as string) || 'unknown',
          capabilities: (msg.capabilities as string[]) || ['chromium'],
          label: (msg.label as string) || '',
          tags: (msg.tags as string[]) || [],
          transport: 'ws',
          send: (type, payload) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type, ...(payload || {}) }));
            }
          },
          close: (code, reason) => {
            try { ws.close(code, reason); } catch {}
          },
          ws,
          status: 'idle',
          currentJobId: null,
          lastPingAt: Date.now(),
          tenantId: (msg.tenantId as string) || undefined,
        };
        agents.set(agentId, agent);

        agent.send('registered', { agentId });
        console.log(`[AgentWS] Agent registered (ws): ${agentId} @ ${agent.hostname} label="${agent.label}" caps=[${agent.capabilities.join(',')}] tags=[${agent.tags.join(',')}]`);
        return;
      }

      handleAgentMessage(agent, msg);
    });

    ws.on('close', () => {
      if (agent) {
        console.log(`[AgentWS] Agent disconnected: ${agent.agentId}`);

        if (agent.currentJobId) {
          const job = pendingJobs.get(agent.currentJobId);
          if (job) {
            clearTimeout(job.timeout);
            pendingJobs.delete(agent.currentJobId);
            job.sse.sendEvent('execution_error', { message: `Remote agent ${agent.agentId} disconnected mid-job` });
            job.reject(new Error('Agent disconnected'));
          }
        }

        agents.delete(agent.agentId);
      }
    });

    ws.on('error', () => {
      // handled by close
    });
  });

  console.log('[AgentWS] Remote execution agent WebSocket ready at /ws/execution-agent');
  return wss;
}

// ─── Socket.IO Namespace Setup ────────────────────────────────────────────────

/**
 * Mount the agent protocol on the shared Socket.IO server under namespace
 * `/execution-agent`. Used in environments (e.g. Hilti) whose proxy chain only
 * permits Socket.IO traffic on the default `/socket.io/` path.
 *
 * The `agents` Map and pending-job state are shared with setupAgentWebSocket,
 * so a job can be dispatched to whichever agent connected first regardless of
 * its transport. Auth metadata (token + agent identity) is sent in the
 * Socket.IO handshake's `auth` payload, eliminating the legacy
 * "first message must be agent_register" race in the raw-WS path.
 */
export function setupAgentSocketIO(io: SocketIOServer): void {
  ensureStaleSweeper();

  const ns = io.of('/execution-agent');

  // Token check runs before connect so unauthorized agents never reach the
  // namespace. Origin allowlist is best-effort here -- behind a proxy chain
  // the Origin header is often the proxy's, not the agent's.
  ns.use((socket, next) => {
    const auth = (socket.handshake.auth || {}) as Record<string, unknown>;
    const expectedToken = process.env.AGENT_TOKEN;
    if (expectedToken) {
      const clientToken = (auth.token as string) || '';
      if (clientToken !== expectedToken) {
        console.warn(`[AgentWS] Rejected socket.io agent — invalid token from ${(auth.hostname as string) || 'unknown'}`);
        return next(new Error('Unauthorized'));
      }
    } else if (!_agentTokenWarningLogged) {
      console.warn('[AgentWS] AGENT_TOKEN not set — accepting agents without authentication (dev mode)');
      _agentTokenWarningLogged = true;
    }

    const origin = socket.handshake.headers.origin as string | undefined;
    if (!isAgentOriginAllowed(origin)) {
      console.warn(`[AgentWS] Rejected socket.io connection from origin: ${origin}`);
      return next(new Error('Origin not allowed'));
    }

    next();
  });

  ns.on('connection', (socket: IOSocket) => {
    const auth = (socket.handshake.auth || {}) as Record<string, unknown>;

    const agentId = (auth.agentId as string) || ('agent-' + randomBytes(4).toString('hex'));
    const agent: ConnectedAgent = {
      agentId,
      hostname: (auth.hostname as string) || 'unknown',
      capabilities: (auth.capabilities as string[]) || ['chromium'],
      label: (auth.label as string) || '',
      tags: (auth.tags as string[]) || [],
      transport: 'socket.io',
      send: (type, payload) => {
        if (socket.connected) socket.emit(type, payload || {});
      },
      close: () => {
        try { socket.disconnect(true); } catch {}
      },
      status: 'idle',
      currentJobId: null,
      lastPingAt: Date.now(),
      tenantId: (auth.tenantId as string) || undefined,
    };
    agents.set(agentId, agent);

    agent.send('registered', { agentId });
    console.log(`[AgentWS] Agent registered (socket.io): ${agentId} @ ${agent.hostname} label="${agent.label}" caps=[${agent.capabilities.join(',')}] tags=[${agent.tags.join(',')}]`);

    // Each protocol message arrives as a discrete event on Socket.IO; route
    // them through the same handler the WS path uses by reconstructing the
    // {type, ...payload} envelope.
    const protocolEvents = [
      'ping',
      'job_accepted',
      'agent_status_update',
      'playwright_log',
      'step_progress',
      'screenshot',
      'test_complete',
      'job_complete',
      'job_error',
    ] as const;
    for (const evt of protocolEvents) {
      socket.on(evt, (payload: Record<string, unknown> | undefined) => {
        handleAgentMessage(agent, { type: evt, ...(payload || {}) });
      });
    }

    socket.on('disconnect', (reason: string) => {
      console.log(`[AgentWS] Agent disconnected (socket.io): ${agent.agentId} (${reason})`);
      if (agent.currentJobId) {
        const job = pendingJobs.get(agent.currentJobId);
        if (job) {
          clearTimeout(job.timeout);
          pendingJobs.delete(agent.currentJobId);
          job.sse.sendEvent('execution_error', { message: `Remote agent ${agent.agentId} disconnected mid-job` });
          job.reject(new Error('Agent disconnected'));
        }
      }
      agents.delete(agent.agentId);
    });
  });

  console.log('[AgentWS] Remote execution agent Socket.IO namespace ready at /socket.io/ namespace=/execution-agent');
}
