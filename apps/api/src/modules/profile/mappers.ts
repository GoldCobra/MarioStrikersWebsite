// The Discord identity of a login or a session, the name a new player profile gets from it, and the
// editor's profile as the API sends it (with the player's titles to choose from).

import { normalizeText, toText } from "@ms/shared/text";
import type { DiscordLogin } from "../auth/discord-oauth.ts";
import type { Session } from "../auth/session.ts";
import type { EditableProfile } from "./service.ts";

export interface DiscordIdentity {
  readonly id: string;
  readonly username: string;
  readonly globalName: string;
  /** The server nickname; "" without one. */
  readonly nick: string;
}

/** dbo.Player.Name is nvarchar(100). */
const PLAYER_NAME_MAX_LENGTH = 100;

// robotic_nightmare's nickname sync sets a club member's server nickname to "[TAG] Name" (view
// PlayerNicks). A new profile keeps only the name, or the sync would put the tag in front a second time.
const CLUB_TAG_PREFIX = /^\[[^\]\r\n]{1,16}\](?:\s+|$)/;

export function identityFromLogin({ user, nick }: DiscordLogin): DiscordIdentity {
  return {
    id: normalizeText(user.id),
    username: normalizeText(user.username),
    globalName: normalizeText(user.global_name),
    nick: normalizeText(nick),
  };
}

export function identityFromSession(session: Session): DiscordIdentity {
  return {
    id: normalizeText(session.discord_user_id),
    username: normalizeText(session.discord_user?.username),
    globalName: normalizeText(session.discord_user?.global_name),
    nick: normalizeText(session.guild_nick),
  };
}

/**
 * The name of a new profile: the name the member shows on the server (nickname, else global display
 * name, else username), as futbot names the players it creates.
 */
export function playerNameFromDiscord(identity: DiscordIdentity): string {
  const nick = toText(identity.nick).trim().replace(CLUB_TAG_PREFIX, "").trim();
  const name =
    nick || normalizeText(identity.globalName) || normalizeText(identity.username) || `Player ${identity.id}`;
  return Array.from(name).slice(0, PLAYER_NAME_MAX_LENGTH).join("");
}

/** GET/PUT /api/profile/me/editable: the editor's profile in the API's snake_case. */
export function toEditableResponse(profile: EditableProfile): Record<string, unknown> {
  return {
    player_id: profile.playerId,
    version: profile.version,
    discord: {
      id: profile.discord.id,
      server_name: profile.discord.serverName,
      username: profile.discord.username,
      global_name: profile.discord.globalName,
      nick: profile.discord.nick,
      membership: profile.discord.membership,
      source: profile.discord.source,
    },
    country: profile.country,
    switch_code: profile.switchCode,
    msc_codes: profile.mscCodes.map((entry) => ({ region: entry.region, platform: entry.platform, code: entry.code })),
    countries: profile.countries.map((country) => ({ code: country.code, name: country.name })),
    title: profile.title,
    titles: profile.titles.map((title) => ({
      code: title.code,
      name: title.name,
      category: title.category,
      category_name: title.categoryName,
      style: title.style,
    })),
  };
}
