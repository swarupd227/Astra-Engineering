#!/bin/sh
set -eu

# Podman/Docker --env-file keeps surrounding quotes as literal characters,
# while dotenv-style local files commonly use KEY="value". Normalize those
# values before Node reads process.env.
for name in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p'); do
  eval "value=\${$name-}"
  case "$value" in
    \"*\")
      if [ "${value%\"}" != "$value" ]; then
        value=${value#\"}
        value=${value%\"}
        export "$name=$value"
      fi
      ;;
    \'*\')
      if [ "${value%\'}" != "$value" ]; then
        value=${value#\'}
        value=${value%\'}
        export "$name=$value"
      fi
      ;;
  esac
done

# Database migrations before app start (default on EKS when migrations.runOnPodStart=true).
# Set RUN_DB_MIGRATIONS=true and RUN_DB_SEED=true on the Deployment (Helm sets these).
# Alternative: migrations.runAsJob=true to run once via Helm Job instead of every pod.
if [ "${RUN_DB_MIGRATIONS:-}" = "true" ] || [ "${RUN_DB_MIGRATIONS:-}" = "1" ]; then
  echo "[entrypoint] Running database migrations..."
  export DEVX_REPO_ROOT="${DEVX_REPO_ROOT:-/app}"
  node /app/scripts/run-container-migrations.js
  echo "[entrypoint] Database migrations finished."
fi

exec "$@"
