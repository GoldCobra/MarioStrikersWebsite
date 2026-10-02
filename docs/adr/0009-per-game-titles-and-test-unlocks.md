# 0009: Titles of one game, fixed owners and test unlocks

Status: accepted (2026-10-02)

## Context

MSL tournaments exist once per game under the same name ("MSL 2022 World
Championship" in MSC, SMS and MSBL), and tournament wins were added up across
games, so an MSL or TOURNAMENT WINNER title did not say which game it was won
in. The owner wants each such title to belong to one game and to show that
game's ball, the one the accolades and season rewards show. Four WFC titles
belong to their record holders for good. The owner also needs to try every
title on his own profile without earning it.

## Decision

- `dbo.PlayerTitle.GameCode` (`MSBL`, `MSC`, `SMS` or NULL, the codes of
  `rocci121_toby.CompetitiveGame`) is the structured game of a title; a rule
  with a game counts only that game's tournaments, wins or rewards. Nothing is
  derived from the title's text. The API sends it as `title_game_code` (profile)
  and `game_code` (the editor's titles); the browser shows the game's ball
  before the title in the popup, on the Discord card, in the profile field and
  in the title list.
- N-TIME WORLD CHAMPION and TOURNAMENT WINNER (plain and green x5) have a fixed
  variant per game (`<code>-msbl|msc|sms`, own exclusive group per game). The
  titles without a game are retired (`IsActive = 0`); their unlocks stay as
  history. Wins never add up across games.
- An MSL event title is a template (`RuleKind msl-event`): never selectable,
  never awarded itself. The sync creates its variant for every game in which a
  completed tournament of that name has a winner, like a season title, so a new
  event gets its variants without guessing which games played it.
- Season titles are created per season and game (`season-titan-<id>-<game>`).
- Legacy ranks keep no game: the best rank of all games does not belong to one
  game, and a split was not wanted (owner, 2026-10-02).
- `RuleKind fixed-players` names the owners by player id and Discord id; the
  sync grants them as `MANUAL` while `dbo.Player` still has that Discord account,
  and an unlock of such a title counts for nobody else.
- Test unlocks live in their own table, `dbo.PlayerTitleTestUnlock`, never in
  `dbo.PlayerTitleUnlock`. They add titles on top of the regular ones (every
  level of a group, also another player's fixed title) and change no earned
  title, stats, accolades or season rewards. `npm run ops:title-test-unlocks`
  grants all or revokes them; revoking removes only the test rows.
- `npm run ops:title-games` brought this into the existing rows: `--schema`
  first (column and table, before the release), then the data step in one
  transaction with backups, exact row counts, a check that every old unlock has
  its game variant (except wins that only added up across games) and that no
  selected title became invalid.

## Consequences

- A title name can appear up to three times in a member's list; the ball tells
  them apart, and the list orders them MSBL, MSC, SMS.
- An MSL event of a new year is one template row; its variants follow from the
  tournament data. A new title of another kind with a game is one row with its
  `GameCode`.
- A player whose five wins were spread over games lost the green TOURNAMENT
  WINNER (owner's decision); the retired title keeps the old unlock.
