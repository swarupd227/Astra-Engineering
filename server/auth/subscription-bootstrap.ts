/**
 * Phase 3 — Subscription skeleton (data-only, no enforcement).
 * Self-sufficient: will create the DEFAULT subscription type if missing.
 * Ensures every tenant has one active subscription and a license key row.
 * Does NOT enforce max_users, block login, or gate features.
 */

import { db, poolConnection } from "../db";
import { subscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID, randomBytes } from "crypto";

const MYSQL_ER_DUP_ENTRY = 1062;
const DEFAULT_SUBSCRIPTION_CODE = "DEFAULT";
const DEFAULT_MAX_USERS = 50;
const DEFAULT_TOKEN_QUOTA = 1_000_000_000;

let defaultSubscriptionTypeId: string | null | undefined = undefined;

/**
 * Get or create the DEFAULT subscription type.
 * Self-heals: if no DEFAULT type exists, creates one inline.
 */
export async function ensureDefaultSubscriptionType(): Promise<string | null> {
  if (defaultSubscriptionTypeId !== undefined && defaultSubscriptionTypeId !== null) {
    return defaultSubscriptionTypeId;
  }

  // Use raw SQL — resilient to Drizzle/schema mismatches on the subscription_types table
  try {
    const [rows]: any = await poolConnection.query(
      `SELECT id FROM subscription_types WHERE code = ? LIMIT 1`,
      [DEFAULT_SUBSCRIPTION_CODE]
    );
    if (rows?.[0]?.id != null) {
      defaultSubscriptionTypeId = String(rows[0].id);
      return defaultSubscriptionTypeId;
    }
  } catch (e: any) {
    console.warn("[SubscriptionBootstrap] Raw lookup failed:", e?.message);
  }

  // Self-heal: create the DEFAULT type now
  try {
    console.log("[SubscriptionBootstrap] DEFAULT subscription type missing — creating it now");
    await poolConnection.query(
      `INSERT IGNORE INTO subscription_types (code, name, description, is_active)
       VALUES ('DEFAULT', 'Default Subscription', 'Initial subscription with all features enabled', 1)`
    );
    const [refetch]: any = await poolConnection.query(
      `SELECT id FROM subscription_types WHERE code = ? LIMIT 1`,
      [DEFAULT_SUBSCRIPTION_CODE]
    );
    if (refetch?.[0]?.id != null) {
      defaultSubscriptionTypeId = String(refetch[0].id);
      console.log(`[SubscriptionBootstrap] Created DEFAULT subscription type with id=${defaultSubscriptionTypeId}`);
      return defaultSubscriptionTypeId;
    }
  } catch (e: any) {
    console.warn("[SubscriptionBootstrap] Failed to self-create DEFAULT subscription type:", e?.message);
  }

  // Last-resort fallback so we never return null
  defaultSubscriptionTypeId = "0";
  console.warn("[SubscriptionBootstrap] Using placeholder subscription_type_id='0'");
  return defaultSubscriptionTypeId;
}

/**
 * Ensure an active subscription exists for the tenant (and a license key).
 * Idempotent: safe to run on every tenant resolve; no duplicate rows.
 * Self-sufficient: never silently returns without ensuring a subscription exists.
 */
export async function ensureTenantSubscription(tenantId: string): Promise<void> {
  const existingSubs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, tenantId),
        eq(subscriptions.isActive, true)
      )
    )
    .limit(1);

  if (existingSubs[0]) {
    const sub = existingSubs[0] as any;
    const quota = Number(sub.tokenQuota ?? sub.token_quota ?? 0);
    if (quota === 0) {
      await db
        .update(subscriptions)
        .set({ tokenQuota: DEFAULT_TOKEN_QUOTA })
        .where(eq(subscriptions.id, sub.id));
      console.log(`[SubscriptionBootstrap] Fixed zero-quota subscription for tenant ${tenantId}`);
    }
    await ensureLicenseKeyForTenant(tenantId);
    return;
  }

  // No subscription exists — create one
  const subscriptionTypeId = await ensureDefaultSubscriptionType() ?? "0";

  const now = new Date();
  const expiry = new Date(now);
  expiry.setFullYear(expiry.getFullYear() + 1);

  try {
    await db.insert(subscriptions).values({
      id: randomUUID(),
      tenantId,
      subscriptionTypeId,
      maxUsers: DEFAULT_MAX_USERS,
      tokenQuota: DEFAULT_TOKEN_QUOTA,
      tokenUsed: 0,
      startDate: now,
      expiryDate: expiry,
      isActive: true,
    });
    console.log(`[SubscriptionBootstrap] Created subscription for tenant ${tenantId} (quota=${DEFAULT_TOKEN_QUOTA.toLocaleString()})`);
  } catch (err: any) {
    if (err?.errno === MYSQL_ER_DUP_ENTRY || err?.code === "ER_DUP_ENTRY") {
      console.log(`[SubscriptionBootstrap] Subscription already exists for tenant ${tenantId} (race condition)`);
      await ensureLicenseKeyForTenant(tenantId);
      return;
    }
    throw err;
  }

  await ensureLicenseKeyForTenant(tenantId);
}

/**
 * Ensure a license_keys row exists for the tenant (placeholder values).
 * Not validated anywhere; for visibility and future use only.
 * Uses raw SQL for resilience against schema mismatches.
 */
async function ensureLicenseKeyForTenant(tenantId: string): Promise<void> {
  try {
    const [rows]: any = await poolConnection.query(
      `SELECT tenant_id FROM license_keys WHERE tenant_id = ? LIMIT 1`,
      [tenantId]
    );
    if (rows?.length > 0) return;

    const id = randomUUID();
    const licenseHash = randomBytes(32).toString("hex");
    const salt = randomBytes(16).toString("hex");
    const integrityHash = randomBytes(32).toString("hex");

    await poolConnection.query(
      `INSERT IGNORE INTO license_keys (id, tenant_id, license_hash, salt, integrity_hash, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [id, tenantId, licenseHash, salt, integrityHash]
    );
  } catch (err: any) {
    // Best-effort — license_keys is not critical for functionality
    console.warn("[SubscriptionBootstrap] license_keys insert skipped:", err?.message);
  }
}
