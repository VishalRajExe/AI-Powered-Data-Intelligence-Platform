#!/usr/bin/env bash
# Start the FastAPI AI service on AI_SERVICE_PORT (8000 by default).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$DIR/_common.sh"
load_env

PY="$(require_venv)"
cd "$ROOT_DIR/ai-service"
echo "Starting ai-service on http://localhost:${AI_SERVICE_PORT:-8000}"
exec "$PY" -m uvicorn app.main:app \
  --host "${AI_SERVICE_HOST:-127.0.0.1}" \
  --port "${AI_SERVICE_PORT:-8000}"
