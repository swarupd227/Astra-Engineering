/**
 * Token consumption service — consumes tokens from tenant subscriptions.
 * Used when generating BRDs and other AI features.
 *
 * Future-ready: token cost can be replaced with response.usage.total_tokens
 * (real LLM usage) when available.
 */

import { db, poolConnection } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { ResultSetHeader } from "mysql2";
import { ensureTenantSubscription } from "../auth/subscription-bootstrap";

/** Fixed standard costs for LLM operations (replace with response.usage.total_tokens later). */
export const BRD_GENERATION_TOKEN_COST = 250; 
export const BRD_SECTION_REGENERATION_TOKEN_COST = 100;
export const BRD_ENHANCE_FIELD_TOKEN_COST = 50;
export const BRD_ENHANCE_TEXT_TOKEN_COST = 50;
export const ARTIFACT_GENERATION_TOKEN_COST = 500;
export const WORKFLOW_CONVERSATION_TOKEN_COST = 50;
export const WORKFLOW_GENERATE_GUIDELINES_TOKEN_COST = 100;
export const WORKFLOW_DETECT_PATH_TOKEN_COST = 50;
export const WORKFLOW_GENERIC_TOKEN_COST = 200;
export const TEST_PLAN_TOKEN_COST = 300;
export const AI_ENHANCE_DESCRIPTION_TOKEN_COST = 100;
export const AI_ENHANCE_TEXT_TOKEN_COST = 100;
export const AI_GENERATE_MERGED_EPIC_TITLE_TOKEN_COST = 50;
export const AI_SUGGEST_EPIC_MERGES_TOKEN_COST = 100;
export const CODE_GENERATION_TOKEN_COST = 400;
export const DOCUMENTATION_TOKEN_COST = 300;
export const DESIGN_GENERATION_TOKEN_COST = 300;
export const EXTRACT_REQUIREMENTS_TOKEN_COST = 200;
export const BRD_UPLOAD_SUMMARY_TOKEN_COST = 100;

/** Model name for BRD standard cost audit logging. */
export const BRD_STANDARD_COST_MODEL = "BRD_STANDARD_COST";

/** Error code for token quota exceeded. */
export const TOKEN_QUOTA_EXCEEDED_CODE = "TOKEN_QUOTA_EXCEEDED";

export class TokenQuotaExceededError extends Error {
  readonly code = TOKEN_QUOTA_EXCEEDED_CODE;

  constructor(message = "Token quota exceeded for this tenant.") {
    super(message);
    this.name = "TokenQuotaExceededError";
  }
}

export interface ConsumeTokensResult {
  success: true;
  tokensConsumed: number;
  subscriptionId: string;
}

/** Shape of token info returned to the UI. */
export interface TenantTokenInfo {
  tokenQuota: number;
  tokenUsed: number;
  remainingTokens: number;
  tokenCost: number;
  /** True if at least one BRD generation can be performed. */
  canConsume: boolean;
  /** True when balance is low (currently \< 10% of quota but \> 0). */
  lowBalance: boolean;
  /** True when no tokens remain. */
  isDepleted: boolean;
}

/**
 * Core token consumption logic (no auto-creation — used for retries).
 */
