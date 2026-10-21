# Security policy

## The supported versions

The project is young and the versions come fast. The fix of a problem always
lands in the newest release.

| Version | Supported |
| --- | --- |
| 0.1.x | yes |
| < 0.1 | no |

## The reporting of a problem

Do not open a public issue for a problem with the security. Write to the
maintainer instead, the address is in the profile of the author of the
repository. The report should have:

- what the problem is and what an attacker gets from it,
- the steps to repeat it,
- the version of the project and of the deployment.

The maintainer answers within a few days and releases a fix as soon as it is
ready. Please give the maintainer a few days before the report becomes
public.

## What the project does with the secrets

The bot holds three secrets and none of them belongs in the repository:

| Secret | Where it lives | Who sees it |
| --- | --- | --- |
| The token of the bot | `deploy/.env` on the server, mode 600 | the bot, the server |
| The key of the model | `deploy/.env`, injected by the local proxy | the proxy, never the agent |
| The id of the allowed user | `deploy/.env` | the bot |

The keys are not written into the notes and they are redacted from the logs.

## The boundaries of the agent

The agent of the owner runs with tools, so the project keeps the boundaries
small and checks them:

- the tools of the vault may not write outside of the folder of the vault, the
  path is resolved and checked before every write,
- the model key is added by a local proxy, the agent never sees it,
- the bot answers only the user ids from `ALLOWED_TELEGRAM_ID`,
- the API of the Mini App checks the signed data of Telegram with the token of
  the bot, and outside of Telegram it needs the token of the owner,
- the writes of the agent are atomic, so Syncthing never sees a half written
  note.

If you find a way around one of these rules, it is a problem with the security
of the project, please report it in private.
