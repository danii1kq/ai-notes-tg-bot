# Changelog

The format of this file follows [Keep a Changelog](https://keepachangelog.com),
the project follows [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.1.0] - 2026-10-22

The first release of the bot: a private Telegram bot that turns the messages
of the owner into the notes of an Obsidian vault.

### Added

- The bot in Telegram: the messages become notes, the agent of Hermes looks
  for a note about the same topic, appends to it or creates a new one.
- The vault tools as an MCP server with safe writes: an atomic rename, a
  retry when the file is locked, a check after the write and a report about
  the conflict copies of Syncthing.
- The web search through the DuckDuckGo MCP server, when the message needs
  facts.
- The commands `/search`, `/inbox`, `/undo`, `/summary` and `/status`.
- The tags of a message (`#idea`) in the frontmatter of the note.
- The files of the owner: a photo or a document is saved into the folder
  `attachments` and embedded into the note.
- The summary of the day: at midnight the agent writes a short summary into
  the file of the month, `october_2026.md`, one section per day.
- The Mini App: the notes as a small web app inside Telegram, with the search
  and the reading of a note.
- The webhook mode, next to the long polling.
- The audit log of the notes in SQLite and the undo of the last write.
- The deployment on a server with Docker Compose, with a rollback to the
  previous image.

[Unreleased]: https://github.com/danii1kq/telegram-to-obsidian_ai-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/danii1kq/telegram-to-obsidian_ai-agent/releases/tag/v0.1.0
