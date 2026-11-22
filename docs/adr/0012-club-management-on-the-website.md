# 0012: Club management on the website, the bot performs its effects

Status: accepted (2026-11-19); built in steps — the schema first, then the API, the page and the bot

## Context

Striker Clubs (mainly a Mario Strikers: Battle League feature) were managed only
through Robotic Nightmare's `/club` commands, on `dbo.Club` and `dbo.ClubRoster`
and a set of legacy procedures. Their gaps showed in the data: owners could leave
without anyone taking over (18 clubs have no acting captain), members could be
added without their consent, and a deleted club's tag stayed in its former
members' nicknames. The community decided to manage clubs on the website only
("My Club", behind the Discord login), with agreed rules for roles, invitations,
joining, leaving, succession and the life of new clubs; `/club info` and
`/club list` stay in Discord.

## Decision

- **One writer.** The website API is the only writer of club state. Every rule
  lives once, in `apps/api/src/modules/clubs/`, and is tested there; the bot
  keeps reading clubs but no longer changes them.
- **The database is the backstop.** One club per player (the primary key of
  `dbo.ClubRoster`), unique tags (`IX_Club`), unique names (`UX_Club_ClubName`),
  unique club ids and one open invitation per club and player are indexes, so
  two clicks or two systems cannot break them. Every change starts by locking
  the club's row (`UPDLOCK, HOLDLOCK`), so limits such as the number of officers
  cannot race.
- **A backend club id.** `dbo.Club.PublicId`: eight characters of letters and
  digits without the look-alikes 0, O, 1, l and I, case-sensitive (binary
  collation), unique, free again after a deletion. The numeric `Club.ID` stays
  the key of everything public (URLs, the logo route, futbot, the bot's API).
- **An outbox to the bot.** Every change writes its events into `dbo.ClubEvent`
  in the same transaction, each with a snapshot of what the effect needs (club
  name and tag, the recipients, the old tag of a deleted or renamed club).
  Robotic Nightmare works them off: DMs, the club tag in nicknames and the posts
  in #club-transfers. It never decides; the Accept/Decline buttons of an
  invitation DM call an internal route of the API (outside `/api/`, so nginx
  never exposes it) with a shared secret.
- **One mode for both systems.** `dbo.ClubSystemState` holds `off`, `admins`
  (My Club for confirmed admins only, for tests on the live site) or `on`. The
  bot reads it before every `/club` write command; the API caches it briefly
  for reads and reads it again inside every change's transaction, with a shared
  lock held to the end, so a switch waits for running changes. One update
  closes the bot's write commands and opens the website without the two ever
  being open together.
- **Additive schema** (applied 2026-11-19 by `ops:club-schema`, removed after it ran):
  new columns and tables only. The legacy procedures stay as they are; they
  write with column lists, so new columns with defaults or NULL break none of
  them. `dbo.Club` gets no trigger (a legacy procedure reads `@@IDENTITY`, the
  bot uses a plain `OUTPUT` on it) and the new tables no foreign keys to the
  legacy ones.
- **Logos in the database** (`dbo.ClubLogo`): an uploaded logo is decoded,
  re-encoded and stored with its hash; the existing logo route serves it, and
  the nightly database backup covers it.

## Consequences

- A rule change is a change in one module, released like any website change;
  the bot needs a release only for new kinds of effects.
- Effects are best effort and may come a few seconds after the change; a failed
  DM never undoes it. The event rows keep what the bot did, so a restart does
  not repeat a DM it already sent.
- Until the mode is `on`, the bot's old commands keep working for everyone, and
  the new columns' defaults give the clubs it creates an id and mark them as
  established.
- Removing the legacy procedures and the logo links in `dbo.Club.Logo` is a
  later clean-up of its own.
