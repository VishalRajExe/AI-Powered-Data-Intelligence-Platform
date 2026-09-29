#!/usr/bin/env bash
# Create the root .env from .env.example and fill in the secrets this project generates
# for itself. Values are never printed.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$DIR/_common.sh"

if [[ -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists. Not overwriting it." >&2
  echo "Edit it directly, or move it aside and re-run." >&2
  exit 1
fi

cp "$ROOT_DIR/.env.example" "$ENV_FILE"

generate() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

put() {
  local name="$1" value="$2"
  # Hex-only values, so no sed escaping is needed.
  sed -i.bak "s|^${name}=.*|${name}=${value}|" "$ENV_FILE"
}

put AI_SERVICE_API_KEY "$(generate)"
put MYSQL_ROOT_PASSWORD "$(generate)"
put MYSQL_PASSWORD "$(generate)"
if grep -q '^MYSQL_USER=$' "$ENV_FILE"; then
  put MYSQL_USER "finalagent"
fi

rm -f "${ENV_FILE}.bak"
echo "Wrote $ENV_FILE (gitignored). Generated secrets were not printed."
echo
echo "Still required before the services will start:"
for name in MYSQL_USER MYSQL_PASSWORD GEMINI_API_KEY FIRECRAWL_API_KEY; do
  current="$(grep "^${name}=" "$ENV_FILE" | cut -d= -f2- || true)"
  if [[ -z "$current" ]]; then
    echo "  - $name"
  fi
done
echo
echo "Note: a variable already exported in your shell takes precedence over the .env file for"
echo "both services, so an unexpected value there will override what you wrote here."
