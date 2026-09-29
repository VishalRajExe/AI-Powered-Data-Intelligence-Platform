#!/usr/bin/env bash
# Start the Spring Boot backend on SERVER_PORT (8080 by default).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$DIR/_common.sh"
load_env

cd "$ROOT_DIR/backend"
echo "Starting backend on http://localhost:${SERVER_PORT:-8080}"
exec mvn -B -ntp spring-boot:run