async function consumeTenantTokensInner(
  tenantId: string,
  userId: string,
  tokensToConsume: number,
): Promise<ConsumeTokensResult> {
  const conn = await poolConnection.getConnection();
  try {
    await conn.beginTransaction();
    const now = new Date();

    const [rows] = await conn.execute(
      `SELECT id, token_quota, token_used, start_date, expiry_date
       FROM subscriptions
       WHERE tenant_id = ? AND is_active = 1
       LIMIT 1`,
      [tenantId],
    );
    const subRow = (rows as any[])?.[0] as
      | { id: string; token_quota: number; token_used: number; start_date: Date; expiry_date: Date }
      | undefined;

    if (!subRow) {
      await conn.rollback();
      throw new TokenQuotaExceededError("No active subscription found for tenant.");
    }

    const startDate = subRow.start_date instanceof Date ? subRow.start_date : new Date(subRow.start_date);
    const expiryDate = subRow.expiry_date instanceof Date ? subRow.expiry_date : new Date(subRow.expiry_date);

    if (now < startDate) { await conn.rollback(); throw new TokenQuotaExceededError("Subscription has not yet started."); }
    if (now > expiryDate) { await conn.rollback(); throw new TokenQuotaExceededError("Subscription has expired."); }

    const tokenQuota = Number(subRow.token_quota ?? 0);
    const tokenUsed = Number(subRow.token_used ?? 0);
    if (tokenQuota < 0 || tokenUsed < 0) { await conn.rollback(); throw new Error("Invalid subscription token values (negative)."); }

    const [updateRows] = await conn.execute(
      `UPDATE subscriptions SET token_used = token_used + ?
       WHERE tenant_id = ? AND is_active = 1
       AND token_used + ? <= token_quota`,
      [tokensToConsume, tenantId, tokensToConsume],
    );
    if ((updateRows as ResultSetHeader)?.affectedRows === 0) {
      await conn.rollback();
      throw new TokenQuotaExceededError("Token quota exceeded for this tenant.");
    }

    const logId = randomUUID();
    await conn.execute(
      `INSERT INTO token_usage_logs (id, tenant_id, user_id, tokens_consumed, model_name, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [logId, tenantId, userId, tokensToConsume, BRD_STANDARD_COST_MODEL],
    );

    await conn.commit();
    return { success: true, tokensConsumed: tokensToConsume, subscriptionId: subRow.id };
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Consume tokens from the tenant's subscription.
 * Self-healing: if no subscription exists, creates one and retries once.
 *
 * @param tenantId - Tenant ID
 * @param userId - User ID performing the action
 * @param tokensToConsume - Number of tokens to consume (must be > 0)
 * @returns Success result with tokens consumed and subscription ID
 * @throws TokenQuotaExceededError if quota exceeded or no active subscription
 */
export async function consumeTenantTokens(
  tenantId: string,
  userId: string,
  tokensToConsume: number,
): Promise<ConsumeTokensResult> {
  if (!tokensToConsume || tokensToConsume <= 0) {
    throw new Error("tokensToConsume must be a positive number");
  }

  try {
    return await consumeTenantTokensInner(tenantId, userId, tokensToConsume);
  } catch (err) {
    if (err instanceof TokenQuotaExceededError && err.message.includes("No active subscription")) {
      console.log(`[TokenService] No subscription for tenant ${tenantId} — auto-creating and retrying`);
      await ensureTenantSubscription(tenantId);
      return consumeTenantTokensInner(tenantId, userId, tokensToConsume);
    }
    throw err;
  }
}

/**
 * Fail fast if tenant cannot afford `minTokens` without debiting.
 */
export async function assertTenantCanConsume(
  tenantId: string,
  minTokens: number,
): Promise<void> {
  if (!minTokens || minTokens <= 0) return;
  const { tokenQuota, tokenUsed } = await fetchSubscriptionQuota(tenantId);
  if (tokenQuota <= 0 || tokenQuota - tokenUsed < minTokens) {
    throw new TokenQuotaExceededError("Token quota exceeded for this tenant.");
  }
}

/**
 * Prefer measured LLM usage; fall back to fixed estimate when usage is unavailable.
 */
export function resolveTokenDebitFromUsage(
  actualInputPlusOutput: number,
  fallback: number,
): number {
  if (actualInputPlusOutput > 0) {
    return Math.max(Math.ceil(actualInputPlusOutput), 1);
  }
  return fallback;
}

/**
 * Consume tokens for an authenticated request.
 * Use before LLM calls. Caller should catch TokenQuotaExceededError and return 402.
 *
 * @param req - Express request with req.user.id (from auth middleware)
 * @param tokensToConsume - Number of tokens to consume
 * @throws TokenQuotaExceededError if quota exceeded
 * @throws Error if user/tenant context invalid
 */
export async function consumeTokensForRequest(
  req: { user?: { id: string } },
  tokensToConsume: number
): Promise<void> {
  const userId = (req as any).user?.id;
  if (!userId) {
    throw new Error("Authentication required");
  }
  const tenantId = await getTenantIdForUser(userId);
  if (!tenantId) {
    throw new Error("User has no tenant associated.");
  }
  await consumeTenantTokens(tenantId, userId, tokensToConsume);
}

/**
 * Raw subscription lookup — returns quota numbers without self-healing.
 */
async function fetchSubscriptionQuota(tenantId: string): Promise<{ tokenQuota: number; tokenUsed: number }> {
  const [rows] = await poolConnection.execute(
    `SELECT token_quota, token_used, start_date, expiry_date
     FROM subscriptions
     WHERE tenant_id = ? AND is_active = 1
     LIMIT 1`,
    [tenantId],
  );

  const subRow = (rows as any[])?.[0] as
    | { token_quota: number | null; token_used: number | null; start_date: Date | string | null; expiry_date: Date | string | null }
    | undefined;

  if (!subRow) return { tokenQuota: 0, tokenUsed: 0 };

  const now = new Date();
  const startDate = subRow.start_date instanceof Date ? subRow.start_date : subRow.start_date ? new Date(subRow.start_date) : null;
  const expiryDate = subRow.expiry_date instanceof Date ? subRow.expiry_date : subRow.expiry_date ? new Date(subRow.expiry_date) : null;

  const withinWindow = !startDate || !expiryDate ? true : now.getTime() >= startDate.getTime() && now.getTime() <= expiryDate.getTime();

  if (!withinWindow) return { tokenQuota: 0, tokenUsed: 0 };

  return {
    tokenQuota: Math.max(0, Number(subRow.token_quota ?? 0)),
    tokenUsed: Math.max(0, Number(subRow.token_used ?? 0)),
  };
}

/**
 * Build TenantTokenInfo from raw quota numbers.
 */
function buildTokenInfo(
  tokenQuota: number,
  tokenUsed: number,
  operation: "brd_generate" | "workflow_artifacts" | "code_gen",
): TenantTokenInfo {
  const remainingTokens = Math.max(0, tokenQuota - tokenUsed);

  let tokenCost: number;
  switch (operation) {
    case "workflow_artifacts": tokenCost = ARTIFACT_GENERATION_TOKEN_COST; break;
    case "code_gen": tokenCost = CODE_GENERATION_TOKEN_COST; break;
    default: tokenCost = BRD_GENERATION_TOKEN_COST; break;
  }

  return {
    tokenQuota,
    tokenUsed,
    remainingTokens,
    tokenCost,
    canConsume: remainingTokens >= tokenCost,
    lowBalance: tokenQuota > 0 && remainingTokens > 0 && remainingTokens < tokenQuota * 0.1,
    isDepleted: remainingTokens <= 0,
  };
}

/**
 * Get current token information for a tenant.
 * Self-healing: if no subscription found, auto-creates one and retries once.
 */
export async function getTenantTokenInfo(
  tenantId: string,
  operation: "brd_generate" | "workflow_artifacts" | "code_gen" = "brd_generate",
): Promise<TenantTokenInfo> {
  try {
    let { tokenQuota, tokenUsed } = await fetchSubscriptionQuota(tenantId);

    if (tokenQuota === 0 && tokenUsed === 0) {
      // No subscription or zero quota — self-heal
      console.log(`[TokenService] No valid subscription for tenant ${tenantId} — auto-creating`);
      await ensureTenantSubscription(tenantId);
      const retry = await fetchSubscriptionQuota(tenantId);
      tokenQuota = retry.tokenQuota;
      tokenUsed = retry.tokenUsed;
      console.log(`[TokenService] After auto-create: tokenQuota=${tokenQuota}, tokenUsed=${tokenUsed}`);
    }

    return buildTokenInfo(tokenQuota, tokenUsed, operation);
  } catch (err) {
    console.error("[TokenService] Error fetching tenant token info:", err);
    return {
      tokenQuota: 0,
      tokenUsed: 0,
      remainingTokens: 0,
      tokenCost: BRD_GENERATION_TOKEN_COST,
      canConsume: false,
      lowBalance: false,
      isDepleted: true,
    };
  }
}

/**
 * Get tenant ID for the given user (from users.tenant_id).
 * Returns null if user not found or has no tenant.
 */
export async function getTenantIdForUser(userId: string): Promise<string | null> {
  const [user] = await db
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user?.tenantId ?? null;
}
