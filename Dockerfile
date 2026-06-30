FROM node:20-bookworm-slim AS base

WORKDIR /app

ARG GITLEAKS_VERSION=8.30.1

ENV PORT=8080 \
    NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    NPM_CONFIG_CACHE=/tmp/.npm

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dumb-init \
    git \
    gnupg \
    gzip \
    openssh-client \
    pipx \
    python3 \
    python3-venv \
    tar \
    wget \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgomp1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

RUN PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install semgrep \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in amd64) GITLEAKS_ARCH="x64" ;; arm64) GITLEAKS_ARCH="arm64" ;; *) echo "Unsupported architecture: $ARCH" && exit 1 ;; esac \
  && curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${GITLEAKS_ARCH}.tar.gz" -o /tmp/gitleaks.tar.gz \
  && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
  && chmod +x /usr/local/bin/gitleaks \
  && wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor -o /usr/share/keyrings/trivy.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" > /etc/apt/sources.list.d/trivy.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends trivy \
  && semgrep --version \
  && gitleaks version \
  && trivy --version \
  && rm -rf /var/lib/apt/lists/* /tmp/gitleaks.tar.gz

FROM base AS build

ARG VITE_DEVX_HOSTING=
ARG VITE_AUTH_MODE=
# Azure AD / MSAL (required when VITE_AUTH_MODE=msal)
ARG VITE_AZURE_AD_CLIENT_ID=
ARG VITE_AZURE_AD_TENANT_ID=
# Cognito / Amplify (only needed when VITE_AUTH_MODE=amplify)
ARG VITE_COGNITO_USER_POOL_ID=
ARG VITE_COGNITO_APP_CLIENT_ID=
ARG VITE_COGNITO_REGION=
ARG VITE_COGNITO_DOMAIN=
ARG VITE_FEATURE_SDLC=true
ARG VITE_FEATURE_QUICK_WORKFLOW=false
ARG VITE_FEATURE_STACK_MODERNIZATION=false
ARG NODE_OPTIONS=--max-old-space-size=6144

ENV NODE_ENV=development \
    NODE_OPTIONS=$NODE_OPTIONS \
    HUSKY=0 \
    VITE_DEVX_HOSTING=$VITE_DEVX_HOSTING \
    VITE_AUTH_MODE=$VITE_AUTH_MODE \
    VITE_AZURE_AD_CLIENT_ID=$VITE_AZURE_AD_CLIENT_ID \
    VITE_AZURE_AD_TENANT_ID=$VITE_AZURE_AD_TENANT_ID \
    VITE_COGNITO_USER_POOL_ID=$VITE_COGNITO_USER_POOL_ID \
    VITE_COGNITO_APP_CLIENT_ID=$VITE_COGNITO_APP_CLIENT_ID \
    VITE_COGNITO_REGION=$VITE_COGNITO_REGION \
    VITE_COGNITO_DOMAIN=$VITE_COGNITO_DOMAIN \
    VITE_FEATURE_SDLC=$VITE_FEATURE_SDLC \
    VITE_FEATURE_QUICK_WORKFLOW=$VITE_FEATURE_QUICK_WORKFLOW \
    VITE_FEATURE_STACK_MODERNIZATION=$VITE_FEATURE_STACK_MODERNIZATION

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN mkdir -p /app/.cache/puppeteer
RUN npm ci --include=optional

COPY . .
RUN npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

FROM base AS runtime

# Pin HOME and the Playwright browser cache to a single location. The server's
# browser detector (resolveSystemChrome in server/qe/playwright-setup.ts) looks
# under $HOME/.cache/ms-playwright, and Playwright itself honours
# PLAYWRIGHT_BROWSERS_PATH at launch — keeping both equal guarantees the baked
# Chromium is both detected (readiness banner) and launchable (test execution).
ENV HOME=/home/node \
    PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/.cache ./cache-placeholder
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/scripts/migration-lib.js ./scripts/migration-lib.js
COPY --from=build --chown=node:node /app/scripts/run-container-migrations.js ./scripts/run-container-migrations.js
COPY --from=build --chown=node:node /app/scripts/run-migration-improved.js ./scripts/run-migration-improved.js
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /app/.cache \
  && if [ -d /app/cache-placeholder/puppeteer ]; then mv /app/cache-placeholder/puppeteer /app/.cache/puppeteer; fi \
  && rm -rf /app/cache-placeholder \
  && chmod +x /app/docker-entrypoint.sh \
  && chown -R node:node /app

USER node

# Bake the Chromium browser binary into the image. The OS libraries Chromium
# needs are already installed in the base stage, so only the browser download is
# required here (no --with-deps / root needed). Running as the `node` user with
# PLAYWRIGHT_BROWSERS_PATH set lands it in /home/node/.cache/ms-playwright, where
# the app detects it at startup — so "Playwright Not Ready" never appears on EKS.
RUN node /app/node_modules/playwright/cli.js install chromium

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]
CMD ["npm", "start"]
