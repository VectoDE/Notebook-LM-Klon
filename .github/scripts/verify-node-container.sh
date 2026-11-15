#!/usr/bin/env bash
# Verifies the Node container image in CI (#330, #338):
#  1. the image holds production files only (bundle, migrations, web build; no node_modules, no sources),
#  2. the container becomes "healthy" through its own HEALTHCHECK,
#  3. web app and API answer on the same port,
#  4. guest login: 201 with the official Turnstile TEST secret, 503 without secret.
# Usage: verify-node-container.sh <image>
set -euo pipefail

IMAGE="${1:?image name missing}"
# Official Cloudflare Turnstile TEST values (always pass). Never valid in production.
TEST_SECRET="1x0000000000000000000000000000000AA"
TEST_SITE_KEY="1x00000000000000000000AA"
DUMMY_TOKEN="XXXX.DUMMY.TOKEN.XXXX"
SALT="$(openssl rand -hex 32)"
KEK="$(openssl rand -hex 32)"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

cleanup() {
  for name in nlk-with-secret nlk-without-secret; do
    echo "--- docker logs ${name} ---"
    docker logs "${name}" 2>&1 | tail -n 40 || true
    docker rm -f "${name}" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

echo "== 1. Image contents"
docker run --rm --entrypoint sh "${IMAGE}" -c '
  set -e
  test -f /app/apps/worker/dist/node-server.js
  test -f /app/apps/web/dist/index.html
  ls /app/apps/worker/migrations/*.sql >/dev/null
  test ! -e /app/node_modules
  test ! -e /app/apps/worker/src
  test ! -e /app/apps/web/src
  test "$(id -un)" = node
  node --version
'
docker run --rm --entrypoint sh "${IMAGE}" -c "grep -rqF '${TEST_SITE_KEY}' /app/apps/web/dist/assets" \
  || { echo "VITE_TURNSTILE_SITE_KEY build argument not found in the web bundle"; exit 1; }
echo "ok: production files only, site key from the build argument is in the web bundle"

start() { # name port [turnstile secret]
  local args=(-d --name "$1" -p "$2:8787" -e "APP_ORIGIN=http://localhost:$2"
    -e "SESSION_SALT_SECRET=${SALT}" -e "KEK_V1=${KEK}")
  if [ -n "${3:-}" ]; then args+=(-e "TURNSTILE_SECRET_KEY=$3"); fi
  docker run "${args[@]}" "${IMAGE}" >/dev/null
}

wait_healthy() { # name
  for _ in $(seq 1 60); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$1")"
    if [ "${status}" = "healthy" ]; then echo "ok: $1 is healthy"; return 0; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$1")" != "true" ]; then
      echo "$1 stopped"; return 1
    fi
    sleep 2
  done
  echo "$1 did not become healthy (last status: ${status})"; return 1
}

guest() { # port -> prints HTTP status, body in /tmp/guest.json
  curl -s -o /tmp/guest.json -w '%{http_code}' -X POST "http://localhost:$1/api/v1/auth/guest" \
    -H 'content-type: application/json' -H "origin: http://localhost:$1" \
    --data "{\"turnstileToken\":\"${DUMMY_TOKEN}\"}"
}

echo "== 2. Container with Turnstile TEST secret"
start nlk-with-secret 8787 "${TEST_SECRET}"
wait_healthy nlk-with-secret

echo "== 3. Web app and API on one port"
curl -sf http://localhost:8787/ | grep -q 'id="root"'
curl -sf http://localhost:8787/notebooks/deep/link | grep -q 'id="root"'
curl -sf http://localhost:8787/api/v1/health | tee /tmp/health.json | grep -q '"status":"ok"'
echo; echo "ok: / and SPA deep link serve index.html, /api/v1/health is ok"

echo "== 4a. Guest login with TEST secret"
code="$(guest 8787)"; cat /tmp/guest.json; echo
[ "${code}" = "201" ] || { echo "expected 201, got ${code}"; exit 1; }

echo "== 4b. Guest login without secret"
start nlk-without-secret 8788
wait_healthy nlk-without-secret
code="$(guest 8788)"; cat /tmp/guest.json; echo
[ "${code}" = "503" ] || { echo "expected 503, got ${code}"; exit 1; }
grep -q 'TURNSTILE_NOT_CONFIGURED' /tmp/guest.json
docker logs nlk-without-secret 2>&1 | grep -q 'TURNSTILE_SECRET_KEY fehlt'
echo "ok: 503 TURNSTILE_NOT_CONFIGURED and a clear start-up warning"

{
  echo "### Node container (${IMAGE})"
  echo "- Production files only, no node_modules, runs as user node"
  echo "- HEALTHCHECK: healthy"
  echo "- Web app and API on port 8787: \`/\`, SPA deep link, \`/api/v1/health\`"
  echo "- Guest login with Turnstile TEST secret: 201"
  echo "- Guest login without TURNSTILE_SECRET_KEY: 503 TURNSTILE_NOT_CONFIGURED"
} >> "${SUMMARY}"
