// Step 9 verification: full HTTP path through the REAL registered handler
// (requirePolarisAuth -> param validation -> buildAiMetricsResponse) using a
// throwaway test keypair. Swapping POLARIS_JWT_PUBLIC_KEY for Polaris's real key
// completes integration with NO code change.
//
// Run:  npx tsx scripts/verify-e2e.ts
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import { generateKeyPairSync, randomUUID } from "node:crypto";
import express from "express";
import { SignJWT, importPKCS8 } from "jose";

const A = "e2e-a";

async function main() {
  // Configure DevX with a test public key BEFORE importing the auth module.
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  process.env.POLARIS_JWT_PUBLIC_KEY = publicKey;
  delete process.env.POLARIS_JWKS_URI;

  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db");
  await initializeDatabase();
  const pool = getPool();

  // Seed a tiny period (2037-04): 2 rows.
  await pool.query(`DELETE FROM universal_ai_usage_logs WHERE user_id = ?`, [A]);
  for (const [feat, st] of [["bot", "success"], ["artifact", "success"]] as const) {
    await pool.query(
      `INSERT INTO universal_ai_usage_logs
        (id, user_id, provider, model_name, feature_name, use_case, request_status, quality_decision,
         input_tokens, output_tokens, cache_tokens, total_tokens, cost_usd, currency, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'USD', ?)`,
      [randomUUID(), A, "claude", "test", feat, feat, st, "accepted", 10, 5, 0, 15, "0.0001", "2037-04-10 10:00:00"],
    );
  }

  const { registerAiMetricsRoutes } = await import("../server/routes/ai-metrics-routes");
  const app = express();
  app.use(express.json());
  registerAiMetricsRoutes(app);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port;

  const signKey = await importPKCS8(privateKey, "RS256");
  async function token(over: Record<string, any> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: "polaris", aud: "devx-metrics", sub: "polaris-backend", scope: "metrics.read", iat: now, exp: now + 300, ...over })
      .setProtectedHeader({ alg: "RS256", kid: "polaris-key3567", typ: "JWT" })
      .sign(signKey);
  }
  const url = (qs: string) => `http://127.0.0.1:${port}/api/ai-metrics?${qs}`;
  const goodQs = "start_date=2037-04-01&end_date=2037-04-30&period_type=monthly";

  let pass = 0, total = 0;
  const check = (n: string, c: boolean, e = "") => { total++; if (c) pass++; console.log(`${c ? "✓" : "✗"} ${n}${e ? ` — ${e}` : ""}`); };

  // valid → 200 + correct payload
  let resp = await fetch(url(goodQs), { headers: { Authorization: `Bearer ${await token()}` } });
  const body: any = await resp.json();
  check("valid request → 200", resp.status === 200, String(resp.status));
  check("payload total_requests = 2", body?.usage?.total_requests === 2, JSON.stringify(body?.usage));
  check("contract has all top-level keys",
    ["period", "usage", "providers", "tokens", "cost", "reliability", "quality", "use_cases", "adoption", "productivity", "teams", "users", "comparison"]
      .every((k) => k in body));
  check("timezone Asia/Kolkata", body?.period?.timezone === "Asia/Kolkata");

  // missing auth → 401
  resp = await fetch(url(goodQs));
  check("no token → 401", resp.status === 401, String(resp.status));

  // missing scope → 403
  resp = await fetch(url(goodQs), { headers: { Authorization: `Bearer ${await token({ scope: "other" })}` } });
  check("missing scope → 403", resp.status === 403, String(resp.status));

  // bad period_type → 400
  resp = await fetch(url("start_date=2037-04-01&end_date=2037-04-30&period_type=foo"), { headers: { Authorization: `Bearer ${await token()}` } });
  check("bad period_type → 400", resp.status === 400, String(resp.status));

  // bad date → 400
  resp = await fetch(url("start_date=foo&end_date=2037-04-30&period_type=monthly"), { headers: { Authorization: `Bearer ${await token()}` } });
  check("bad date → 400", resp.status === 400, String(resp.status));

  server.close();
  await pool.query(`DELETE FROM universal_ai_usage_logs WHERE user_id = ?`, [A]);
  await pool.end();
  console.log(`\n${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => { console.error("verify-e2e failed:", e); process.exit(1); });
