# Recharged API (v1)

The API the Recharged WFC server uses for MSC rated on mariostrikers.gg: a
player's rating and rank, the rank ladder, and match results
([ADR 0016](adr/0016-recharged-api-with-keys.md)).

**Current stage:** reports are checked and stored, but not rated yet. Rating
them with the current ELO system is the next stage, planned together; until
then a report changes no rating.

## Access

- Base URL: `https://mariostrikers.gg/api/recharged/v1` (HTTPS only).
- Every request sends the key: `Authorization: Bearer <key>`.
- There are two kinds of key. A **test key** (`rch_test_…`) may be used freely:
  its reports are kept apart and are never rated. A **live key** (`rch_live_…`)
  comes with the switch to rated play.
- Keep keys on the Recharged server only: never in the game client, a
  repository or a log. A key that may have leaked is replaced on request.
- The Discord ids you send must come from Recharged's Discord login, so they are
  the players' verified accounts.
- Answers are JSON with snake_case keys and `Cache-Control: no-store`.
- Limits per key and minute: `GET /players` 600, `GET /ranks` 60,
  `POST /matches` 120, `GET /matches` 600. The `x-ratelimit-*` headers show the
  state; beyond a limit the answer is `429` with `retry-after`.

## Errors

Every error is `{ "error": "<message>", "code": "<CODE>" }`; a `429` also has
`retryAfter`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | A value breaks a rule; the message names the field |
| 400 | `FST_ERR_CTP_INVALID_JSON_BODY` | The body is not valid JSON |
| 401 | `INVALID_API_KEY` | No key, or not a valid one |
| 404 | `PLAYER_NOT_FOUND` | No player is linked to this Discord account |
| 404 | `MATCH_NOT_FOUND` | No report with this `match_id` for this key's kind |
| 404 | `NOT_FOUND` | Unknown path |
| 409 | `MATCH_ID_CONFLICT` | The `match_id` was already reported with other values |
| 413 | `FST_ERR_CTP_BODY_TOO_LARGE` | The body is larger than 16 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | A report not sent as `application/json` |
| 429 | `RATE_LIMITED` | Over the limit |
| 500 | `INTERNAL` | Our side failed; try again later |

## GET /players/{discord_id}

A player's MSC 1v1 rating in the current season.

```http
GET /api/recharged/v1/players/195905866527014912
Authorization: Bearer rch_test_…
```

```json
{
  "player": {
    "discord_id": "195905866527014912",
    "player_id": 223,
    "name": "GoldCobra",
    "stats_hidden": false,
    "msc_1v1": {
      "season": { "id": 3, "name": "Dusk Season 2026", "ends_at": "2026-12-02T08:00:00.000Z" },
      "elo": 812,
      "rank": { "number": 5, "name": "Silver II" },
      "placement": { "played": 5, "required": 5, "complete": true },
      "wins": 12,
      "losses": 7
    }
  }
}
```

- `msc_1v1` is `null` when the player hides their statistics (`stats_hidden`)
  and between two seasons.
- A player without a rated MSC 1v1 match this season has rank 0 (`Unranked`),
  the starting ELO and `placement.played` 0.
- During placement the rank stays 0; afterwards it is the highest rank whose
  `min_elo` the ELO reaches (see `/ranks`).
- `elo` is rounded to a whole number. `wins` and `losses` count rated matches
  this season.

## GET /ranks

The rank ladder.

```json
{
  "default_elo": 500,
  "placement_matches": 5,
  "ranks": [
    { "number": 0, "name": "Unranked", "tier": "Unranked", "min_elo": 500 },
    { "number": 1, "name": "Bronze I", "tier": "Bronze", "min_elo": 500 },
    { "number": 2, "name": "Bronze II", "tier": "Bronze", "min_elo": 570 },
    { "number": 19, "name": "Strikers Titan", "tier": "Titan", "min_elo": 2015 }
  ]
}
```

The example is shortened; the answer lists every rank from 0 to 19.

## POST /matches

Reports one rated MSC 1v1 match.

```http
POST /api/recharged/v1/matches
Authorization: Bearer rch_test_…
Content-Type: application/json

{
  "match_id": "wfc-2026-11-27-000123",
  "played_at": "2026-11-27T18:04:11Z",
  "player1": { "discord_id": "195905866527014912", "score": 2 },
  "player2": { "discord_id": "329703291980087296", "score": 1 }
}
```

| Field | Rule |
| --- | --- |
| `match_id` | Your id of the match: 1 to 64 letters, digits or `. _ : -`, starting with a letter or digit; exact (case-sensitive) |
| `played_at` | When the match ended: ISO 8601 with seconds and an offset (`Z` or `+02:00`); at most 5 minutes ahead of our clock and 30 days back; stored in whole seconds |
| `player1`, `player2` | `discord_id`: the player's Discord id as a string of 15 to 20 digits; `score`: whole number 0 to 99. Two different players, never a draw |

The answer is the stored report: `201` when it is new, `200` when the same
report had been sent before (`"created": false`, nothing changed). A delivery
can therefore be repeated safely, for example after a timeout. The same
`match_id` with other values is refused with `409`. Test and live reports have
separate `match_id`s.

```json
{
  "created": true,
  "report": {
    "match_id": "wfc-2026-11-27-000123",
    "environment": "test",
    "status": "test",
    "played_at": "2026-11-27T18:04:11.000Z",
    "received_at": "2026-11-27T18:04:12.532Z",
    "processed_at": null,
    "player1": { "discord_id": "195905866527014912", "score": 2 },
    "player2": { "discord_id": "329703291980087296", "score": 1 }
  }
}
```

`status` is `test` for a test key's report (final, never rated) and `pending`
for a live key's report. Live reports will become `rated` or `rejected` in the
next stage.

## GET /matches/{match_id}

A stored report, as `POST /matches` answers it (without `created`), for the
kind of key that asks.

## Without a key

These public routes need no key:

- `GET https://mariostrikers.gg/api/leaderboards/msc/elo1v1?limit=100&offset=0`:
  the MSC 1v1 ladder of the current season, players with a rank only. Each row
  has `rank`, `player_id`, `discord_user_id`, `display_name`, `rating`,
  `competitive_rank`, `total_wins`, `total_losses` and `total_matches`.
  `limit` goes up to 500.
- `GET https://mariostrikers.gg/api/leaderboards/msc/elo1v1/top?limit=25`: the
  top of that ladder.
- `GET https://mariostrikers.gg/api/competitive-season/current`: the current
  season, or the next one, with the server's clock.
