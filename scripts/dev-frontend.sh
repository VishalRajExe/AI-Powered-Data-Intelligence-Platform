#!/usr/bin/env bash
# Start the Next.js development server on port 3000.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$DIR/_common.sh"
load_env

cd "$ROOT_DIR/frontend"
if [[ ! -d node_modules ]]; then
  echo "frontend/node_modules is missing. Run: cd frontend && npm install" >&2
  exit 1
fi

echo "Starting frontend on http://localhost:3000 (proxying /api/v1 to ${BACKEND_ORIGIN:-http://localhost:8080})"
# Extra arguments are forwarded, so `scripts/dev-frontend.sh -- -p 3210` can work around a
# port already held by another process.
exec npm run dev -- "$@"
