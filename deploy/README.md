# Deploy

The scheme is simple: GitHub (`main`) → `git pull` on the server →
`docker compose build` → `up -d` → healthcheck. No domain is used, the bot
works on long polling and nothing of the application is exposed to the
internet (only the Syncthing ports are open).

## Compose project name

The compose project is pinned with the `name:` key in `deploy/docker-compose.yml`
and with the `-p` flag in `deploy.sh`. Without it Docker would name the project
after the directory (`deploy`), and a server that hosts several projects in
folders of the same name would see the containers of one project removed by
`up --remove-orphans` of another one.

## The server

| Parameter | Value |
| --- | --- |
| Host | the IP of your server, an ssh alias in `~/.ssh/config` is convenient |
| User | `root` or a user with access to docker |
| Project folder | `/opt/telegram-to-obsidian-ai-agent` |
| Repository | `https://github.com/danii1kq/telegram-to-obsidian_ai-agent.git` (public, so no token is needed) |
| Docker / Compose | 29.9.1 / v5.6.0 |

## One time preparation of the server

```bash
ssh <server>
git clone https://github.com/danii1kq/telegram-to-obsidian_ai-agent.git /opt/telegram-to-obsidian-ai-agent
cd /opt/telegram-to-obsidian-ai-agent
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
# fill in the telegram token, the model key and the allowed user id
mkdir -p /opt/obsidian-vault
chown -R 1000:1000 /opt/obsidian-vault
ufw allow 8384/tcp   # syncthing web interface
ufw allow 22000/tcp  # syncthing sync
ufw allow 21027/udp  # syncthing discovery
```

## Deploy

From the local machine (commit, push and deploy in one command):

```powershell
.\deploy\deploy.ps1 -Message "feat: new feature"
```

The ssh target of the server is taken from the parameter `-Remote` or from the
environment variable `VDS_SSH_HOST` (an alias from `~/.ssh/config` works well),
the default is `server`.

Or directly on the server:

```bash
ssh <server> "cd /opt/telegram-to-obsidian-ai-agent && bash deploy/deploy.sh"
```

The script `deploy/deploy.sh`:

1. `git pull --ff-only origin main` updates the code;
2. the current image is tagged as `telegram-to-obsidian-ai-agent:prev` (the
   point of the rollback);
3. `docker compose build` and `up -d --remove-orphans`;
4. it waits for `healthy` up to 90 s, on a failure it rolls back to `:prev`
   and returns a non zero exit code.

## Rollback by hand

```bash
ssh <server> "cd /opt/telegram-to-obsidian-ai-agent && bash deploy/deploy.sh --rollback"
```

## Logs and status

```bash
ssh <server> "cd /opt/telegram-to-obsidian-ai-agent/deploy && docker compose ps"
ssh <server> "cd /opt/telegram-to-obsidian-ai-agent/deploy && docker compose logs -f app"
ssh <server> "curl -s http://127.0.0.1:8090/health"
```

## Secrets

`deploy/.env` lives only on the server (it is in `.gitignore`), the rights are
`600`. The values: `TELEGRAM_BOT_TOKEN`, `ALLOWED_TELEGRAM_ID`, `LLM_API_KEY`,
`VAULT_HOST_PATH`, `HERMES_MODEL`, `HERMES_FALLBACK_MODEL`, `LOG_LEVEL`.

## What else can be set up

- **Private repository**: add a deploy key on the server
  (`ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""` → add the public key in
  Settings → Deploy keys of the repository) and switch `origin` to SSH.
- **CI/CD**: GitHub Actions → `rsync` + `docker compose up -d` with an ssh key
  from the secrets of the repository.
- **Watchtower**: automatic image updates, but with the tag `:latest` it is
  better to keep the deployment under control.
