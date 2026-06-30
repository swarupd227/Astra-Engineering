/**
 * Request-scoped AI attribution context (AsyncLocalStorage).
 *
 * The central Bedrock hook (`recordAiUsage`) reads this store to tag each
 * universal_ai_usage_logs row with who/what triggered the AI call, without
 * threading params through dozens of call sites.
 *
 * - `aiContextMiddleware` seeds { userId, tenantId } from req.user for every
 *   authenticated /api request (registered after autoBootstrapUser).
 * - Surface code calls `withAiContext({ feature, useCase, projectId }, fn)` (or
 *   `setAiContext(...)`) to refine attribution before its LLM call.
 * - `skipLogging: true` (code-generation) makes the recorder skip the insert.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
import { or, eq } from "drizzle-orm";

export interface AiContext {
  userId?: string;       // = users.id
  tenantId?: string;     // = users.tenantId (stored, not filtered)
  projectId?: string;
  sessionId?: string;
  correlationId?: string;
  feature?: string;      // feature_name (brd | workflow | design | specs | ai_enhance | embedding | ...)
  useCase?: string;
  skipLogging?: boolean; // when true, recordAiUsage does nothing (e.g. code generation)
}

const als = new AsyncLocalStorage<AiContext>();

export function getAiContext(): AiContext | undefined {
  return als.getStore();
}

/**
 * Run `fn` with the given context merged onto any existing store. Use to scope a
 * feature/use-case around an LLM call (sync or async).
 */
export function withAiContext<T>(ctx: AiContext, fn: () => T): T {
  const merged: AiContext = { ...als.getStore(), ...ctx };
  return als.run(merged, fn);
}

/**
 * Patch the current store in place (no new scope). No-op if there is no active
 * store (e.g. background work that never entered withAiContext).
 */
export function setAiContext(patch: AiContext): void {
  const store = als.getStore();
  if (store) Object.assign(store, patch);
}

// ── Generic project capture ────────────────────────────────────────────────
// Pull a project identifier from the request (body → query → URL path) and
// resolve it to our sdlc_projects.id, so EVERY route that carries a project tags
// its AI usage project-wise without per-route wiring. Cached to keep it cheap.
const _projCache = new Map<string, { id: string | null; exp: number }>();
const PROJ_TTL_MS = 5 * 60 * 1000;

function extractProjectRef(req: Request): string | undefined {
  const b = (req as any).body?.projectId;
  if (typeof b === "string" && b.trim()) return b.trim();
  const q = (req as any).query?.projectId;
  if (typeof q === "string" && q.trim()) return q.trim();
  const m = /\/projects\/([^/?]+)/.exec(req.path || "");
  if (m && m[1] && m[1] !== "undefined" && m[1] !== "null") return decodeURIComponent(m[1]);
  return undefined;
}

export async function resolveSdlcProjectId(raw: string): Promise<string | null> {
  const cached = _projCache.get(raw);
  if (cached && Date.now() < cached.exp) return cached.id;
  let id: string | null = null;
  try {
    const { db } = await import("../db");
    const { sdlcProjects } = await import("@shared/schema");
    const rows = await db
      .select({ id: sdlcProjects.id })
      .from(sdlcProjects)
      .where(or(eq(sdlcProjects.id, raw), eq(sdlcProjects.projectId, raw), eq(sdlcProjects.jiraProjectKey, raw)))
      .limit(1);
    id = rows[0]?.id ?? null;
  } catch {
    id = null;
  }
  _projCache.set(raw, { id, exp: Date.now() + PROJ_TTL_MS });
  if (_projCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of _projCache) if (now >= v.exp) _projCache.delete(k);
  }
  return id;
}

/**
 * Express middleware: open an AI context for the request seeded from req.user and
 * the request's project (resolved to sdlc_projects.id). Register AFTER
 * autoBootstrapUser (and the body parser) so req.user and req.body are populated.
 */
export async function aiContextMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  let ctx: AiContext = {};
  try {
    const user = (req as any).user;
    const raw = extractProjectRef(req);
    const projectId = raw ? (await resolveSdlcProjectId(raw)) ?? undefined : undefined;
    ctx = { userId: user?.id, tenantId: user?.tenantId, projectId };
  } catch {
    /* fall through with empty ctx */
  }
  als.run(ctx, () => next());
}
