#!/usr/bin/env bash
# The single verification gate for all three layers.
#
# The previous project had eight separate commands and no aggregate entry point, which is how
# "213 tests pass, 0 lint errors, typechecks cleanly, build succeeds" stayed in its memory file
# long after none of them were true. This script runs the checks, names the counts, and marks
# anything it could not run as SKIPPED rather than silently passing.
#
#   scripts/verify.sh            # everything
#   scripts/verify.sh backend    # one layer: backend | ai | frontend
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DIR/.." && pwd)"
WHICH="${1:-all}"

RESULTS=()
FAILED=0

record() { RESULTS+=("$1|$2|$3"); }

run_check() {
  local name="$1" dir="$2" cmd="$3" prereq="${4:-}"
  if [[ -n "$prereq" && ! -e "$ROOT_DIR/$prereq" ]]; then
    record "SKIP" "$name" "missing $prereq"
    return
  fi
  local log="/tmp/finalagent-verify-$(echo "$name" | tr ' /' '__').log"
  echo ">>> $name"
  if (cd "$ROOT_DIR/$dir" && eval "$cmd") > "$log" 2>&1; then
    local detail
    detail="$(grep -ohE 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+' "$log" | tail -1)"
    [[ -z "$detail" ]] && detail="$(grep -ohE '[0-9]+ passed(, [0-9]+ skipped)?' "$log" | tail -1)"
    [[ -z "$detail" ]] && detail="ok"
    record "PASS" "$name" "$detail"
  else
    record "FAIL" "$name" "see $log"
    FAILED=1
    tail -15 "$log" | sed 's/^/    /'
  fi
}

if [[ "$WHICH" == "all" || "$WHICH" == "backend" ]]; then
  run_check "backend: tests"   "backend"  "mvn -B -ntp test"
  run_check "backend: package" "backend"  "mvn -B -ntp -DskipTests package"
fi

if [[ "$WHICH" == "all" || "$WHICH" == "ai" ]]; then
  PY=""
  if [[ -x "$ROOT_DIR/ai-service/.venv/Scripts/python.exe" ]]; then
    PY="$ROOT_DIR/ai-service/.venv/Scripts/python.exe"
  elif [[ -x "$ROOT_DIR/ai-service/.venv/bin/python" ]]; then
    PY="$ROOT_DIR/ai-service/.venv/bin/python"
  fi
  if [[ -z "$PY" ]]; then
    record "SKIP" "ai: tests" "no virtualenv in ai-service/.venv"
  else
    run_check "ai: tests" "ai-service" "\"$PY\" -m pytest -q"
  fi
fi

if [[ "$WHICH" == "all" || "$WHICH" == "frontend" ]]; then
  run_check "frontend: typecheck" "frontend" "npm run typecheck" "frontend/node_modules"
  run_check "frontend: lint"      "frontend" "npm run lint"      "frontend/node_modules"
  run_check "frontend: build"     "frontend" "npm run build"     "frontend/node_modules"
fi

echo
echo "=================== FINALAIAGENT verification ==================="
printf '%-6s %-24s %s\n' "RESULT" "CHECK" "DETAIL"
for entry in "${RESULTS[@]}"; do
  IFS='|' read -r status name detail <<< "$entry"
  printf '%-6s %-24s %s\n' "$status" "$name" "$detail"
done
echo "================================================================="
echo "Not covered by this script: live provider calls. Run"
echo "  RUN_LIVE_PROVIDER_TESTS=true pytest -q tests/test_live_requirements.py"
echo "  RUN_LIVE_PROVIDER_TESTS=true pytest -q tests/test_live_provider_spike.py"
echo "These need Gemini quota (the free tier caps gemini-2.5-flash at 20 requests/day) and a"
echo "real FIRECRAWL_API_KEY. Also not covered: Docker builds (Docker is not installed here)"
echo "and any real MySQL round-trip (needs credentials in the root .env)."

exit "$FAILED"
