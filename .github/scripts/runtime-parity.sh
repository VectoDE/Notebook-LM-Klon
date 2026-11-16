#!/usr/bin/env bash
# Runs the same checks against the Cloudflare Workers runtime (wrangler dev, workerd, local
# D1/R2/Durable Objects) or the Node runtime (apps/worker/dist/node-server.js) (#330):
#  - smoke check (health, web app, guest login without token 403, chat without session 401),
#  - guest login with the official Turnstile TEST secret: 201.
# Expects `pnpm build` to have run (web app and Node bundle).
# Usage: runtime-parity.sh workers|node
set -euo pipefail

RUNTIME="${1:?runtime missing (workers|node)}"
PORT=8787
BASE="http://127.0.0.1:${PORT}"
# Official Cloudflare Turnstile TEST secret (always passes). Never valid in production.
TEST_SECRET="1x0000000000000000000000000000000AA"
SALT="$(openssl rand -hex 32)"
KEK="$(openssl rand -hex 32)"
LOG="${RUNNER_TEMP:-/tmp}/runtime-${RUNTIME}.log"
cd "$(dirname "$0")/../../apps/worker"

case "${RUNTIME}" in
  workers)
    # wrangler dev reads secrets from .dev.vars (ignored by git, deleted below).
    printf 'SESSION_SALT_SECRET=%s\nKEK_V1=%s\nTURNSTILE_SECRET_KEY=%s\nAPP_ORIGIN=%s\n' \
      "${SALT}" "${KEK}" "${TEST_SECRET}" "${BASE}" > .dev.vars
    trap 'rm -f .dev.vars' EXIT
    pnpm exec wrangler d1 migrations apply notebook-lm-db --local
    pnpm exec wrangler dev --local --ip 127.0.0.1 --port "${PORT}" > "${LOG}" 2>&1 &
    ;;
  node)
    DATA_DIR="$(mktemp -d)" STATIC_DIR="$(pwd)/../web/dist" PORT="${PORT}" \
      APP_ORIGIN="${BASE}" SESSION_SALT_SECRET="${SALT}" KEK_V1="${KEK}" \
      TURNSTILE_SECRET_KEY="${TEST_SECRET}" node dist/node-server.js > "${LOG}" 2>&1 &
    ;;
  *) echo "unknown runtime ${RUNTIME}"; exit 2 ;;
esac
SERVER_PID=$!
trap 'kill ${SERVER_PID} 2>/dev/null || true; rm -f .dev.vars; echo "--- server log ---"; tail -n 60 "${LOG}"' EXIT

for _ in $(seq 1 90); do
  if curl -sf "${BASE}/api/v1/health" > /tmp/health.json; then break; fi
  sleep 2
done
cat /tmp/health.json; echo

pnpm exec tsx src/smoke-check.ts "${BASE}"

code="$(curl -s -o /tmp/guest.json -w '%{http_code}' -X POST "${BASE}/api/v1/auth/guest" \
  -H 'content-type: application/json' -H "origin: ${BASE}" \
  --data '{"turnstileToken":"XXXX.DUMMY.TOKEN.XXXX"}')"
cat /tmp/guest.json; echo
[ "${code}" = "201" ] || { echo "expected 201, got ${code}"; exit 1; }

{
  echo "### Runtime: ${RUNTIME}"
  echo "- Health: $(cat /tmp/health.json)"
  echo "- Smoke check: passed"
  echo "- Guest login with Turnstile TEST secret: 201"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
