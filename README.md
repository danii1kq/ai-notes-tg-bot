# ai-notes-tg-bot

Telegram-бот для работы с AI-заметками. Стек и код бота — в процессе разработки.

## Структура

```
app/                 код приложения
deploy/              Docker-образ, compose и скрипты деплоя на VDS
```

## Локальный запуск

```bash
cd app
npm install
npm start
```

## Деплой

```powershell
.\deploy\deploy.ps1 -Message "feat: описание"
```

Полный runbook — [`deploy/README.md`](deploy/README.md).

## Стек сервера

VDS `<server>` (Ubuntu 26.04, Docker 29.9.1, Compose v5.6.0), проект развёрнут в
`/opt/ai-notes-tg-bot`, публикация кода через `git pull` + `docker compose up -d`.
