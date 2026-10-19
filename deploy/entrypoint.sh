#!/usr/bin/env bash
# Container entrypoint: prepares the Hermes Agent environment and starts the bot.
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-/home/node/.hermes}"
export HERMES_HOME

log() { printf '[entrypoint] %s\n' "$*"; }

# --- Hermes launcher --------------------------------------------------------
HERMES_BIN="$(command -v hermes || true)"
if [ -z "$HERMES_BIN" ]; then
  HERMES_BIN="$(find "$HERMES_HOME" -maxdepth 4 -type f -name hermes -perm -u+x 2>/dev/null | head -n1 || true)"
fi
if [ -z "$HERMES_BIN" ]; then
  log "FATAL: the hermes binary was not found"
  exit 1
fi
export HERMES_BIN
export PATH="$(dirname "$HERMES_BIN"):$PATH"
log "hermes: $HERMES_BIN"

# --- uv / uvx (the DuckDuckGo MCP server is started with uvx) ---------------
UV_BIN="$(find "$HERMES_HOME/tools" -maxdepth 3 -type f -name uv 2>/dev/null | head -n1 || true)"
if [ -n "$UV_BIN" ]; then
  export PATH="$(dirname "$UV_BIN"):$PATH"
  log "uv: $UV_BIN"
else
  log "warning: uv was not found, the DuckDuckGo MCP server will not start"
fi

# --- The Obsidian skill reads the vault path from the Hermes environment ----
mkdir -p "$HERMES_HOME"
cat > "$HERMES_HOME/.env" <<EOF
OBSIDIAN_VAULT_PATH=${OBSIDIAN_VAULT_PATH:-/vault}
EOF
chmod 600 "$HERMES_HOME/.env"

# --- Model provider ---------------------------------------------------------
# The agent talks to a local proxy: it adds the session header the OpenCode Go
# relay requires and keeps the real key out of the agent configuration.
hermes config set model.provider custom 2>/dev/null || log "warning: could not set model.provider"
hermes config set model.base_url "http://127.0.0.1:${LLM_PROXY_PORT:-11434}/v1" 2>/dev/null || log "warning: could not set model.base_url"
hermes config set model.api_key "local-proxy" 2>/dev/null || log "warning: could not set model.api_key"
hermes config set model.default "${HERMES_MODEL:-minimax-m3.1-flash-free}" 2>/dev/null || log "warning: could not set model.default"

# --- MCP servers ------------------------------------------------------------
# `hermes mcp add` asks whether the tools may be enabled. The answer comes
# from the pipe, the sleep keeps the pipe open while the server is tested.
mcp_enabled() {
  local line
  line="$(hermes mcp list 2>/dev/null | grep -E "^[[:space:]]*$1[[:space:]]" || true)"
  case "$line" in
    *disabled*) return 1 ;;
    *enabled*) return 0 ;;
    *) return 1 ;;
  esac
}

# The vault: our own server, it writes the notes in a way that is safe for
# Syncthing.
if ! mcp_enabled vault; then
  hermes mcp remove vault >/dev/null 2>&1 || true
  { printf 'Y\n'; sleep 15; } | hermes mcp add vault \
    --command node \
    --env "OBSIDIAN_VAULT_PATH=${OBSIDIAN_VAULT_PATH:-/vault}" \
    --env "VAULT_EVENTS_FILE=${VAULT_EVENTS_FILE:-/app/data/vault-events.json}" \
    --env "TIMEZONE=${TZ:-Asia/Almaty}" \
    --env "LOG_LEVEL=${LOG_LEVEL:-info}" \
    --args /app/dist/vault/mcp-server.js >/dev/null 2>&1 \
    || log "warning: could not add the vault mcp server"
fi

# The web search: the DuckDuckGo server of the community.
if ! mcp_enabled ddg-search; then
  hermes mcp remove ddg-search >/dev/null 2>&1 || true
  { printf 'Y\n'; sleep 20; } | hermes mcp add ddg-search \
    --command uvx \
    --args --with "duckduckgo-mcp-server[browser]" duckduckgo-mcp-server >/dev/null 2>&1 \
    || log "warning: could not add the duckduckgo mcp server"
fi

log "mcp servers:"
hermes mcp list 2>&1 | sed 's/^/[entrypoint] /' || log "warning: could not list the mcp servers"

# --- Start ------------------------------------------------------------------
log "starting: $*"
exec "$@"
