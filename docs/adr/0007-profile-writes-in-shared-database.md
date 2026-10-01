# 0007: The profile editor writes to the bot's tables

Status: accepted (2026-10-01)

## Context

Members keep their country and friend codes with robotic_nightmare's
`/profile` commands, which write `dbo.Player` and `dbo.FriendCodes` in the
shared database through stored procedures (`UpdateCountry`, `AddFriendCode`,
`RemoveFriendCode`). The website gained a profile editor for the same data.
A second copy of the profile was not wanted, and the procedures are not
transactional, answer errors as text and change one code per call.

## Decision

The API writes the same tables itself, in exactly the form the procedures
leave: codes `1234-5678-9012`, GameType 3 / region `SW` for Switch and
GameType 1 with region (`PAL`, `NTSC`) and platform (`Label`) for MSC,
`LineSeq` numbered 1..n per player, game and region, the country as a
`dbo.Enumeration` code, and every change logged in `dbo.CommandLog`. One save
is one transaction: it reads the profile under update locks, compares a
version (a hash of everything the editor shows) and writes only the
differences. The rules (twelve digits, region and platform required, at most
three MSC codes) live once in `packages/shared/src/friend-codes.ts` for the
editor and the API.

## Consequences

- Website and bot read each other's changes at once; there is nothing to
  synchronise.
- A change made in Discord while the editor is open is never overwritten
  unseen: the save answers `409 PROFILE_CHANGED`, and the page shows what is
  saved and keeps the change open.
- The unique indexes `IX_Player_DiscordID` and `UX_FriendCodes_GameType_Code`
  guard both writers against duplicate profiles and codes.
- The bot's rules are duplicated in JavaScript; a change of limits, regions or
  platforms has to be made in both repositories.
