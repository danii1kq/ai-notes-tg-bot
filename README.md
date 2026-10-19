# Telegram to Obsidian AI Agent

A private Telegram bot that turns short thoughts into notes of an Obsidian
vault. The bot is the front end, [Hermes Agent](https://hermes-agent.nousresearch.com)
is the brain, and the vault is the memory. The vault is synchronised between
the server and your laptop with Syncthing, so the notes are available
everywhere and are never locked by the bot.

**English** | [Русский](#русский)

---

## English

### What it does

- You send a text message to the bot in Telegram.
- The bot passes it to Hermes Agent, which works with the vault through a set
  of MCP tools:
  - it searches the notes for something on the same topic,
  - it appends the thought to that note, or creates a new note,
  - every new note starts with the Obsidian frontmatter
    (`date` and `tags: [inbox, telegram]`),
  - names of notes that already exist become `[[wiki links]]`.
- When the message needs facts (an unknown term, prices, news, a question),
  the agent searches the web through the DuckDuckGo MCP server first and puts
  what it found into the note together with the source link.
- The bot answers with one short line: `Created note "Business ideas"`.

Only the owner of the bot is allowed to use it: every message from another
user id is dropped without an answer.

### How the notes stay safe

The vault is synchronised by Syncthing while the agent writes into it, so a
blind write could destroy a note. Every write therefore goes through the vault
guard:

- the content is written to a temporary file and renamed over the target, so
  a reader never sees a half written note,
- when the file was just changed (the fs.watch based watcher sees it) the
  write waits a second before it starts,
- when the write fails because the file is locked, it is repeated every 500 ms,
- after the write the file is read back: if somebody changed it in the
  meantime, the write is repeated, and for an append the existing content is
  never lost,
- Syncthing conflict copies (`*.sync-conflict-*`) are reported.

### Stack

| Part | Technology |
| --- | --- |
| Bot | [grammY](https://grammy.dev), TypeScript, long polling |
| Agent | Hermes Agent (installed in the image), one shot mode |
| Vault tools | MCP server in Node, safe writes |
| Web search | DuckDuckGo MCP server (`uvx duckduckgo-mcp-server`) |
| Model | OpenCode Go relay through a local proxy |
| Database | SQLite (libSQL + Drizzle ORM), audit log of the notes |
| Sync | Syncthing (linuxserver image) |
| Tests | Vitest, Biome, husky + lint-staged, GitHub Actions |

### Installation on a server

Requirements: a Linux server with Docker and Docker Compose.

1. Clone the repository and go to the deploy folder:

   ```bash
   git clone https://github.com/danii1kq/telegram-to-obsidian_ai-agent.git
   cd telegram-to-obsidian_ai-agent/deploy
   ```

2. Create the environment file and fill in the values:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

   | Variable | Meaning |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | token from [@BotFather](https://t.me/BotFather) |
   | `ALLOWED_TELEGRAM_ID` | your Telegram user id, only this id is served |
   | `VAULT_HOST_PATH` | folder of the vault on the server, for example `/opt/obsidian-vault` |
   | `LLM_API_KEY` | key of the model provider |
   | `HERMES_MODEL` | model, `minimax-m3.1-flash-free` by default |
   | `HERMES_FALLBACK_MODEL` | model used when the first one fails |
   | `PUID` / `PGID` | owner of the notes, `1000` by default |

3. Prepare the vault folder and build the containers:

   ```bash
   mkdir -p /opt/obsidian-vault
   sudo chown -R 1000:1000 /opt/obsidian-vault
   docker compose up -d --build
   ```

4. Check that everything works:

   ```bash
   docker compose ps
   docker compose logs -f app
   ```

The first build installs Hermes Agent and takes a while. Later builds reuse
the cached layers.

### Syncthing and your laptop

1. The web interface of Syncthing is on the port 8384 of the server:

   ```bash
   ssh -L 8384:127.0.0.1:8384 user@your-server
   # then open http://127.0.0.1:8384
   ```

   Or open `http://your-server:8384` directly, if the firewall allows it.

2. In the web interface: `Actions` -> `Show ID`, this is the id of the server.

3. On your laptop: install Syncthing, add the server as a remote device with
   that id, accept the device on the server.

4. On the server: `Actions` -> `Add Folder`, path `/vault`, give it a name
   (for example `obsidian`) and share it with the laptop.

5. On the laptop: accept the folder and point your Obsidian vault to it.

After that the notes appear on the laptop within seconds, and the bot keeps
working on the server.

### Updates

```bash
git pull
docker compose up -d --build
```

The script `deploy/deploy.sh` does exactly that, and it rolls back to the
previous image when the new container does not become healthy.

### Local development

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

The bot needs a Telegram token, a model key and the Hermes Agent binary. The
smoke test of a deployment runs the whole pipeline without Telegram:

```bash
node dist/selftest.js "an idea for a business"
```

### Security

- The bot answers only the ids from `ALLOWED_TELEGRAM_ID`.
- The keys live in `deploy/.env` on the server, the file is not in git.
- The model key is injected by the local proxy, the agent never sees it.
- The MCP tools cannot write outside of the vault.

---

## Русский

### Что это делает

- Ты пишешь боту текст в Telegram.
- Бот передаёт его Hermes Agent, который работает с хранилищем через MCP-инструменты:
  - ищет заметку по той же теме,
  - дописывает мысль в конец этой заметки или создаёт новую,
  - новая заметка всегда начинается с фронтматтера Obsidian
    (`date` и `tags: [inbox, telegram]`),
  - названия уже существующих заметок превращаются в `[[вики-ссылки]]`.
- Если в сообщении нужны факты (незнакомый термин, цены, новости, вопрос),
  агент сначала ищет в интернете через MCP-сервер DuckDuckGo и записывает
  найденное в заметку вместе со ссылкой на источник.
- Бот отвечает одной короткой строкой: `Создал заметку "Идеи для бизнеса"`.

Бот работает только для владельца: сообщения с чужих id молча игнорируются.

### Почему заметки не теряются

Хранилище синхронизируется Syncthing, пока агент в него пишет, поэтому любая
запись идёт через защиту:

- содержимое пишется во временный файл и переименовывается поверх цели,
  поэтому читатель никогда не увидит наполовину записанную заметку;
- если файл только что менялся (это видно через fs.watch), запись ждёт секунду;
- если файл заблокирован, запись повторяется каждые 500 мс;
- после записи файл перечитывается: если его успел изменить синхронизатор,
  запись повторяется, а при добавлении текста старое содержимое не теряется;
- конфликтные копии Syncthing (`*.sync-conflict-*`) показываются в отчёте.

### Стек

| Часть | Технология |
| --- | --- |
| Бот | [grammY](https://grammy.dev), TypeScript, long polling |
| Агент | Hermes Agent (ставится в образ), одноразовый запуск |
| Инструменты хранилища | MCP-сервер на Node, безопасная запись |
| Поиск в интернете | DuckDuckGo MCP-сервер (`uvx duckduckgo-mcp-server`) |
| Модель | OpenCode Go через локальный прокси |
| База | SQLite (libSQL + Drizzle ORM), журнал заметок |
| Синхронизация | Syncthing (образ linuxserver) |
| Тесты | Vitest, Biome, husky + lint-staged, GitHub Actions |

### Установка на сервер

Нужен Linux-сервер с Docker и Docker Compose.

1. Клонируем репозиторий и переходим в папку `deploy`:

   ```bash
   git clone https://github.com/danii1kq/telegram-to-obsidian_ai-agent.git
   cd telegram-to-obsidian_ai-agent/deploy
   ```

2. Создаём файл окружения и заполняем значения:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

   | Переменная | Значение |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | токен от [@BotFather](https://t.me/BotFather) |
   | `ALLOWED_TELEGRAM_ID` | твой Telegram id, только он обслуживается |
   | `VAULT_HOST_PATH` | папка хранилища на сервере, например `/opt/obsidian-vault` |
   | `LLM_API_KEY` | ключ модельного провайдера |
   | `HERMES_MODEL` | модель, по умолчанию `minimax-m3.1-flash-free` |
   | `HERMES_FALLBACK_MODEL` | резервная модель, если основная не ответила |
   | `PUID` / `PGID` | владелец файлов заметок, по умолчанию `1000` |

3. Готовим папку хранилища и собираем контейнеры:

   ```bash
   mkdir -p /opt/obsidian-vault
   sudo chown -R 1000:1000 /opt/obsidian-vault
   docker compose up -d --build
   ```

4. Проверяем, что всё работает:

   ```bash
   docker compose ps
   docker compose logs -f app
   ```

Первая сборка ставит Hermes Agent и идёт долго, дальше используются кэшированные слои.

### Syncthing и ноутбук

1. Веб-интерфейс Syncthing на порту 8384 сервера:

   ```bash
   ssh -L 8384:127.0.0.1:8384 user@your-server
   # открыть http://127.0.0.1:8384
   ```

   Или сразу `http://your-server:8384`, если firewall это разрешает.

2. В веб-интерфейсе: `Actions` -> `Show ID`, это id сервера.

3. На ноутбуке: ставим Syncthing, добавляем сервер как удалённое устройство с этим
   id и подтверждаем устройство на сервере.

4. На сервере: `Actions` -> `Add Folder`, путь `/vault`, имя папки (например
   `obsidian`), отдаём доступ ноутбуку.

5. На ноутбуке: подтверждаем папку и указываем в Obsidian именно на неё.

Через несколько секунд заметки появляются на ноутбуке, а бот продолжает работать
на сервере.

### Обновление

```bash
git pull
docker compose up -d --build
```

Скрипт `deploy/deploy.sh` делает то же самое и откатывается на прошлый образ,
если новый контейнер не стал здоровым.

### Локальная разработка

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

Проверка всей цепочки без Telegram:

```bash
node dist/selftest.js "идея для бизнеса"
```

### Безопасность

- Бот отвечает только ids из `ALLOWED_TELEGRAM_ID`.
- Ключи лежат в `deploy/.env` на сервере, в git их нет.
- Ключ модели подставляет локальный прокси, агент его не видит.
- MCP-инструменты не могут писать за пределы хранилища.

---

## License

MIT. The Obsidian skill is a part of Hermes Agent (MIT, Teknium).
