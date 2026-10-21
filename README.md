# Telegram to Obsidian AI Agent

A private Telegram bot that turns short thoughts into notes of an Obsidian
vault. The bot is the front end, [Hermes Agent](https://hermes-agent.nousresearch.com)
is the brain, and the vault is the memory. The vault is synchronised between
the server and your laptop with Syncthing, so the notes are available
everywhere and are never locked by the bot.

The bot also keeps a small web app inside Telegram, so the notes can be read
from the phone without opening Obsidian, and it writes a summary of every day
into the file of the month.

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
- A file that comes with the message (a photo, a document, a video, a voice
  message) is saved into the `attachments` folder of the vault and embedded
  into the note as `![[2026-10-22_photo_abc.jpg]]`.
- At midnight the agent writes a summary of the day into the file of the month,
  and the summary comes to the chat as well.
- The notes are a small web app inside Telegram: the button in the menu of the
  chat opens the list of the notes, the search and the reading of a note.

Only the owner of the bot is allowed to use it: every message from another
user id is dropped without an answer.

### Commands

| Command | What it does |
| --- | --- |
| `/start`, `/help` | the short description of the bot |
| `/status` | the last notes the bot wrote |
| `/search coffee` | searches the vault by the name of a note and by the text inside the notes |
| `/inbox` | lists the notes that still carry the `inbox` tag |
| `/undo` | undoes the last write of the bot: an appended block is removed, an overwritten note gets its old content back, a created note is deleted |
| `/undo confirm` | deletes a created note that was changed after the bot wrote it |
| `/summary` | makes the summary of yesterday right now |
| `/summary 2026-10-20` | makes the summary of that day |

Tags are written in the message itself: `#idea #work` end up in the
`tags` field of the frontmatter of the note, next to `inbox` and `telegram`.

### The daily summary

At midnight, in the time zone of the owner, the agent looks at the notes of
the day that is over and writes a short summary of it into the file of the
month, `october_2026.md` for example:

```markdown
---
date: 2026-10-01
tags: [journal, daily]
---

# Октябрь 2026

## 2026-10-21

Дописал заметку о проекте, придумал идею для нового продукта.
```

Every day is a section of its own. A day without a note is simply missing in
the file, and the summary also comes to the chat of the owner. When the bot
was down at midnight, the missing summaries are made after the restart.

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

The paths of the tools are resolved against the root of the vault, so a tool
call of the agent cannot write outside of it. The agent of the daily summary
gets the same tools, but every write it does is taken back: only the file of
the month is changed by the summary.

### Stack

| Part | Technology |
| --- | --- |
| Bot | [grammY](https://grammy.dev), TypeScript, long polling or a webhook |
| Agent | Hermes Agent (installed in the image), one shot mode |
| Vault tools | MCP server in Node, safe writes |
| The vault MCP server as a package | [`@danii1kq/vault-mcp`](packages/vault-mcp), it works with any MCP client |
| Web search | DuckDuckGo MCP server (`uvx duckduckgo-mcp-server`) |
| Model | OpenCode Go relay through a local proxy |
| Database | SQLite (libSQL + Drizzle ORM), audit log of the notes |
| Sync | Syncthing (linuxserver image) |
| The Mini App | React and Vite, served by the bot |
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
   | `TELEGRAM_MODE` | `polling` by default, `webhook` when the bot has a public https address |
   | `TELEGRAM_WEBHOOK_URL` | the public https address of the webhook, for the webhook mode |
   | `TELEGRAM_WEBHOOK_SECRET` | the secret that Telegram sends with every webhook call |
   | `VAULT_HOST_PATH` | folder of the vault on the server, for example `/opt/obsidian-vault` |
   | `LLM_API_KEY` | key of the model provider |
   | `HERMES_MODEL` | model, `minimax-m3.1-flash-free` by default |
   | `HERMES_FALLBACK_MODEL` | model used when the first one fails |
   | `MINI_APP_URL` | the public https address of the Mini App, for the menu button |
   | `MINI_APP_TOKEN` | the token for the browser, the address of the app carries it |
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

The image is in the registry as well, so a deployment can skip the build:

```bash
docker pull ghcr.io/danii1kq/telegram-to-obsidian_ai-agent:latest
```

### The Mini App

The notes are also a small web app inside Telegram. The button in the menu of
the chat opens it: the list of the notes, the search and the reading of a note
with its pictures. The app follows the theme of Telegram, so it looks the same
in the light and in the dark mode.

The data is never given away: the Mini App sends the signed data of Telegram
and the backend checks it with the token of the bot. Outside of Telegram there
is no signed data, so the address of the app carries the token of the owner:

```
https://<your-host>/?token=<MINI_APP_TOKEN>
```

The frontend lives in `web/`, it is built with Vite and served by the same
process that runs the bot.

Telegram accepts only https links for a Mini App, so the app is published
through a Cloudflare tunnel. The script `deploy/tunnel.sh` starts the tunnel,
watches its address and writes it into the environment file of the deployment:

```bash
bash deploy/tunnel.sh --install
```

The same tunnel can carry the webhook of the bot: set `TELEGRAM_MODE=webhook`
and `TELEGRAM_WEBHOOK_URL=https://<the address of the tunnel>/webhook`.

### The vault MCP server as a package

The tools of the vault work with any MCP client, not only with the bot. They
are published as a separate package:

```bash
npm install -g @danii1kq/vault-mcp
OBSIDIAN_VAULT_PATH=/path/to/vault vault-mcp
```

The description of the package is in [packages/vault-mcp](packages/vault-mcp).

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

The frontend of the Mini App lives in `web/`:

```bash
cd web
npm install
npm run dev     # the dev server on the port 5173
npm run build
```

The MCP server of the vault is a package of its own, it is built like this:

```bash
npm run build --prefix packages/vault-mcp
```

The bot needs a Telegram token, a model key and the Hermes Agent binary. The
smoke test of a deployment runs the whole pipeline without Telegram:

```bash
node dist/selftest.js "an idea for a business"
```

### The project

- [CONTRIBUTING.md](CONTRIBUTING.md) - how to work with the project, the rules
  of the code and the commits.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - the rules of the behaviour.
- [SECURITY.md](SECURITY.md) - how to report a problem with the security.
- [CHANGELOG.md](CHANGELOG.md) - what changed in every version.
- The releases are made with a tag: the workflow builds the image, puts it in
  the registry of GitHub and publishes the notes of the release.

### Security

- The bot answers only the ids from `ALLOWED_TELEGRAM_ID`.
- The keys live in `deploy/.env` on the server, the file is not in git.
- The model key is injected by the local proxy, the agent never sees it.
- The MCP tools cannot write outside of the vault.
- The API of the Mini App checks the signed data of Telegram with the token of
  the bot, outside of Telegram it needs the token of the owner.
- The webhook of the bot checks the secret that Telegram sends with every
  call.
- The files of the owner are stored in the vault, the bot never sends them
  anywhere.

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
- Файл, который пришёл вместе с сообщением (фото, документ, видео, голосовое),
  сохраняется в папку `attachments` хранилища и вставляется в заметку как
  `![[2026-10-22_photo_abc.jpg]]`.
- В полночь агент пишет вывод за день в файл месяца, и этот вывод приходит
  ещё и в чат.
- Заметки доступны как маленькое веб-приложение внутри Telegram: кнопка в
  меню чата открывает список заметок, поиск и чтение заметки.

Бот работает только для владельца: сообщения с чужих id молча игнорируются.

### Команды

| Команда | Что делает |
| --- | --- |
| `/start`, `/help` | короткое описание бота |
| `/status` | последние записанные заметки |
| `/search кофе` | ищет по названию заметки и по тексту внутри заметок |
| `/inbox` | показывает заметки с тегом `inbox` |
| `/undo` | отменяет последнюю запись бота: дописанный блок убирается, перезаписанная заметка получает прежнее содержимое, созданная заметка удаляется |
| `/undo confirm` | удаляет созданную заметку, которую меняли после записи бота |
| `/summary` | делает итог за вчера прямо сейчас |
| `/summary 2026-10-20` | делает итог за этот день |

Теги пишутся прямо в сообщении: `#идея #работа` попадают в поле `tags`
фронтматтера заметки рядом с `inbox` и `telegram`.

### Итог дня

В полночь, по времени владельца, агент смотрит на заметки прошедшего дня и
записывает короткий вывод в файл месяца, например `october_2026.md`:

```markdown
---
date: 2026-10-01
tags: [journal, daily]
---

# Октябрь 2026

## 2026-10-21

Дописал заметку о проекте, придумал идею для нового продукта.
```

Каждый день - отдельный раздел. Дня без заметок в файле просто нет, и вывод
приходит ещё и в чат. Если бот был выключен в полночь, недостающие итоги
досчитываются после запуска.

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

Пути инструментов разрешаются относительно корня хранилища, поэтому агент не
может записать за его пределы. У агента ночного итога те же инструменты, но
все его записи откатываются: итог меняет только файл месяца.

### Стек

| Часть | Технология |
| --- | --- |
| Бот | [grammY](https://grammy.dev), TypeScript, long polling или webhook |
| Агент | Hermes Agent (ставится в образ), одноразовый запуск |
| Инструменты хранилища | MCP-сервер на Node, безопасная запись |
| MCP-сервер хранилища отдельным пакетом | [`@danii1kq/vault-mcp`](packages/vault-mcp), работает с любым MCP-клиентом |
| Поиск в интернете | DuckDuckGo MCP-сервер (`uvx duckduckgo-mcp-server`) |
| Модель | OpenCode Go через локальный прокси |
| База | SQLite (libSQL + Drizzle ORM), журнал заметок |
| Синхронизация | Syncthing (образ linuxserver) |
| Мини-приложение | React и Vite, раздаётся ботом |
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
   | `TELEGRAM_MODE` | по умолчанию `polling`, `webhook`, когда у бота есть публичный https-адрес |
   | `TELEGRAM_WEBHOOK_URL` | публичный https-адрес webhook, для режима webhook |
   | `TELEGRAM_WEBHOOK_SECRET` | секрет, который Telegram шлёт с каждым вызовом webhook |
   | `VAULT_HOST_PATH` | папка хранилища на сервере, например `/opt/obsidian-vault` |
   | `LLM_API_KEY` | ключ модельного провайдера |
   | `HERMES_MODEL` | модель, по умолчанию `minimax-m3.1-flash-free` |
   | `HERMES_FALLBACK_MODEL` | резервная модель, если основная не ответила |
   | `MINI_APP_URL` | публичный https-адрес мини-приложения, для кнопки в меню |
   | `MINI_APP_TOKEN` | токен для браузера, он едет в адресе приложения |
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

Образ есть и в реестре, так что при деплое можно не собирать его заново:

```bash
docker pull ghcr.io/danii1kq/telegram-to-obsidian_ai-agent:latest
```

### Мини-приложение

Заметки доступны ещё и как маленькое веб-приложение внутри Telegram. Кнопка
в меню чата открывает его: список заметок, поиск и чтение заметки вместе с
картинками. Приложение следует теме Telegram, поэтому в светлой и в тёмной
теме выглядит одинаково хорошо.

Данные никому не отдаются: мини-приложение присылает подписанные данные
Telegram, а бэкенд проверяет их токеном бота. Вне Telegram подписанных данных
нет, поэтому в адрес приложения добавляется токен владельца:

```
https://<your-host>/?token=<MINI_APP_TOKEN>
```

Фронтенд лежит в `web/`, он собирается через Vite и раздаётся тем же
процессом, который работает ботом.

Telegram принимает для мини-приложения только https-ссылки, поэтому
приложение публикуется через туннель Cloudflare. Скрипт `deploy/tunnel.sh`
поднимает туннель, следит за его адресом и записывает его в файл окружения
деплоя:

```bash
bash deploy/tunnel.sh --install
```

Через тот же туннель можно провести и webhook бота: поставь
`TELEGRAM_MODE=webhook` и `TELEGRAM_WEBHOOK_URL=https://<адрес туннеля>/webhook`.

### MCP-сервер хранилища отдельным пакетом

Инструменты хранилища работают с любым MCP-клиентом, не только с ботом. Они
опубликованы отдельным пакетом:

```bash
npm install -g @danii1kq/vault-mcp
OBSIDIAN_VAULT_PATH=/path/to/vault vault-mcp
```

Описание пакета лежит в [packages/vault-mcp](packages/vault-mcp).

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

Фронтенд мини-приложения лежит в `web/`:

```bash
cd web
npm install
npm run dev     # dev-сервер на порту 5173
npm run build
```

MCP-сервер хранилища собирается как отдельный пакет:

```bash
npm run build --prefix packages/vault-mcp
```

Проверка всей цепочки без Telegram:

```bash
node dist/selftest.js "идея для бизнеса"
```

### Проект

- [CONTRIBUTING.md](CONTRIBUTING.md) - как работать с проектом, правила кода
  и коммитов.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - правила поведения.
- [SECURITY.md](SECURITY.md) - как сообщить о проблеме с безопасностью.
- [CHANGELOG.md](CHANGELOG.md) - что менялось в каждой версии.
- Релизы делаются тегом: workflow собирает образ, кладёт его в реестр GitHub
  и публикует заметки релиза.

### Безопасность

- Бот отвечает только ids из `ALLOWED_TELEGRAM_ID`.
- Ключи лежат в `deploy/.env` на сервере, в git их нет.
- Ключ модели подставляет локальный прокси, агент его не видит.
- MCP-инструменты не могут писать за пределы хранилища.
- API мини-приложения проверяет подписанные данные Telegram токеном бота, а
  вне Telegram требует токен владельца.
- Webhook бота проверяет секрет, который Telegram шлёт с каждым вызовом.
- Файлы владельца лежат в хранилище, бот никуда их не отправляет.

---

## License

MIT. The Obsidian skill is a part of Hermes Agent (MIT, Teknium).
