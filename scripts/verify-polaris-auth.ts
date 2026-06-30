// Step 2 verification: exercise requirePolarisAuth end-to-end over HTTP with a
// throwaway RSA test keypair (DevX holds the public key, we sign with the private
// key to simulate Polaris). No DevX app / secrets needed.
//
// Run:  npx tsx scripts/verify-polaris-auth.ts
import { generateKeyPairSync } from "node:crypto";
import express from "express";
import { SignJWT, importPKCS8 } from "jose";

const KID = "polaris-key3567";

async function main() {
  // 1) Test keypair (simulates Polaris). DevX is configured with the public key.
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  process.env.POLARIS_JWT_PUBLIC_KEY = publicKey;
  delete process.env.POLARIS_JWKS_URI;

  // A DIFFERENT key, to forge a bad-signature token.
  const other = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const { requirePolarisAuth } = await import("../server/auth/polaris-auth");
  const signKey = await importPKCS8(privateKey, "RS256");
  const otherKey = await importPKCS8(other.privateKey, "RS256");

  async function mint(
    claims: Record<string, any> = {},
    opts: { kid?: string; key?: any } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: "polaris",
      aud: "devx-metrics",
      sub: "polaris-backend",
      scope: "metrics.read",
      iat: now,
      exp: now + 300,
      ...claims,
    };
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? KID, typ: "JWT" })
      .sign(opts.key ?? signKey);
  }

  // 2) Minimal app with the real middleware + stub handler.
  const app = express();
  app.get("/api/ai-metrics", requirePolarisAuth, (req: any, res) =>
    res.json({ ok: true, sub: req.polaris?.sub }),
  );
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/ai-metrics`;

  const now = Math.floor(Date.now() / 1000);
  type Case = { name: string; expect: number; token?: string; noHeader?: boolean };
  const cases: Case[] = [
    { name: "valid token", expect: 200, token: await mint() },
    { name: "valid token WITH tenant_id (ignored)", expect: 200, token: await mint({ tenant_id: "t-123" }) },
    { name: "no Authorization header", expect: 401, noHeader: true },
    { name: "bad signature (other key)", expect: 401, token: await mint({}, { key: otherKey }) },
    { name: "wrong audience", expect: 401, token: await mint({ aud: "someone-else" }) },
    { name: "wrong issuer", expect: 401, token: await mint({ iss: "evil" }) },
    { name: "wrong subject", expect: 401, token: await mint({ sub: "not-polaris" }) },
    { name: "wrong kid", expect: 401, token: await mint({}, { kid: "wrong-kid" }) },
    { name: "expired", expect: 401, token: await mint({ iat: now - 400, exp: now - 100 }) },
    { name: "lifetime > 300s", expect: 401, token: await mint({ iat: now, exp: now + 400 }) },
    { name: "missing scope (forbidden)", expect: 403, token: await mint({ scope: "something.else" }) },
  ];

  let pass = 0;
  for (const c of cases) {
    const headers: Record<string, string> = {};
    if (!c.noHeader) headers.Authorization = `Bearer ${c.token}`;
    const resp = await fetch(base, { headers });
    const ok = resp.status === c.expect;
    pass += ok ? 1 : 0;
    console.log(`${ok ? "✓" : "✗"} ${c.name}: got ${resp.status}, expected ${c.expect}`);
  }

  server.close();
  console.log(`\n${pass}/${cases.length} cases passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-polaris-auth failed:", e);
  process.exit(1);
});
