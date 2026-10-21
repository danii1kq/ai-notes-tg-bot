#!/usr/bin/env bash
# Deploys the bot on the VDS.
#
#   bash deploy/deploy.sh              - normal deploy: pull -> build -> up -> healthcheck
#   bash deploy/deploy.sh --rollback   - roll back to the previous image (:prev)
#
# The script is idempotent and safe: when the new container does not become
# healthy it rolls back to :prev and returns a non zero exit code.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"
CONTAINER="telegram-to-obsidian-bot"
IMAGE="telegram-to-obsidian-ai-agent:latest"
PREV="telegram-to-obsidian-ai-agent:prev"
# -p repeats the name: from the compose file, without it the project would be
# named after the directory ("deploy"), a name that belongs to another project
# on this server.
COMPOSE=(docker compose -p telegram-to-obsidian-ai-agent -f deploy/docker-compose.yml)

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
err() { printf '\033[1;31m!! %s\033[0m\n' "$*" >&2; }

rollback() {
  log "Rolling back to the image $PREV"
  if ! docker image inspect "$PREV" >/dev/null 2>&1; then
    err "The image $PREV does not exist, a rollback is not possible"
    return 1
  fi
  IMAGE_TAG=prev "${COMPOSE[@]}" up -d --no-build --remove-orphans
  log "The rollback is done"
}

if [[ "${1:-}" == "--rollback" ]]; then
  rollback
  exit $?
fi

if [ ! -f deploy/.env ]; then
  err "deploy/.env is missing, copy deploy/.env.example and fill it in"
  exit 1
fi

log "git pull origin $BRANCH"
git pull --ff-only origin "$BRANCH"

log "Tagging the current version as :prev"
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker image tag "$IMAGE" "$PREV"
fi

# The rollback uses the tag :prev, the compose file reads it from the
# environment.
export IMAGE_TAG=latest

log "docker compose build"
"${COMPOSE[@]}" build

log "docker compose up -d"
"${COMPOSE[@]}" up -d --remove-orphans

log "Waiting for the healthcheck (up to 5 min)"
healthy=0
for _ in $(seq 1 150); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
  case "$status" in
    healthy)
      healthy=1
      break
      ;;
    unhealthy | exited | missing | dead)
      err "The container is in the state: $status"
      rollback || true
      exit 1
      ;;
  esac
  sleep 2
done

if [[ "$healthy" -ne 1 ]]; then
  err "The healthcheck did not pass in time"
  rollback || true
  exit 1
fi

log "Status of the containers"
"${COMPOSE[@]}" ps

docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true

log "The deployment is done"
