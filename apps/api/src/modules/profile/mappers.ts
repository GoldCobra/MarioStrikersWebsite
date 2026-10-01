// The Discord identity of a login or a session, and the name a new player profile gets from it.

import { normalizeText, toText } from "@ms/shared/text";
import type { DiscordLogin } from "../auth/discord-oauth.ts";
import type { Session } from "../auth/session.ts";

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
