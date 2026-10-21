#!/usr/bin/env bash
# The tunnel to the Mini App.
#
# Telegram accepts only https links for a Mini App, so the app is published
# through a Cloudflare tunnel. The script watches the address of the tunnel:
# when the address changes, it writes it into the environment file of the
# deployment and restarts the bot, so the menu button of the bot always leads
# to the working address.
#
#   bash deploy/tunnel.sh            - the tunnel and the watcher
#   bash deploy/tunnel.sh --install  - installs cloudflared and the service
#
# The service of the system:
#
#   /etc/systemd/system/telegram-to-obsidian-tunnel.service

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env"
TUNNEL_LOG="/var/log/telegram-to-obsidian-tunnel.log"
STATE_FILE="/var/run/telegram-to-obsidian-tunnel.url"
PORT="${MINI_APP_PORT:-8091}"
SERVICE_NAME="telegram-to-obsidian-tunnel"

log() { printf '[tunnel] %s\n' "$*"; }

install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    log "cloudflared is already installed: $(cloudflared --version)"
    return 0
  fi

  log "installing cloudflared"
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) log "FATAL: the architecture $arch is not supported"; exit 1 ;;
  esac

  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}" \
    -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
  log "cloudflared: $(cloudflared --version)"
}

install_service() {
  install_cloudflared

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=The tunnel to the Mini App of the notes
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=/bin/bash ${ROOT}/deploy/tunnel.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  log "the service ${SERVICE_NAME} is installed"
}

current_url() {
  if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
  else
    echo ""
  fi
}

set_url() {
  local url="$1"
  local old
  old="$(current_url)"
  if [ "$url" = "$old" ]; then
    return 0
  fi

  log "the address of the tunnel is now $url"
  printf '%s' "$url" > "$STATE_FILE"

  if [ -f "$ENV_FILE" ] && grep -q '^MINI_APP_URL=' "$ENV_FILE"; then
    sed -i "s|^MINI_APP_URL=.*|MINI_APP_URL=${url}|" "$ENV_FILE"
  else
    printf '\nMINI_APP_URL=%s\n' "$url" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"

  # The bot reads the address when it starts and sets the menu button.
  log "restarting the bot with the new address"
  docker compose -p telegram-to-obsidian-ai-agent -f "$ROOT/deploy/docker-compose.yml" \
    up -d --no-build app >>"$TUNNEL_LOG" 2>&1 || log "warning: could not restart the bot"
}

start_tunnel() {
  if pgrep -f "cloudflared tunnel --url" >/dev/null 2>&1; then
    log "the tunnel is already running"
    return 0
  fi

  log "starting the tunnel to http://127.0.0.1:${PORT}"
  nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" \
    >>"$TUNNEL_LOG" 2>&1 &
  sleep 5
}

watch_tunnel() {
  while true; do
    start_tunnel
    local url
    url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -n 1 || true)"
    if [ -n "$url" ]; then
      set_url "$url"
    fi
    sleep 30
  done
}

case "${1:-}" in
  --install)
    install_service
    systemctl restart "${SERVICE_NAME}"
    log "the tunnel is starting"
    ;;
  *)
    mkdir -p "$(dirname "$TUNNEL_LOG")" "$(dirname "$STATE_FILE")"
    touch "$TUNNEL_LOG"
    watch_tunnel
    ;;
esac
