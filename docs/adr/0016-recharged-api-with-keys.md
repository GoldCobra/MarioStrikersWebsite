# 0016: The Recharged API gives the Recharged WFC server MSC rated, behind keys

Status: accepted (2026-11-27)

## Context

Recharged, the MSC PC port, has its own online play (Recharged WFC). It is to
take over MSC rated from futbot's Discord queue, with the current ELO system
and one hard reset of MSC at the switch. Its server needs the ratings and the
ranks, and it must deliver match results. It runs elsewhere and reaches the API
from the internet, so what it may do has to hang on a secret that can be
replaced, and nothing it sends may reach SMS or MSBL. The leaderboards are
public already (`/api/leaderboards/msc/elo1v1`); profiles go by player id, not
by Discord id, and the rank ladder is not served at all.

## Decision

- **Routes under `/api/recharged/v1/`** (`modules/recharged/`), versioned for a
  client outside the project: a player's MSC 1v1 rating of the active season by
  Discord id (hidden statistics stay hidden, as on the website), the rank ladder
  from `CompetitiveRankThreshold`, match reports and their status. The
  leaderboards stay the public routes. The contract for the Recharged team is
  [docs/recharged-api.md](../recharged-api.md).
- **Keys**: 256 random bits (`rch_test_…`, `rch_live_…`), written by
  `npm run ops:recharged-key` into a file of their own and never printed. The
  server keeps only their SHA-256 (`RECHARGED_API_KEYS`), compares in constant
  time, and the logger redacts the Authorization header. Without keys no route
  exists; a wrong setting is logged and keeps the routes off instead of stopping
  the API. Limits count per key. A key belongs on the Recharged server, never in
  the game client.
- **Test and live apart**: a test key's reports are stored as `test` and are
  never rated, a live key's start as `pending`; a check constraint ties status
  and environment, and each environment has its own match ids.
- **Reports are stored, not rated**, in `rocci121_toby.ExternalMatchReport`
  (additive; `npm run ops:recharged-schema`, one checked transaction, deleted
  once applied as ADR 0014 says). Its checks allow MSC 1v1 only, no draw, two
  different Discord ids in `dbo.Player.DiscordID`'s collation and the API's
  match id characters, compared exactly. The same report again is answered with
  the stored one; the same match id with other values is refused (409).
- **futbot stays the only writer of ratings.** Rating the stored reports (the way
  `/report1v1` does), the live key, the hard reset and switching futbot's MSC
  queue off come later, planned with the Recharged team.

## Consequences

- Until that step a report changes no rating and posts nothing to Discord; the
  API only reads futbot's tables.
- futbot's `RatedMatch.MatchCode` holds 24 characters, so the rating step names
  a match after the report's `Id` (`recharged:<Id>`), not after the outside id.
- futbot counts `CompetitivePlayerRating.PlacementPlayed` (TINYINT) on every
  rated match without a cap; with automatic reports a player can reach 255 in a
  season, so the rating step needs the cap first.
- A key is replaced by adding the new entry, handing it over and removing the
  old one; each change of `RECHARGED_API_KEYS` restarts the backend.
