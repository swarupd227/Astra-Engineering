# Polaris AI‑Metrics Integration — Implementation & Integration Guide

> External system **Polaris** pulls DevX AI‑usage metrics from
> `GET /api/ai-metrics`, authenticated with a machine‑to‑machine RS256 JWT that
> Polaris signs. DevX captures every Bedrock (Claude) AI call, attributes it to a
> user / project / team, computes token + cost + quality, and serves it in a
> fixed JSON contract.

---

## 1. Overview

- **Endpoint:** `GET /api/ai-metrics` (Polaris‑facing) + internal admin endpoints.
- **Auth:** Polaris signs an RS256 JWT with its **private key**; DevX verifies with the matching **public key** (DevX is verifier‑only).
- **Source of truth:** a single table `universal_ai_usage_logs` — one row per AI call.
- **Hosting target:** AWS (`DEVX_HOSTING=aws`) → Bedrock (Claude) LLM, Cognito (Amplify) auth, JIRA work‑items. MSAL/Azure paths are out of scope.
- **No tenant scoping** in the API (a `tenant_id` is stored for future use but never filtered on).

---

## 2. Architecture

```
Polaris ──RS256 JWT──▶ requirePolarisAuth ──▶ GET /api/ai-metrics ──▶ ai-metrics-service
   (verify only)                                                          │ aggregates (NO tenant filter)
                                                                          ▼
                            ┌─────────────  universal_ai_usage_logs  ◀── ONE row per AI call,
                            │               (source of truth)            written by the central hook in
                            │                                            BedrockLLMClient.createCompletion
                            ▼                                            + AsyncLocalStorage request context
              jira_team_members / jira_user_overrides        productivity_targets
                            │
                       users (existing, Cognito-bootstrapped)
```

**Capture path:** Every chat/generation + embedding call funnels through the single
`BedrockLLMClient` in `server/platform/llm/bedrock-impl.ts`. A `recordAiUsage()`
hook there writes one `universal_ai_usage_logs` row per call. Attribution
(user/project/feature/use_case) comes from an **AsyncLocalStorage** request
context seeded by middleware and refined per surface.

---

## 3. What was implemented (by step)

| Step | Area | Summary |
|---|---|---|
| 1 | **DB schema** | 4 additive tables (below); idempotent `ensure…Table()` at startup |
| 2 | **Polaris JWT auth** | `requirePolarisAuth` (RS256 verify, claim checks, env‑configurable lifetime) |
| 3 | **Capture pipeline** | `ai-context` (ALS), `ai-pricing` (Bedrock price map), `ai-usage-recorder` (cache resolution + cost + insert), hook in `bedrock-impl` (generation success/failure + embedding) |
| 4 | **Per‑surface attribution** | `feature_name` = screen/module, `use_case` = action; code‑generation **excluded** |
| 5 | **Quality capture** | `accepted/modified/rejected/unrated`, marked on save/approve/apply |
| 6 | **JIRA team sync + mapping** | tiered resolver: manual → credential → propagated → email → display_name → unmatched |
| 7 | **Productivity targets** | `target_saved_hours` per period |
| 8 | **Endpoint + aggregation** | `buildAiMetricsResponse`, full contract, project‑wise team/user attribution |
| 9 | **Polaris integration** | end‑to‑end with the real public key (env) |

**Iterative refinements added during the session**
- **Project‑wise attribution** — teams/users aggregate usage by the **project the work was generated for** (`project_id`), not by membership → no double‑counting across a user's projects.
- **Generic project capture** — middleware resolves a project from `body.projectId` → `query.projectId` → `/projects/<id>/` path → `sdlc_projects.id`, so every route tags usage project‑wise.
- **Rich `users[]`** — per‑user tokens, cost, reliability, providers[], name/email, dates.
- **Global `users[]`** — when no JIRA project is passed, `users[]` lists all active users (`team_id = null`).
- **JIRA auto‑sync** on add‑instance / add‑project; **lazy re‑sync** (TTL) on the metrics call; **every‑login claim** (throttled) to map users who existed before a sync.
- **Propagation tier** — a JIRA account matched in one project is inherited across all its projects (handles JIRA hiding email inconsistently per project).
- **24‑hour test token** support (env‑gated lifetime) for local testing.

---

## 4. Database schema (4 new tables)

