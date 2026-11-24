# 0015: The player list shows the server's members by server name

Status: accepted (2026-11-24)

## Context

The player list showed a profile once it had a friend code, a start.gg id, a
rated match this season or a tournament placement, under the name stored in
`dbo.Player.Name`. That name is set once, when a profile is created, and often
from the Discord username (`hydron_8_65732` for a member called `Hydron_8` on
the server). Two players with the same stored name got a club tag or their id
after it (`Spiky [#2496]`), even when the other one had long left the server.
Players who left stayed in the list.

The database already identifies every profile by its Discord account:
`dbo.Player.DiscordID` holds the plain id for all of them and is unique
(`IX_Player_DiscordID`). It holds no username. The website already reads the
whole member list of the server in the background
(`integrations/discord/guild-members.ts`).

## Decision

- **The list holds every profile whose Discord account is on the server now**
  (owner, 2026-11-24), and nobody else. A profile of someone who left stays in
  the database, keeps its own pages and still opens from leaderboards and
  rosters. The 44 profiles without any content were deleted once before the
  change (backup first); from then on every new profile is listed, even an
  empty one.
- **The name is the server's**: the nickname, else the global display name,
  else the username, without the club tags Robotic Nightmare puts in front
  (`[KFC] Virt` becomes `Virt`). A tag is recognized by the club tags
  themselves, never by its shape, like the bot does (old tags such as `]IB[`).
- **Players who share a name are all listed, each with the username**:
  `Spiky (@spiky123)`. Usernames are unique on Discord.
- **The popup opened from the list goes by the same name.** Leaderboards,
  rosters and the bots keep `dbo.Player.Name`; the database is not changed.
- **No member list, no player list**: without a complete member list the list
  answers 503 instead of showing players who may have left. Once a list
  exists, a failed refresh keeps the last one (public data cache and member
  list both do). Changes on the server show within about six minutes (member
  list every five, public data every minute).

The rules live in `modules/players/server-names.ts`, pure and tested; the
service joins `fetchPlayerListSource` (profiles and club tags in one round
trip) with the member list.

## Consequences

- A member who changes their nickname appears under the new name without any
  write; leaving the server removes them from the list, joining again brings
  them back with their profile.
- The list depends on Discord: after a restart it waits for the first read of
  the member list (a few seconds), and it cannot be built while Discord's
  member list cannot be read at all.
- The stored name and the server name can differ (the list and the popup show
  the server's, other views the stored one) until a later decision syncs them.
