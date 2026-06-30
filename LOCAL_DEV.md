# Running Astra Engineering locally (Docker)

A self-contained local stack: **MySQL 8 + Keycloak (local auth) + the app**, using
your **own Anthropic API key** (direct `api.anthropic.com`, no Azure/AWS needed).

> **Why the image is built in CI:** this network blocks the package mirrors a local
> Docker build needs (`apt`/Debian, GitHub release CDNs for native modules like
> `faiss-node`). Container registries *do* work, so we build the image on GitHub's
> runners and **pull** it locally. If you have open egress (or a configured Docker
> Desktop proxy + corporate CA), you can build locally instead — see the last section.

## Prerequisites
- Docker Desktop (Compose v2)
- An Anthropic API key (`sk-ant-...`)
- Access to pull from GHCR (see step 2)

## 1. Build the image (GitHub Actions → GHCR)
The workflow `.github/workflows/build-local-image.yml` builds and publishes
`ghcr.io/swarupd227/astra-engineering:local`.
- It runs automatically on push to `main` (when app code changes), **or**
- run it manually: GitHub repo → **Actions** → **Build local-dev image** → **Run workflow**.

Wait for it to go green (~15–20 min the first time).

## 2. Allow your machine to pull the image
The repo/package is private, so authenticate Docker to GHCR once:
- Create a GitHub **Personal Access Token (classic)** with scope `read:packages`.
- Then:
  ```bash
  echo YOUR_PAT | docker login ghcr.io -u swarupd227 --password-stdin
  ```
- *(Alternatively: GitHub → your profile → Packages → `astra-engineering` → Package
  settings → change visibility to Public — then no login is needed.)*

## 3. Configure
```bash
cp .env.local.example .env.local
# edit .env.local → set ANTHROPIC_API_KEY=sk-ant-...
```

## 4. Run
```bash
docker compose -f docker-compose.local.yml pull
docker compose -f docker-compose.local.yml up
```
On first boot the stack will: start MySQL (wait for healthy) → start Keycloak and
import the `astra` realm → start the app, which runs the DB migrations
(`RUN_DB_MIGRATIONS=true`) and then serves.

## 5. Use
- App: http://localhost:4000
- Log in via Keycloak with the seeded test user — **`dev` / `dev`**
- Keycloak admin console (optional): http://localhost:8080 (`admin` / `admin`)

## One-time host setup for Keycloak login
The frontend redirects the browser to Keycloak at `host.docker.internal:8080`, but Docker
Desktop maps `host.docker.internal` to your LAN IP, which doesn't expose the published port
to the host browser. Point it at localhost instead (run **PowerShell as Administrator**):
```powershell
$h = "$env:windir\System32\drivers\etc\hosts"
(Get-Content $h) -replace '^192\.168\.\d+\.\d+\s+host\.docker\.internal$','127.0.0.1 host.docker.internal' | Set-Content $h
ipconfig /flushdns
```
Then log in at http://localhost:4000 (Keycloak → `dev`/`dev`). If Docker Desktop restarts and
resets the line, re-run it.

## How the Anthropic wiring works
Because `ANTHROPIC_AZURE_ENDPOINT` is **not** set, the LLM client auto-selects
**direct Anthropic mode**: it calls `https://api.anthropic.com/v1/messages` with
`x-api-key` auth. Change the model with `ANTHROPIC_MODEL_NAME` (default `claude-sonnet-4-5`).

## Common operations
```bash
docker compose -f docker-compose.local.yml down       # stop
docker compose -f docker-compose.local.yml down -v     # stop + wipe the database
docker compose -f docker-compose.local.yml logs -f app # tail app logs
```

## Building locally instead (open egress only)
If your machine can reach apt/Debian + GitHub release CDNs (or Docker Desktop is
configured with your corporate proxy + root CA), you can skip CI and build from the
`Dockerfile` directly. Pass the same `VITE_OIDC_*` build args the workflow uses, tag
it `ghcr.io/swarupd227/astra-engineering:local`, and run the compose as above.

## Status
The stack is wired and the CI build is configured, but it has not yet completed a
full green run end-to-end. Expect to iterate on the first build/boot (image build,
migration order, Keycloak/OIDC round-trip). Share any failing logs and we'll fix forward.