Additive only — no existing tables altered. Idempotent. Full DDL:
`migrations/polaris-ai-metrics.sql` (also auto‑created at startup by
`ensurePolarisMetricsTables()` in `server/db.ts`).

| Table | Purpose | Populated by |
|---|---|---|
| **`universal_ai_usage_logs`** | source of truth; one row per AI call | central Bedrock hook (automatic) |
| **`jira_team_members`** | JIRA accountId → `users.id` per project | JIRA sync (`/api/internal/jira-team-sync`, auto, lazy) |
| **`jira_user_overrides`** | sticky manual JIRA→user links (survive re‑sync) | `/api/internal/jira-user-map` |
| **`productivity_targets`** | `target_saved_hours` per period | `/api/internal/productivity-target` |

Key columns of `universal_ai_usage_logs`: `user_id` (= `users.id`), `tenant_id`
(stored, unused), `project_id` (= `sdlc_projects.id`), `provider`, `model_name`,
`feature_name`, `use_case`, `request_status`, `quality_decision`,
`input/output/cache/total_tokens`, `cost_usd`, `correlation_id`, `created_at`.

---

## 5. Identity model — which `user_id` is logged

On AWS, login is **Cognito**: JWT `sub` → `autoBootstrapUser`/`bootstrapUser` →
a row in **`users`** (`provider='cognito'`, `azureOid = sub`, `tenantId = pool id`,
`email`). The exposed `req.user.id` = **`users.id`**, and that is what we write to
`universal_ai_usage_logs.user_id`. (Consistent with `artifact_events`,
`user_jira_credentials`, and `user_roles`.) `msal_users` is not used.

---

## 6. Attribution model

- **`feature_name`** = the screen/module: `brd`, `backlog_workflow` (workflow:
  artifacts/bug‑detection/conversation), `bot` (Super‑Agent chat), `design`,
  `wiki`, `specs`, `ai_enhance`, `stack_modernization`, `embedding`,
  `code_generation` (skipped — not logged).
- **`use_case`** = the action; drives the Polaris `use_cases` buckets:
  - contains `bot quer` → `bot_query_count`
  - contains `bug detection` → `bug_detection_count`
  - `test plan` / `documentation` / `wiki` / `brd` / `design` → `documentation_generation_count`
  - `artifact` / `test case` / `specs` / `stack modernization` → `artifact_generation_count`
  - `code_accepted_count` → 0 (code‑gen not logged)
- **`project_id`** = `sdlc_projects.id`, resolved from the request (body/query/path)
  or per‑surface; team/user metrics are aggregated by it (project‑wise).
- **Code generation is intentionally excluded** (via `skipLogging`).
- **Stack‑modernization** has no project association (analysis/codebase based) →
  stays in global totals with `project_id = NULL`.

---

## 7. Quality capture

Each row starts `unrated`. It flips on the business event:
- **BRD** → on **approval** (`/api/dev-brd/:id/status` = `approved`), linked by `correlation_id = brdId` (so the right row is marked even if a different reviewer approves).
- **Artifact** → on **save** (`/api/workflow/save-artifacts`).
- **Specs** → on **push** (`/api/sdlc/projects/:id/specs/push`).
- **Design** → on **save** (`/api/workflow/design-prompt/save`).
- **AI‑enhance / generic** → UI calls `POST /api/ai-quality { decision, correlation_id?, feature? }`.

`quality_score = (accepted + 0.5·modified) / total_outputs × 100`.

---

## 8. JIRA team sync & user mapping

**Tiered resolver** (first match wins): `manual` (override) → `credential`
(user’s connected PAT accountId) → `propagated` (same accountId matched in another
project) → `email` (JIRA email == DevX email) → `display_name` → `unmatched`.

**Triggers:**
- **Add instance/project** → auto‑sync (`/api/jira/connections`, `/api/jira/settings`, `/api/jira/create-project`).
- **Metrics call** with `jira_instance`+`jira_project` → **lazy re‑sync** if stale (TTL `POLARIS_JIRA_SYNC_TTL_MS`, default 10 min).
- **User login** → throttled **claim** of unmatched memberships (≈ once/10 min/user).
- **Manual:** `POST /api/internal/jira-team-sync`, `/api/internal/jira-sync-all`, `/api/internal/jira-user-map`.

**Notes:** JIRA hides email by default (privacy), so `email` matching is unreliable
— the **credential (PAT)** path is the dependable one, and **propagation** spreads
a single match across all of a user’s projects. Re‑syncs are idempotent (unique
key `instance_url(191)+project_key+jira_account_id`) — no duplicates.

