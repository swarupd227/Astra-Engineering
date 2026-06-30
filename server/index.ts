// Ensure DOM-related globals exist **before** any other imports run.
import "./dom-polyfills";
// Load environment variables before any module that reads them at import time
// (e.g. server/qe/crypto-utils.ts requires SESSION_SECRET).
import "dotenv/config";
import "./structured-logging";
import dotenv from "dotenv";
import { createLogger } from "./logger";
import * as fs from "fs";
import * as path from "path";
import { isAwsHosting, getExtensionWsPublicUrl, getNatS3Bucket, getNatS3Prefix } from "./platform/hosting";
import { setupAgentWebSocket, setupAgentSocketIO, getAgentStatus, isAgentAuthorized } from "./qe/agent-ws";
import { registerRecorderRoutes, setupRecorderWebSocket, setupRecorderSocketIO, registerPlaywrightRoutes, registerTestManagementRoutes } from "./qe/recorder-ws";
import { getSharedSocketIO } from "./routes";
import { registerQeApiRoutes } from "./qe/routes.js";
import { registerTestLibraryRoutes } from "./qe/test-library.js";
import { registerCoverageRoutes } from "./qe/coverage.js";
import { registerReportsRoutes } from "./qe/reports.js";
import { detectBrowser } from "./qe/playwright-setup";

const startupLogger = createLogger("startup");

process.on("unhandledRejection", (reason, promise) => {
  startupLogger.error("unhandled_rejection", {
    reason: reason instanceof Error ? reason : String(reason),
    promise: String(promise),
  });
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  startupLogger.error("uncaught_exception", {
    error: err instanceof Error ? err : String(err),
  });
  process.exit(1);
});

dotenv.config();
startupLogger.info("hosting_config", {
  devxHosting: process.env.DEVX_HOSTING || "(unset, defaults to azure)",
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const LOG_REDACTED = "[REDACTED]";
const SENSITIVE_LOG_KEY_RE =
  /^(access[_-]?token|refresh[_-]?token|id[_-]?token|token|pat|pat[_-]?token|api[_-]?key|apikey|authorization|password|secret|client[_-]?secret)$/i;

function redactForLogPreview(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => redactForLogPreview(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        SENSITIVE_LOG_KEY_RE.test(key) ? LOG_REDACTED : redactForLogPreview(child, seen),
      ]),
    );
  }

  return value;
}

