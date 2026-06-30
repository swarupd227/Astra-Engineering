# ─── NAT 2.0 Remote Execution Agent — Dockerfile ─────────────────────────────
# Runs Playwright tests on behalf of the NAT 2.0 server.
# Connects to the server via WebSocket and executes browser automation.
#
# Usage:
#   docker build -t nat20-agent .
#   docker run -e SERVER_URL=wss://your-app.azurewebsites.net nat20-agent

FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /agent

# Install dependencies
COPY package.json ./
RUN npm install

# Copy agent source
COPY agent.ts tsconfig.json ./

# Install tsx globally for running TypeScript directly
RUN npm install -g tsx

# Default: connect to local server (override with SERVER_URL env var)
ENV SERVER_URL=ws://host.docker.internal:4000/ws/execution-agent
ENV AGENT_ID=docker-agent
ENV AGENT_TOKEN=
ENV AGENT_LABEL=
ENV AGENT_TAGS=
ENV PLAYWRIGHT_IGNORE_HTTPS_ERRORS=false
# TLS cert trust for internal CAs — mount your cert and set this env var
ENV NODE_EXTRA_CA_CERTS=

CMD ["tsx", "agent.ts"]
