#!/usr/bin/env bash
# Деплой ai-notes-tg-bot на VDS (<server>).
#
#   bash deploy/deploy.sh              — обычный деплой: pull → build → up → healthcheck
#   bash deploy/deploy.sh --rollback   — откат на предыдущую версию (:prev)
#
# Скрипт идемпотентен и безопасен: при неудачном healthcheck автоматически
# откатывается на :prev и возвращает ненулевой код.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"
CONTAINER="ai-notes-tg-bot"
IMAGE="ai-notes-tg-bot:latest"
PREV="ai-notes-tg-bot:prev"
COMPOSE=(docker compose -f deploy/docker-compose.yml)

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
err() { printf '\033[1;31m!! %s\033[0m\n' "$*" >&2; }

rollback() {
  log "Откат на образ $PREV"
  if ! docker image inspect "$PREV" >/dev/null 2>&1; then
    err "Образа $PREV нет — откат невозможен"
    return 1
  fi
  IMAGE_TAG=prev "${COMPOSE[@]}" up -d --no-build --remove-orphans
  docker image tag "$PREV" "$IMAGE"
  log "Откат выполнен"
}

if [[ "${1:-}" == "--rollback" ]]; then
  rollback
  exit $?
fi

log "git pull origin $BRANCH"
git pull --ff-only origin "$BRANCH"

log "Тегируем текущую версию как :prev"
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker image tag "$IMAGE" "$PREV"
fi

log "docker compose build"
"${COMPOSE[@]}" build

log "docker compose up -d"
"${COMPOSE[@]}" up -d --remove-orphans

log "Ждём healthcheck (до 60 с)"
healthy=0
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
  case "$status" in
    healthy)
      healthy=1
      break
      ;;
    unhealthy | exited | missing | dead)
      err "Контейнер в статусе: $status"
      rollback || true
      exit 1
      ;;
  esac
  sleep 2
done

if [[ "$healthy" -ne 1 ]]; then
  err "Healthcheck не пройден за отведённое время"
  rollback || true
  exit 1
fi

log "Статус контейнеров"
"${COMPOSE[@]}" ps

docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true

log "Деплой завершён успешно"
