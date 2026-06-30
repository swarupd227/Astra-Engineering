#!/usr/bin/env bash
set -euo pipefail

# ======================================================================
# DevX 2.0 — EC2 Setup Script
# ======================================================================
# Prerequisites:
#   - Amazon Linux 2023 or Ubuntu 22.04+
#   - IAM Instance Profile attached with SecretsManager:GetSecretValue
#   - Security group allows inbound on port 4000 (or your reverse proxy port)
#
# Usage:
#   sudo bash setup-ec2.sh              # first-time setup
#   sudo bash setup-ec2.sh --update     # redeploy new build (no Node install)
# ======================================================================

APP_DIR="/opt/devx"
APP_USER="devx"
SERVICE_NAME="devx"
NODE_MAJOR=20

# ------------------------------------------------------------------
# 1. Detect OS
# ------------------------------------------------------------------
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
else
  echo "Cannot detect OS. Exiting."
  exit 1
fi

# ------------------------------------------------------------------
# 2. Install Node.js (skip if --update)
# ------------------------------------------------------------------
install_node() {
  echo ">>> Installing Node.js $NODE_MAJOR..."
  if [ "$OS_ID" = "amzn" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_MAJOR}.x | bash -
    yum install -y nodejs
  elif [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
    apt-get install -y nodejs
  else
    echo "Unsupported OS: $OS_ID. Install Node $NODE_MAJOR manually."
    exit 1
  fi
  echo ">>> Node.js $(node -v) installed."
}

# ------------------------------------------------------------------
# 3. Create app user & directory
# ------------------------------------------------------------------
setup_user() {
  if ! id "$APP_USER" &>/dev/null; then
    echo ">>> Creating system user: $APP_USER"
    useradd --system --shell /usr/sbin/nologin --home-dir "$APP_DIR" "$APP_USER"
  fi

  mkdir -p "$APP_DIR"
  chown "$APP_USER":"$APP_USER" "$APP_DIR"
}

# ------------------------------------------------------------------
# 4. Deploy application files
# ------------------------------------------------------------------
deploy_app() {
  echo ">>> Deploying application to $APP_DIR..."

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

  if [ ! -f "$PROJECT_ROOT/dist/index.cjs" ]; then
    echo "ERROR: dist/index.cjs not found. Run 'npm run build' first."
    exit 1
  fi

  cp -r "$PROJECT_ROOT/dist" "$APP_DIR/"
  cp "$PROJECT_ROOT/package.json" "$APP_DIR/"
  cp "$PROJECT_ROOT/package-lock.json" "$APP_DIR/" 2>/dev/null || true

  echo ">>> Installing production dependencies..."
  cd "$APP_DIR"
  npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

  chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
  echo ">>> Application deployed."
}

# ------------------------------------------------------------------
# 5. Install systemd service
# ------------------------------------------------------------------
install_service() {
  echo ">>> Installing systemd service: $SERVICE_NAME"

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cp "$SCRIPT_DIR/devx.service" /etc/systemd/system/${SERVICE_NAME}.service

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  echo ">>> Service installed and enabled."
}

# ------------------------------------------------------------------
# 6. Start / restart
# ------------------------------------------------------------------
start_service() {
  echo ">>> Starting $SERVICE_NAME..."
  systemctl restart "$SERVICE_NAME"
  sleep 2

  if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ">>> $SERVICE_NAME is running."
    echo ">>> View logs: journalctl -u $SERVICE_NAME -f"
  else
    echo "ERROR: $SERVICE_NAME failed to start. Check logs:"
    journalctl -u "$SERVICE_NAME" --no-pager -n 30
    exit 1
  fi
}

# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
main() {
  echo "=============================="
  echo " DevX 2.0 — EC2 Setup"
  echo "=============================="

  if [ "${1:-}" != "--update" ]; then
    install_node
  fi

  setup_user
  deploy_app
  install_service
  start_service

  echo ""
  echo "=============================="
  echo " Setup complete!"
  echo " App running at http://$(hostname -I | awk '{print $1}'):4000"
  echo " Logs: journalctl -u $SERVICE_NAME -f"
  echo "=============================="
}

main "$@"
