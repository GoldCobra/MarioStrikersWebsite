// Players by the name they carry on the Mario Strikers Discord server (docs/adr/0015). The player list shows every
// profile whose Discord account is on the server now, and nobody else: the profile of someone who left stays in the
// database and keeps its own pages. The Discord id is the key (dbo.Player.DiscordID, unique); the name is the
// server's: the nickname, else the global display name, else the username, without the club tags Robotic Nightmare
// puts in front ("[KFC] Virt" -> "Virt"). Players who share a name get their Discord username after it
// ("Spiky (@spiky123)"); usernames are unique on Discord.

import { normalizeText } from "@ms/shared/text";
import type { PlayerProfile } from "./mappers.ts";

/** A member's names as the server's member list has them (integrations/discord/guild-members.ts). */
export interface MemberNames {
  readonly username: string;
  readonly globalName: string;
  /** The server nickname; "" without one. */
  readonly nick: string;
}

/** A profile as the player list reads it. */
export interface ListProfile {
  readonly playerId: number;
  /** dbo.Player.DiscordID: plain digits, one profile per account. */
  readonly discordId: string;
  /** The flag code (normalizeCountryCode), "" without one. */
  readonly country: string;
  /** Player.Activity as an ISO string; null without one. */
  readonly activity: string | null;
  readonly isActive: boolean;
}

/** One player of GET /api/players. */
export interface PlayerListRow {
  readonly player_id: number;
  /** The server name, with " (@username)" when another listed player has the same one. */
  readonly name: string;
  readonly country: string;
  readonly activity: string | null;
  readonly is_active: boolean;
}

/** The club tags, each once (any case), longest first, so that a longer tag wins over a shorter one. */
export function clubTagList(tags: readonly unknown[]): string[] {
  const byUpper = new Map<string, string>();
  for (const tag of tags) {
    const text = normalizeText(tag);
    if (text && !byUpper.has(text.toUpperCase())) byUpper.set(text.toUpperCase(), text);
  }
  return [...byUpper.values()].sort((a, b) => b.length - a.length);
}

/**
 * The name without the club tags in front of it ("[KFC] Virt" -> "Virt", doubled ones too). A tag is recognized by
 * the club tags themselves, never by its shape: older clubs have tags like "]IB[" or "H.O.F", and a bracket the
 * member writes ("[TTV] Name") stays. The same rule as the bot's (robotic_nightmare clubTagNickname.js).
 */
export function withoutClubTags(name: string, tags: readonly string[]): string {
  let rest = name.trim();
  for (;;) {
    const tag = tags.find((candidate) => {
      const bracketed = `[${candidate}]`;
      return rest.slice(0, bracketed.length).toUpperCase() === bracketed.toUpperCase();
    });
    if (tag === undefined) return rest;
    rest = rest.slice(tag.length + 2).trim();
  }
}

/** The member's name on the server: the nickname, else the global display name, else the username, without tags. */
export function serverName(member: MemberNames, tags: readonly string[]): string {
  for (const name of [member.nick, member.globalName, member.username]) {
    const shown = withoutClubTags(normalizeText(name), tags);
    if (shown) return shown;
  }
  return "";
}

const nameKey = (name: string): string => name.toLowerCase();

/**
 * The player list: every profile whose Discord account is on the server, by server name. Players who share a name
 * (in any case) are told apart by their username. Sorted by name, then player id.
 */
export function buildPlayerList(
  profiles: readonly ListProfile[],
  members: ReadonlyMap<string, MemberNames>,
  tags: readonly string[],
): PlayerListRow[] {
  const listed: { profile: ListProfile; member: MemberNames; name: string }[] = [];
  for (const profile of profiles) {
    const member = members.get(profile.discordId);
    const name = member ? serverName(member, tags) : "";
    if (member && name) listed.push({ profile, member, name });
  }
  const counts = new Map<string, number>();
  for (const { name } of listed) counts.set(nameKey(name), (counts.get(nameKey(name)) ?? 0) + 1);
  return listed
    .map(({ profile, member, name }): PlayerListRow => {
      const shared = (counts.get(nameKey(name)) ?? 0) > 1 && member.username;
      return {
        player_id: profile.playerId,
        name: shared ? `${name} (@${member.username})` : name,
        country: profile.country,
        activity: profile.activity,
        is_active: profile.isActive,
      };
    })
    .sort((a, b) => {
      const left = nameKey(a.name);
      const right = nameKey(b.name);
      if (left !== right) return left < right ? -1 : 1;
      return a.player_id - b.player_id;
    });
}

/** The name a listed player goes by (list payload of GET /api/players); null for a player who is not listed. */
export function listedName(payload: unknown, playerId: number): string | null {
  const rows = (payload as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return null;
  const row = (rows as { player_id?: unknown; name?: unknown }[]).find((entry) => entry.player_id === playerId);
  const name = normalizeText(row?.name);
  return name || null;
}

/**
 * A profile under the name its player goes by in the player list, as the popup opened from the list shows it; a
 * player who is not listed (not on the server) keeps the stored name.
 */
export function withListedName(profile: PlayerProfile, listPayload: unknown): PlayerProfile {
  const name = profile.player.id === null ? null : listedName(listPayload, profile.player.id);
  return name === null || name === profile.player.name ? profile : { ...profile, player: { ...profile.player, name } };
}
