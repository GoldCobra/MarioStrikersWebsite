# 0014: One SQL core for the database next to the API

Status: accepted (2026-11-22)

## Context

The API's database moved from an external host to the SQL Server container on
the same server. The data layer still carried the external host: a keepalive
query every 25 seconds, a JSON copy of the public datasets on disk for slow
restarts, TLS 1.0 and port 443 as defaults with a probe tool to choose them,
and the driver's default check of every lent-out connection with an extra
`SELECT 1`. About a hundred statements were built from string arrays with
hand-named `request.input` calls, each module with its own row helpers, and the
WHR ladder parsed the Discord text lines of the bot's `GetRatingsForDiscord`
procedure and joined them back to players by a name it cuts after 22
characters. Measured on the live site, pages did not wait for the database
(1–20 ms a statement) but for Discord.

## Decision

- **Statements are tagged templates** (`db/sql.ts`): every interpolated value
  is a parameter, never text; fragments compose (`sql.join`, `sql.list`);
  a value's type follows from its JavaScript type (strings as
  NVARCHAR(4000), so a statement keeps one plan) or is given (`t.nvarchar`,
  `t.dateTime2`, …) where a column needs it.
- **One database object** (`db/database.ts`) runs them: `rows`, `row`,
  `sets` (a batch's result sets) and `execute`, and `transaction(work)` with
  an optional retry after a deadlock. Every connection runs with
  `XACT_ABORT ON`; lent-out connections are checked by their socket; a
  statement slower than 500 ms is logged. No statement changes a session
  setting: the driver lends a connection out again as it is, so a `SET` would
  reach every later statement on it (a test scans the sources). A transaction
  that pauses the player activity triggers (`skipPlayerActivity`) gets a
  connection of its own that is closed afterwards, so the session flag never
  reaches another statement, even when the server rolled the transaction back.
- **Each module owns its SQL** in `repository.ts` with typed rows; services,
  rules and mappers hold no SQL; tests answer statements through
  `test-support/fake-database.ts`.
- **Data is read by id from its tables**: the WHR ladder reads
  `dbo.PlayerStats` with the procedure's rules instead of its text lines.
- **Nothing waits on Discord or the disk**: the public datasets live in
  memory and are read again at start; member names come from the member list
  read in the background (`integrations/discord/guild-members.ts`).
- **One-off migrations are deleted once applied**; git and the ADRs keep
  their history. `ops/` keeps the recurring tools (`check-db`,
  `player-titles`, `title-sync`, `title-test-unlocks`).

## Consequences

- No ORM: the schema belongs to the bots as much as to the website, and every
  statement stays visible SQL that can be read next to theirs.
- Row types are declared, not checked at run time; a schema change by a bot
  needs the repository's types and mappers changed with it.
- Logs name a slow statement by its text, never its values.
- A restart serves its first public responses after one round of reads
  (milliseconds) instead of from a file.
