# @danii1kq/vault-mcp

The MCP server of an Obsidian vault, with the writes that are safe for
[Syncthing](https://syncthing.net).

The server gives an agent (Hermes Agent, Claude Desktop, Cursor, any MCP
client) five tools over a vault of markdown notes:

| Tool | What it does |
| --- | --- |
| `search_files` | searches the vault by the name of a note or by the text inside the notes |
| `read_file` | reads a note |
| `list_notes` | lists the notes, the newest first |
| `write_file` | creates or overwrites a note |
| `append` | appends a block to a note, without touching the rest |

## Why the writes are special

A vault that is synchronised by Syncthing is a strange place to write: the
synchroniser may read a file in the middle of the write. Every write of this
server therefore goes through the guard:

- the content is written to a temporary file and renamed over the target, so
  a reader never sees a half written note,
- when the file was just changed, the write waits a second,
- when the write fails because the file is locked, it is repeated every 500 ms,
- after the write the file is read back: if somebody changed it in the
  meantime, the write is repeated,
- the paths are resolved against the root of the vault, so a tool call cannot
  write outside of it.

## The installation

```bash
npm install -g @danii1kq/vault-mcp
```

## The usage

The server needs the path of the vault:

```bash
OBSIDIAN_VAULT_PATH=/path/to/vault vault-mcp
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `OBSIDIAN_VAULT_PATH` | the folder of the vault | required |
| `VAULT_EVENTS_FILE` | the file with the log of the changes | `/app/data/vault-events.json` |
| `VAULT_RETRY_DELAY_MS` | the pause between two tries | `500` |
| `VAULT_MAX_ATTEMPTS` | how many times a write is repeated | `5` |
| `VAULT_SETTLE_DELAY_MS` | the pause when the file was just changed | `1000` |
| `TIMEZONE` | the time zone of the owner | `Asia/Almaty` |
| `LOG_LEVEL` | `debug`, `info`, `warn` or `error` | `info` |

## The configuration of a client

The example for a client that reads the configuration from a JSON file:

```json
{
  "mcpServers": {
    "vault": {
      "command": "vault-mcp",
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/vault"
      }
    }
  }
}
```

## The license

MIT.
