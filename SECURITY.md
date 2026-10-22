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
- the webhook of the bot checks the secret that Telegram sends with every
  call, and the secret is required in the webhook mode,
- the writes of the agent are atomic, so Syncthing never sees a half written
  note.

If you find a way around one of these rules, it is a problem with the security
of the project, please report it in private.

## The Mini App

The Mini App is a web app inside Telegram and it is open to the internet, so
it is protected in layers:

- every request of the API is checked: the signed data of Telegram, the
  session of the app or the token of the owner,
- the session is a random value of 24 bytes, it lives in a cookie with
  `HttpOnly`, `SameSite=Strict` and `Secure` over https, it is over after a
  day and there are at most fifty of them,
- the token of the owner is exchanged for a session and taken out of the
  address of the page, so it does not stay in the history of the browser,
- the answers carry the security headers: the policy of the content, `nosniff`,
  the referrer policy and the policy of the permissions,
- the text of a note is cleaned with DOMPurify before it becomes html,
- a file of the owner is never a page: only the pictures are shown as
  pictures, everything else comes as a download with `nosniff`.

## The server

- The web interface of Syncthing is not open to the internet. The owner
  reaches it through an ssh tunnel: `ssh -L 8384:127.0.0.1:8384 user@server`.
  The port of the synchronisation stays open, it is protected by the keys of
  the devices.
- The health endpoint listens on `127.0.0.1` only.
- The Mini App listens on the port 8091 and is reached through the tunnel.
- The container of the bot runs as an unprivileged user, the volume of the
  notes is the only thing it may write.
- The file of the environment is mode 600 and is never in the repository.

## The audit of the 22nd of October 2026

The code was checked with the rules of the security review. The problems that
were found and what was done with them:

| Problem | What was done |
| --- | --- |
| The notes were put into the page with `dangerouslySetInnerHTML` | The html is cleaned with DOMPurify, only the marks of a note are allowed |
| A file of the owner could be sent as a page and run in the origin of the app | Only the pictures are shown as pictures, everything else comes as a download with `nosniff` |
| The webhook worked without the secret, so anybody could send updates as the owner | The secret is required in the webhook mode, the app does not start without it |
| The web interface of Syncthing was open to the internet without a password | The port is bound to `127.0.0.1`, the owner reaches it through an ssh tunnel |
| The answers of the app had no security headers | The policy of the content, `nosniff`, the referrer policy and the policy of the permissions are sent with every answer |
| The token of the owner stayed in the address of the page | It is exchanged for a session and taken out of the address |
| The cookie of the session had no flag `Secure` | The flag is set when the request comes over https |
| The token of the bot and the key of the model could land in the log | The logger hides the token of the bot, the key of the model, the header of the authorization and the token in an address |
| The search pattern of the vault had no limit | The pattern is cut at 200 characters, so a slow expression cannot take the process down |
| The sessions of the app were never thrown away | The sessions over their time are removed, there are at most fifty |
| A null byte in a message broke the start of the agent | The null bytes are cut out of the prompt |
