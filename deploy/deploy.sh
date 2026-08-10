#!/usr/bin/env bash
# Deploy HexaLLM prod to ai.hexallm.co.uk from the single source-of-truth repo.
#   ./deploy/deploy.sh               # git pull + build + up + healthcheck + rollback
#   ./deploy/deploy.sh --no-pull     # skip git pull (dirty tree / manual run)
#   DEPLOY_MODE=pull ./deploy/deploy.sh   # pull CI-pushed images from GHCR instead of building
#
# Image paths:
#   - build (default): images are built on the server and tagged :sha-<git-sha>.
#     Rollback reuses the previous locally-built image if still present.
#   - pull (DEPLOY_MODE=pull): pulls the sha-<git-sha> tag CI pushed to GHCR
#     (public images need no auth; set GHCR_USER/GHCR_PAT if packages are
#     private). Falls back to a local build if the pull is slow/unavailable.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml)
PROJ=hexallm-prod
HEALTH_PORT=3001

if [ "${1:-}" != "--no-pull" ]; then
  echo ">> git pull --ff-only"
  git pull --ff-only
fi

if [ -f .env ]; then
  set -a && . ./.env && set +a
fi

TAG="sha-$(git rev-parse --short HEAD)"
export TAG
PREV=""
[ -f deploy/current.sha ] && PREV="$(cat deploy/current.sha)"

echo ">> Deploying ${TAG} (previous: ${PREV:-none})"

if [ "${DEPLOY_MODE:-build}" = "pull" ]; then
  if [ -n "${GHCR_PAT:-}" ] && [ -n "${GHCR_USER:-}" ]; then
    echo ">> Pulling images from GHCR (authenticated)"
    echo "$GHCR_PAT" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
  else
    echo ">> Pulling public images from GHCR (no auth needed)"
  fi
  if ! timeout 180 "${COMPOSE[@]}" pull backend frontend worker; then
    echo "!! GHCR pull failed/slow — falling back to a local build"
    TAG="$TAG" "${COMPOSE[@]}" build backend frontend worker
  fi
else
  echo ">> Building images locally (DEPLOY_MODE=build; set DEPLOY_MODE=pull for GHCR)"
  TAG="$TAG" "${COMPOSE[@]}" build backend frontend worker
fi

"${COMPOSE[@]}" up -d

echo ">> Waiting for health (http://localhost:${HEALTH_PORT}/api/v1/health)"
ok=0
for i in $(seq 1 40); do
  if curl -fsS "http://localhost:${HEALTH_PORT}/api/v1/health" >/dev/null 2>&1 &&
     curl -fsS "http://localhost:${HEALTH_PORT}/" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 3
done

if [ "$ok" != 1 ]; then
  echo "!! HEALTHCHECK FAILED — rolling back to ${PREV:-previous image}" >&2
  if [ -n "$PREV" ]; then
    if [ "${DEPLOY_MODE:-build}" = "pull" ]; then
      TAG="$PREV" timeout 180 "${COMPOSE[@]}" pull backend frontend worker || true
    fi
    TAG="$PREV" "${COMPOSE[@]}" up -d
  fi
  exit 1
fi

echo "$TAG" > deploy/current.sha
echo "✅ Deployed ${TAG}"