---

## 9. Cost / pricing (static map)

`server/observability/ai-pricing.ts`, USD per 1,000,000 tokens:

| Model | input/M | cached‑input/M | output/M |
|---|---|---|---|
| Claude Opus 4.x / 3 (default) | 15 | 1.50 | 75 |
| Claude Sonnet 4.x / 3.7 / 3.5 | 3 | 0.30 | 15 |
| Claude 3.5 Haiku | 0.80 | 0.08 | 4 |
| Claude 3 Haiku | 0.25 | 0.03 | 1.25 |
| Titan Text Embeddings v2 | 0.02 | 0 | 0 |

`cost_usd = (input·inputPerM + cache·cachedPerM + output·outputPerM) / 1e6` (6 dp).

---

## 10. Response contract (high level)

`period, usage, providers[], tokens, cost, reliability, quality, use_cases,
adoption, productivity, teams[], users[], comparison`.

- **Top‑level** (usage/tokens/cost/reliability/quality/use_cases/adoption) = global over the period.
- **`teams[]` / `users[]`** = scoped to `jira_instance`+`jira_project` (project‑wise). Without those params, `teams=[]` and `users[]` = all active users with `team_id=null`.
- `current_week_requests` / `previous_week_requests` / `weekly_ai_uses` = real “this week” (Mon→today) snapshots.
- `comparison.previous_*` = the prior comparable period (previous calendar month for `monthly`).
- Claude‑only: `chatgpt_requests` / `custom_tool_requests` = `0`; `claude_requests` = total.

**Request:**
```
GET /api/ai-metrics?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&period_type=monthly
    [&jira_instance=https://<org>.atlassian.net&jira_project=<KEY or Name>]
```

---

## 11. Polaris JWT — payload format & key setup  ⭐

DevX is the **verifier only**. Flow:
1. Polaris **stores the private key**; DevX stores the matching **public key**.
2. Polaris builds the JWT, **signs it with the private key (RS256)** on its backend.
3. Polaris calls DevX with `Authorization: Bearer <jwt>`.
4. DevX verifies the signature with the public key and validates the claims.

### Required JWT header
```json
{
  "alg": "RS256",
  "kid": "polaris-key3567",
  "typ": "JWT"
}
```

### Required JWT payload (claims)
```json
{
  "iss": "polaris",
  "aud": "devx-metrics",
  "sub": "polaris-backend",
  "scope": "metrics.read",
  "iat": 1717600000,
  "exp": 1717600300,
  "jti": "optional-unique-id"
}
```

| Claim | Required | Value / rule |
|---|---|---|
| `iss` | yes | exactly `polaris` |
| `aud` | yes | exactly `devx-metrics` |
| `sub` | yes | exactly `polaris-backend` |
| `scope` | yes | must include `metrics.read` (space‑separated list allowed) |
| `iat` | yes | issued‑at, Unix seconds |
| `exp` | yes | expiry, Unix seconds; **`exp − iat ≤ 300`** (5 min, the spec) |
| `jti` | optional | unique id (recommended) |
| header `alg` | yes | `RS256` (only RS256 accepted) |
| header `kid` | yes | `polaris-key3567` (matches the configured public key) |

Rejections: missing/invalid signature, wrong `iss`/`aud`/`sub`, missing
`metrics.read` scope, expired, or `exp − iat` over the max → **401** (insufficient
scope → **403**). `tenant_id` is **not** required and is ignored if present.

### Key pair setup
- **Algorithm:** RSA, RS256 (2048‑bit+). 
  ```bash
  # Polaris generates the pair (example)
  openssl genrsa -out polaris-private.pem 2048
  openssl rsa -in polaris-private.pem -pubout -out polaris-public.pem
  ```
- **Polaris** keeps `polaris-private.pem` (never shared) and signs tokens with it, header `kid=polaris-key3567`.
- **DevX** is configured with the **public key** via env (one of):
  - `POLARIS_JWT_PUBLIC_KEY` = the SPKI PEM (`-----BEGIN PUBLIC KEY----- … -----END PUBLIC KEY-----`; in `.env`, newlines may be `\n`‑escaped), **or**
  - `POLARIS_JWKS_URI` = a JWKS endpoint publishing the key under `kid=polaris-key3567`.
