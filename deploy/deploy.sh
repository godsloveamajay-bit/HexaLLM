#!/usr/bin/env bash
# Deploy HexaLLM prod to ai.hexallm.co.uk from the single source-of-truth repo.
#   ./deploy/deploy.sh            # git pull + build/pull + up + healthcheck + rollback
#   ./deploy/deploy.sh --no-pull  # skip git pull (dirty tree / manual run)
#
# Two image paths:
#   - GHCR (CI): if GHCR_PAT+GHCR_USER are set in .env, images are pulled by
#     the sha-<git-sha> tag CI pushed. Rollback reuses the previous tag.
#   - Local build: images are built on the server and tagged :sha-<git-sha>.
#     Rollback reuses the previous locally-built image if it is still present.
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
PREV=""
[ -f deploy/current.sha ] && PREV="$(cat deploy/current.sha)"

echo ">> Deploying ${TAG} (previous: ${PREV:-none})"

if [ -n "${GHCR_PAT:-}" ] && [ -n "${GHCR_USER:-}" ]; then
  echo ">> Pulling images from GHCR"
  echo "$GHCR_PAT" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
  TAG="$TAG" "${COMPOSE[@]}" pull backend frontend worker || true
else
  echo ">> Building images locally (no GHCR_PAT set)"
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
    TAG="$PREV" "${COMPOSE[@]}" pull backend frontend worker || true
    TAG="$PREV" "${COMPOSE[@]}" up -d
  fi
  exit 1
fi

echo "$TAG" > deploy/current.sha
echo "✅ Deployed ${TAG}"