(async () => {
  try {
    if (isAwsHosting()) {
      const { loadSecrets } = await import("./secrets-loader");
      await loadSecrets();
    }

    if (!process.env.DEVX_BUILD_SMOKETEST) {
      try {
        const { getProviderInfo, hasConfiguredSdk, warmupSdk } = await import("./ai-client");
        if (hasConfiguredSdk()) {
          await warmupSdk();
          const provider = getProviderInfo();
          startupLogger.info("ai_sdk_warmed", {
            provider: provider.provider,
            model: provider.model,
          });
        }
      } catch (err) {
        startupLogger.warn("ai_sdk_warmup_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const { initializeDatabase } = await import("./db");
    await initializeDatabase();

    const { clearStaleSpecsGenerationLocks } = await import("./routes/specs");
    await clearStaleSpecsGenerationLocks();

    const { validateEncryptionSetup } = await import("./crypto-utils");
    try {
      validateEncryptionSetup();
    } catch (err) {
      console.error("FATAL: encryption setup invalid:", err);
      process.exit(1);
    }

    // Pre-warm JWKS cache in background so first login doesn't block
    import("./auth/jwt-validator").then(({ warmupJwks }) => warmupJwks()).catch(() => {});

    // Detect Playwright browser at startup; triggers background install if missing (EC2/Linux first boot)
    try { detectBrowser(); } catch (err) { console.warn("[Startup] detectBrowser failed:", err); }

    const express = (await import("express")).default;
    type Request = import("express").Request;
    type Response = import("express").Response;
    type NextFunction = import("express").NextFunction;

    const { registerRoutes } = await import("./routes");
    const { registerAlternateRoutes } = await import("./routes/synthetic-data");
    const { registerAutomatedTestRoutes } = await import("./routes/automated-test");
    const { registerMfaRoutes } = await import("./mfa-routes");
    const { registerIntegrationsRoutes } = await import("./integrationsRoutes");
    const { setupVite, serveStatic, log } = await import("./vite");
    const httpLogger = createLogger("http");
    const { logAIConfiguration } = await import("./ai-config-logger");
    // Modular Jira POST handler registration
    const { registerHubArtifactsJiraPostRoute } = await import("./routes-hub-artifacts-jira-post");
    // Modular export route registration (if available)
    let registerExportRoutes;
    try {
      ({ registerExportRoutes } = await import("./export/registerExportRoutes"));
    } catch {}

    try {
      logAIConfiguration();
    } catch (err) {
      console.error("FATAL: failed to log AI configuration:", err);
      process.exit(1);
    }

    if (!isAwsHosting()) {
      startupLogger.info("ado_env_loaded", {
        adoOrg: !!process.env.ADO_ORG,
        adoProject: !!process.env.ADO_PROJECT,
        adoPatPresent: !!process.env.ADO_PAT,
      });
    }

    // Detect a system Chrome/Chromium for in-process Playwright execution.
    // If none is found, kick off a background install so the in-process
    // fallback path becomes available shortly after boot. The remote-agent
    // path does not depend on this and works regardless.
    try {
      const { detectBrowser, isPlaywrightReady, startPlaywrightInstallation } =
        await import("./qe/playwright-setup");
      detectBrowser();
      if (!isPlaywrightReady()) {
        startPlaywrightInstallation();
      }
    } catch (err) {
      console.warn("[Startup] Playwright browser detection skipped:", err);
    }

    const app = express();

    // Lightweight probe for ALB / K8s (must not serve SPA HTML or hit heavy middleware).
    app.get("/healthz", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });

    app.use((req, res, next) => {
      const origin = req.headers.origin;

      const allowedOrigins = [
        "https://gentle-hill-099ce5400.3.azurestaticapps.net",
        "https://gray-sand-0533b2c00.6.azurestaticapps.net",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:4000",
      ];

      const isAllowedOrigin =
        origin &&
        (allowedOrigins.includes(origin) || origin.includes(".azurestaticapps.net"));

      if (isAllowedOrigin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }

      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, x-user-email, x-user-oid, x-user-name, x-tenant-id, x-auth-provider, x-azure-token, x-organization-id, x-organization-name"
      );
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Max-Age", "86400");

      if (req.method === "OPTIONS") {
        return res.sendStatus(200);
      }

      next();
    });

    app.use(
      express.json({
        limit: process.env.MAX_REQUEST_BODY_SIZE || "50mb",
        verify: (req, _res, buf) => {
          req.rawBody = buf;
        },
      })
    );
    app.use(express.urlencoded({ extended: false, limit: process.env.MAX_REQUEST_BODY_SIZE || "50mb" }));

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      if (err?.type === "entity.too.large") {
        return res.status(413).json({
          message: "Request entity too large",
          limit: err?.limit,
        });
      }
      return next(err);
    });

    app.use((req, res, next) => {
      const start = Date.now();
      const path = req.path;
      let capturedJsonResponse: Record<string, any> | undefined = undefined;

      const originalResJson = res.json;
      res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
      };

      res.on("finish", () => {
        const durationMs = Date.now() - start;
        if (path.startsWith("/api")) {
          if (path.startsWith("/api/brd/generate/status/")) {
            return;
          }

          const fields: Record<string, unknown> = {
            method: req.method,
            path,
            statusCode: res.statusCode,
            durationMs,
          };
          if (capturedJsonResponse) {
            const preview = JSON.stringify(redactForLogPreview(capturedJsonResponse));
            fields.responsePreview =
              preview.length > 500 ? `${preview.slice(0, 499)}…` : preview;
          }

          httpLogger.info("request_completed", fields);
        }
      });

      next();
    });

    await registerAlternateRoutes(app);
    registerAutomatedTestRoutes(app);
    registerMfaRoutes(app);
    registerIntegrationsRoutes(app);
    registerHubArtifactsJiraPostRoute(app);
    if (registerExportRoutes) registerExportRoutes(app);
    const server = await registerRoutes(app);

    // ── QE URL rewrite: /qe/api/* → /api/* ──────────────────────────
    app.use((req, _res, next) => {
      if (req.url.startsWith('/qe/api/') || (req.originalUrl && req.originalUrl.startsWith('/qe/api/'))) {
        console.log(`[QE-Rewrite] ${req.method} ${req.originalUrl} → ${req.url.startsWith('/qe/api/') ? req.url.slice(3) : req.url}`);
        if (req.url.startsWith('/qe/api/')) {
          req.url = req.url.slice(3);
        }
      }
      next();
    });

    // ── QE API routes (projects, sprints, user stories, etc.) ──────
    try {
      await registerQeApiRoutes(app);
      log("QE API routes registered");
    } catch (err) {
      console.warn("[QE] Failed to register QE API routes:", err);
    }

    // ── QE Recorder & Playwright routes ─────────────────────────────
    try {
      registerRecorderRoutes(app);
      registerPlaywrightRoutes(app);
      registerTestManagementRoutes(app);
      registerTestLibraryRoutes(app);
      registerCoverageRoutes(app);
      registerReportsRoutes(app);
      log("QE Recorder & Playwright routes registered");
    } catch (err) {
      console.warn("[QE] Failed to register recorder routes:", err);
    }

    // ── QE WebSocket servers ────────────────────────────────────────
    try {
      const agentWss = setupAgentWebSocket(server);
      const recorderWss = setupRecorderWebSocket(server);

      // Mirror the same agent + recorder protocols on the shared Socket.IO
      // instance bootstrapped by registerRoutes(). Required for proxy chains
      // (e.g. Hilti: Akamai → ALB → Apache → ALB → Istio) that only allow
      // Socket.IO traffic on `/socket.io/*` and refuse raw `/ws/*` upgrades.
      // State is shared with the WS setups above, so a job can be dispatched
      // to whichever transport an agent connected with first.
      const sharedIO = getSharedSocketIO();
      if (sharedIO) {
        setupAgentSocketIO(sharedIO);
        setupRecorderSocketIO(sharedIO);
      } else {
        console.warn('[QE] Shared Socket.IO server not available -- /execution-agent and /recorder Socket.IO namespaces will NOT be mounted. Raw WebSocket transports remain available.');
      }

      server.on('upgrade', (req, socket, head) => {
        const pathname = req.url?.split('?')[0];
        if (pathname === '/ws/execution-agent') {
          if (!isAgentAuthorized(req)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          agentWss.handleUpgrade(req, socket as any, head, (ws) => {
            agentWss.emit('connection', ws, req);
          });
        } else if (pathname === '/ws/recorder') {
          recorderWss.handleUpgrade(req, socket as any, head, (ws) => {
            recorderWss.emit('connection', ws, req);
          });
        }
      });

      app.get('/api/qe/execution-agent/status', (_req, res) => {
        res.json(getAgentStatus());
      });

      // ── QE Downloads API ──────────────────────────────────────────────
      const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
      const NAT_S3_BUCKET = getNatS3Bucket();
      const NAT_S3_PREFIX = getNatS3Prefix();
      const DOWNLOADABLES: Record<string, { file: string; label: string; mime: string }> = {
        'nat-agent-windows': { file: 'NAT-Agent-Windows-x64.zip', label: 'NAT 2.0 Remote Agent (Windows x64)', mime: 'application/zip' },
        'chrome-extension':  { file: 'chrome-extension.zip',      label: 'NAT 2.0 Chrome Extension',           mime: 'application/zip' },
      };

      app.get('/api/qe/downloads', (_req, res) => {
        const items = Object.entries(DOWNLOADABLES).map(([id, d]) => ({
          id, label: d.label, filename: d.file, url: `/api/qe/downloads/${id}`, available: true,
        }));
        res.json({ items });
      });

      // Resolve the WebSocket URL the downloaded Chrome extension should connect to.
      // Order of precedence:
      //   1. EXTENSION_WS_PUBLIC_URL env (set on AWS where API Gateway can't WS-upgrade —
      //      points directly at the EC2 host on port 4000)
      //   2. Derived from request protocol+host (works for local dev and any deployment
      //      where WebSockets work on the same origin as HTTP)
      function getExtensionDefaultWsUrl(req: Request): string {
        const explicit = (getExtensionWsPublicUrl() || '').trim();
        if (explicit) return explicit.replace(/\/+$/, '');
        const host = (req.get('x-forwarded-host') || req.get('host') || 'localhost:4000').trim();
        const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').toLowerCase();
        const wsProto = proto === 'https' ? 'wss' : 'ws';
        return `${wsProto}://${host}`;
      }

      async function fetchExtensionZipBuffer(): Promise<Buffer> {
        // Prefer local downloads/ when present (fast path for dev; also used in container builds)
        const localPath = path.join(DOWNLOADS_DIR, DOWNLOADABLES['chrome-extension'].file);
        if (fs.existsSync(localPath)) return fs.readFileSync(localPath);
        // Fall back to S3 for AWS where the build artifact is uploaded by the pipeline
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: process.env.AWS_REGION || process.env.BEDROCK_REGION || 'ap-south-1' });
        const out = await s3.send(new GetObjectCommand({
          Bucket: NAT_S3_BUCKET,
          Key: `${NAT_S3_PREFIX}/${DOWNLOADABLES['chrome-extension'].file}`,
        }));
        if (!out.Body) throw new Error('S3 returned empty body');
        const chunks: Buffer[] = [];
        // The SDK returns a Node Readable stream when run on Node
        for await (const chunk of out.Body as any as AsyncIterable<Buffer>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      }

      // Patch the DEFAULT_SERVER_URL inside the extension's background.js so the
      // downloaded zip auto-connects to the host that served it, with no manual
      // configuration step required from the user.
      async function patchExtensionZip(zipBuf: Buffer, wsUrl: string): Promise<Buffer> {
        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip(zipBuf);
        const entries = zip.getEntries();
        let patched = false;
        for (const entry of entries) {
          if (entry.entryName.endsWith('background.js')) {
            const src = entry.getData().toString('utf8');
            const next = src.replace(
              /const\s+DEFAULT_SERVER_URL\s*=\s*['"][^'"]*['"]\s*;/,
              `const DEFAULT_SERVER_URL = '${wsUrl}';`,
            );
            if (next !== src) {
              zip.updateFile(entry.entryName, Buffer.from(next, 'utf8'));
              patched = true;
            }
          }
        }
        if (!patched) console.warn('[Downloads] Could not find DEFAULT_SERVER_URL line in background.js — extension will still default to localhost');
        return zip.toBuffer();
      }

      app.get('/api/qe/downloads/:id', async (req, res) => {
        const e = DOWNLOADABLES[req.params.id as keyof typeof DOWNLOADABLES];
        if (!e) return res.status(404).json({ error: 'Unknown download id' });

        // Chrome extension: stream a freshly-patched zip whose DEFAULT_SERVER_URL
        // points at this deployment, so testers don't see ERR_CONNECTION_REFUSED
        // to localhost after Load-Unpacked.
        if (req.params.id === 'chrome-extension') {
          try {
            const wsUrl = getExtensionDefaultWsUrl(req);
            const zipBuf = await fetchExtensionZipBuffer();
            const patched = await patchExtensionZip(zipBuf, wsUrl);
            res.setHeader('Content-Type', e.mime);
            res.setHeader('Content-Disposition', `attachment; filename="${e.file}"`);
            res.setHeader('Content-Length', String(patched.length));
            console.log(`[Downloads] Serving patched chrome-extension.zip (${(patched.length / 1024).toFixed(1)} KB) with serverUrl=${wsUrl}`);
            return res.end(patched);
          } catch (patchErr: any) {
            console.warn('[Downloads] Patch path failed, falling through to raw download:', patchErr?.message);
            // fall through to the legacy S3-redirect / local-file path below
          }
        }

        // Generate pre-signed S3 URL and redirect — bypasses API Gateway's 10MB response limit
        try {
          const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
          const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
          const s3 = new S3Client({ region: process.env.AWS_REGION || process.env.BEDROCK_REGION || 'ap-south-1' });
          const url = await getSignedUrl(s3, new GetObjectCommand({
            Bucket: NAT_S3_BUCKET,
            Key: `${NAT_S3_PREFIX}/${e.file}`,
            ResponseContentDisposition: `attachment; filename="${e.file}"`,
          }), { expiresIn: 900 }); // 15 min
          return res.redirect(302, url);
        } catch (s3Err: any) {
          // Fall back to local file for local dev
          const full = path.join(DOWNLOADS_DIR, e.file);
          if (fs.existsSync(full)) {
            return res.download(full, e.file, { headers: { 'Content-Type': e.mime } });
          }
          console.warn(`[Downloads] S3 pre-sign failed for ${e.file}:`, s3Err?.message);
          return res.status(404).json({ error: 'File not available', detail: s3Err?.message });
        }
      });

      log("WebSocket servers ready: /ws/execution-agent, /ws/recorder");
    } catch (err) {
      console.warn("[QE] Failed to set up WebSocket servers:", err);
    }

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.setHeader("Content-Type", "application/json");
      res.status(status).json({ message });
      console.error("Unhandled error in request:", err);
    });

    const isDevelopment = process.env.NODE_ENV === "development";
    if (isDevelopment) {
      log("Running in development mode - setting up Vite");
      await setupVite(app, server);
    } else {
      log("Running in production mode - serving static files");
      serveStatic(app);
    }

    const port = parseInt(process.env.PORT || "4000", 10);

    server
      .listen(port, () => {
        log(`serving on port ${port}`);
      })
      .on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.error(`\n❌ Port ${port} is already in use!`);
          console.error(`💡 To fix this:`);
          console.error(`   1. Kill existing processes: taskkill /f /im node.exe`);
          console.error(`   2. Or use a different port: set PORT=5000 && npm run dev`);
          console.error(`   3. Or wait a moment and try again\n`);
        } else {
          console.error("Server error:", err);
        }
        process.exit(1);
      });
  } catch (err) {
    console.error("FATAL: server startup failed:", err);
    process.exit(1);
  }
})();
