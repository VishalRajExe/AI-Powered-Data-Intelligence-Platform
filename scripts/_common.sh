#!/usr/bin/env bash
# Shared helpers for the FINALAIAGENT development scripts.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "No $ENV_FILE. Run scripts/bootstrap-env.sh first." >&2
    exit 1
  fi

  # `source` would export every assignment in the file, including the blank ones left by
  # bootstrap-env.sh for the user to fill in. A blank assignment would then *override*
  # a real value already present in the environment, and the service would refuse to start
  # for a reason that looks like a missing credential. So: skip empty values, export the rest.
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" != *"="* ]] && continue

    key="${line%%=*}"
    value="${line#*=}"
    key="${key//[[:space:]]/}"
    value="${value%\"}"; value="${value#\"}"

    [[ -z "$key" || -z "$value" ]] && continue
    export "$key=$value"
  done < "$ENV_FILE"
}

# The venv layout differs by platform; resolve it instead of assuming one.
venv_python() {
  if [[ -x "$ROOT_DIR/ai-service/.venv/bin/python" ]]; then
    echo "$ROOT_DIR/ai-service/.venv/bin/python"
  elif [[ -x "$ROOT_DIR/ai-service/.venv/Scripts/python.exe" ]]; then
    echo "$ROOT_DIR/ai-service/.venv/Scripts/python.exe"
  else
    echo ""
  fi
}

require_venv() {
  local py
  py="$(venv_python)"
  if [[ -z "$py" ]]; then
    echo "No ai-service virtualenv. Create it with:" >&2
    echo "  cd ai-service && python -m venv .venv && .venv/Scripts/pip install -e '.[dev]'" >&2
    exit 1
  fi
  echo "$py"
}
