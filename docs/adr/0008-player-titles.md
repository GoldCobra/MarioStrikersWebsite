# 0008: Player titles live in the shared database

Status: accepted (2026-10-02)

## Context

Members pick a title for their profile (shown under the name in the player
popup, on `/profile` and on the Discord card of `/profile show`). Titles come
in categories: Free Titles for everyone, Competitive Season titles for a
season's Strikers Titans, MSL and tournament titles for winners, legacy ranks
and staff-only titles. New titles must be addable without changing how they
are awarded, and every unlock must say where it came from.

## Decision

Four tables in `dbo`, next to the player profile: `PlayerTitleCategory`,
`PlayerTitle` (a stable code, the name in FULL CAPS, enforced by a check, and
the rule that awards it as a kind with JSON parameters), `PlayerTitleUnlock`
(one row per player and title, unique, with source, reference and who granted
it) and `PlayerActiveTitle` (the selected title). A global category (Free
Titles) is available to everyone without unlock rows. Within an exclusive
group (legacy ranks, N-TIME WORLD CHAMPION) a player is offered only the
highest level they unlocked. (Since 2026-10-02 the green and the plain
TOURNAMENT WINNER are no group: both can be selected.)

`apps/api/src/modules/titles/` holds the rules as pure functions over the
existing data (tournaments, season rewards, legacy ranks) and one definition of
which titles a player can select. The API awards new titles once a day; the
last run is the newest `WebsiteTitleSync` row in `dbo.CommandLog`, so restarts
do not reset the day. `npm run ops:player-titles` creates the tables and seeds
the title list; `npm run ops:title-sync` awards on demand, the frozen legacy
ranks included. Unclear data (team and doubles wins, side brackets, a legacy
rank without the matches it needed) awards nothing and is reported instead.

## Consequences

- A title of a known kind is one `dbo.PlayerTitle` row; a new Free Title is at
  once available to everyone. A new kind of rule needs code in `rules.ts`.
- Awards are only inserted, never changed by the sync; a second run finds
  nothing new. Staff can grant any title as a `MANUAL` unlock.
- The bots do not change: the Discord card shows the title because it is the
  website's card.
- The profile batch and the editor's save read two more small result sets.