- **Lifetime:** `POLARIS_MAX_TOKEN_LIFETIME_SEC` controls the max accepted lifetime; **default 300** (keep this in prod). For local long‑lived test tokens it can be raised (e.g., 86400).

### Example call
```bash
curl -s -H "Authorization: Bearer <JWT>" -H "Accept: application/json" \
  "https://<devx-host>/api/ai-metrics?start_date=2026-06-01&end_date=2026-06-30&period_type=monthly"
```

---

## 12. Configuration (env / AWS Secrets Manager)

Add to the deployment secret (`devx/platform/qa` for QA):
- `POLARIS_JWT_PUBLIC_KEY` (PEM) **or** `POLARIS_JWKS_URI` — required for the endpoint to authenticate Polaris.
- `POLARIS_MAX_TOKEN_LIFETIME_SEC` — leave **unset/300** in prod.
- `POLARIS_JIRA_SYNC_TTL_MS` — optional, default 600000 (10 min) for lazy re‑sync.

Existing config used: `DEVX_HOSTING=aws`, Bedrock (`BEDROCK_MODEL_ID`, region),
MySQL creds (Secrets Manager). DB: tables auto‑create at startup, or apply
`migrations/polaris-ai-metrics.sql`.

---

## 13. Internal admin endpoints (require normal user auth)

| Endpoint | Purpose |
|---|---|
| `POST /api/internal/jira-team-sync` `{ jira_instance, jira_project }` | sync one project’s members |
| `POST /api/internal/jira-sync-all` `{ jira_instance? }` | sync all projects (org onboarding) |
| `POST /api/internal/jira-user-map` `{ jira_instance, jira_account_id, user_id }` | sticky manual mapping |
| `POST /api/internal/productivity-target` `{ period_type, period_start, period_end, target_saved_hours }` | set saved‑hours target |
| `POST /api/ai-quality` `{ decision, correlation_id?, feature? }` | mark accepted/modified/rejected from the UI |

---

## 14. Files

**Created:** `server/auth/polaris-auth.ts`,
`server/observability/{ai-context,ai-pricing,ai-usage-recorder,quality,productivity}.ts`,
`server/services/ai-metrics-service.ts`,
`server/routes/{ai-metrics-routes,metrics-contract}.ts`,
`server/integrations/jira/team-sync-service.ts`,
`migrations/polaris-ai-metrics.sql`, and `scripts/verify-*.ts` / `scripts/gen-polaris-token.ts`.

**Modified:** `shared/schema.ts`, `server/db.ts`,
`server/platform/llm/bedrock-impl.ts`, `server/routes.ts`,
`server/auth/middleware.ts`, `server/auth/user-bootstrap.ts`,
`server/metrics-helper.ts`, `server/code-generation-service.ts`,
`server/brd-ai-service.ts`, `server/wiki-generators.ts`,
`server/wiki-generators-design.ts`, `server/services/specs-generator/llm-caller.ts`,
`server/routes/ai-enhance.ts`, `server/routes/specs.ts`, `server/brd-status-routes.ts`,
`server/jira-routes.ts`, `server/integrations/jira/jira-routes-handler.ts` (n/a),
`scripts/generate-runtime-package.cjs` (build fix), `.env.example`.

---

## 15. Verification

Helper scripts (run with `npx tsx scripts/<name>`):
`verify-polaris-tables`, `verify-polaris-auth`, `verify-ai-capture`,
`verify-attribution`, `verify-quality`, `verify-jira-mapping`,
`verify-productivity`, `verify-endpoint`, `verify-projectwise`, `verify-e2e`,
`verify-lazy-sync`, `verify-edge-mapping`. Plus `watch-ai-usage`,
`whoami-mapping`, `smoke-capture`, `call-internal-endpoints`, `gen-polaris-token`.

---

## 16. Known limitations

- Usage rows generated **before** project‑tagging have `project_id = NULL` (global only; can’t be backfilled — no project/correlation link).
- A surface attributes project‑wise only if its request **carries a project** (body/query/`/projects/<id>/`, or BRD with `projectId`/`brdId`).
- **Stack‑modernization** has no project → global only.
- JIRA email is often hidden → rely on **PAT (credential)** + **propagation** for mapping.
- `target_saved_hours` is admin‑set per period (returns 0 if no row for the exact period).
- Local long‑lived (24h) tokens require `POLARIS_MAX_TOKEN_LIFETIME_SEC` raised and a **server restart** (env read at startup).
