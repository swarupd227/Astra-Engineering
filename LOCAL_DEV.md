# Running Astra Engineering locally (Docker)

A self-contained local stack: **MySQL 8 + Keycloak (local auth) + the app**, using
your **own Anthropic API key** (direct `api.anthropic.com`, no Azure/AWS needed).

## Prerequisites
- Docker Desktop (with Docker Compose v2)
- An Anthropic API key (`sk-ant-...`)

## 1. Configure
```bash
cp .env.local.example .env.local
# edit .env.local → set ANTHROPIC_API_KEY=sk-ant-...
```
The default `.env.local` already points the app at the bundled MySQL and Keycloak
containers. Everything else has sensible local defaults (do not reuse these
passwords anywhere real).

## 2. Run
```bash
docker compose -f docker-compose.local.yml up --build
```
First boot will:
1. Start MySQL and wait until it's healthy.
2. Start Keycloak and auto-import the `astra` realm (`keycloak/astra-realm.json`),
   which creates the `astra-local` OIDC client and a test user.
3. Build the app image, run the DB migrations (`RUN_DB_MIGRATIONS=true`), then start.

> The app image is large (bundles Playwright/Puppeteer/Chromium), so the first
> `--build` can take several minutes.

## 3. Use
- App: http://localhost:4000
- Log in via Keycloak with the seeded test user:
  - **username:** `dev`  **password:** `dev`
- Keycloak admin console (optional): http://localhost:8080 (`admin` / `admin`)

## How the Anthropic wiring works
Because `ANTHROPIC_AZURE_ENDPOINT` is **not** set in `.env.local`, the LLM client
auto-selects **direct Anthropic mode**: it calls `https://api.anthropic.com/v1/messages`
with `x-api-key` auth. Set `ANTHROPIC_AZURE_ENDPOINT` if you ever want the
Azure-hosted Anthropic path instead.

Change the model with `ANTHROPIC_MODEL_NAME` (default `claude-sonnet-4-5`).

## Common operations
```bash
# Stop
docker compose -f docker-compose.local.yml down

# Reset the database (wipes local data)
docker compose -f docker-compose.local.yml down -v

# Tail app logs
docker compose -f docker-compose.local.yml logs -f app
```

## Troubleshooting
- **App exits during migrations:** check `logs app`. Ensure MySQL is healthy and
  `MYSQL_*` in `.env.local` match the compose service.
- **Login redirect fails:** confirm `VITE_OIDC_REDIRECT_URI` is `http://localhost:4000/`
  and the Keycloak realm imported (check `logs keycloak` for "Imported realm astra").
- **LLM calls fail with 401:** verify `ANTHROPIC_API_KEY` is a valid direct key and
  that no stale `ANTHROPIC_AZURE_ENDPOINT` is set in your environment.

> **Status:** this local stack is newly scaffolded and not yet run end-to-end in CI.
> Expect to iterate on the first `up` (image build, migration order, Keycloak realm).
> Report any failure logs and we'll fix forward.
