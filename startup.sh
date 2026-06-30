#!/bin/bash
# Azure App Service startup script
# node_modules are already included in the deployment package from the build stage

cd /home/site/wwwroot

export DEBIAN_FRONTEND=noninteractive

# Single apt-get update for all system package installations
echo "[startup] Updating package lists..."
apt-get update -y

# Ensure git is available (required for cross-org git --mirror on App Service)
echo "[startup] Checking for git installation..."
if ! command -v git >/dev/null 2>&1; then
    echo "[startup] git not found. Installing git..."
    apt-get install -y git
else
    echo "[startup] git is already installed."
fi

# Install Chromium/Puppeteer system dependencies (@sparticuz/chromium binary needs these)
echo "[startup] Installing Chromium system dependencies..."
apt-get install -y --no-install-recommends \
  libnspr4 \
  libnss3 \
  libnss3-tools \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libpango-1.0-0 \
  libasound2 \
  libxshmfence1 \
  fonts-liberation \
  && echo "[startup] Chromium dependencies installed." \
  || echo "[startup] WARNING: Could not install some Chromium dependencies."

# Refresh the dynamic linker cache so /tmp/chromium can find the shared libraries
ldconfig
echo "[startup] Shared library cache updated (ldconfig)."

echo "Node.js version:"
node -v
echo "NPM version:"
npm -v

# Optional safety net: install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "WARNING: node_modules not found. Installing production dependencies using package.json..."
    if [ ! -f "package.json" ]; then
        echo "ERROR: package.json not found; cannot install dependencies."
        exit 1
    fi
    if [ -f "package-lock.json" ]; then
        echo "Running npm ci --production --no-audit..."
        npm ci --production --no-audit || { echo "ERROR: npm ci failed"; exit 1; }
    else
        echo "package-lock.json not found; running npm install --production --no-audit..."
        npm install --production --no-audit || { echo "ERROR: npm install failed"; exit 1; }
    fi
else
    echo "node_modules found; skipping dependency installation."
fi

# Verify dist directory exists
if [ ! -d "dist" ]; then
    echo "ERROR: dist directory not found!"
    exit 1
fi

# Verify dist/index.cjs exists (build output)
if [ ! -f "dist/index.cjs" ]; then
    echo "ERROR: dist/index.cjs not found!"
    exit 1
fi

# Start the application using npm start (uses package.json start script)
echo "Starting application with NODE_ENV=production..."
export NODE_ENV=production
npm start
