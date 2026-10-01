// A member's current names on the server, looked up with the bot token. The server nickname changes in
// Discord (robotic_nightmare's nickname sync rewrites it, too), so the profile editor reads it fresh
// instead of trusting the login. Answers are cached briefly; without a bot token every member is
// "unknown" and callers fall back to the names of the login.

import { LRUCache } from "lru-cache";
import { normalizeText } from "@ms/shared/text";
import { fetchDiscordJson, type DiscordRestOptions } from "./rest.ts";

export type Membership = "member" | "not_member" | "unknown";

export interface GuildMember {
  readonly membership: Membership;
  /** The server nickname; "" without one. */
  readonly nick: string;
  readonly username: string;
  readonly globalName: string;
}

export interface GuildMemberLookup {
  getMember(discordId: string): Promise<GuildMember>;
}

export interface DiscordMemberDirectoryOptions extends DiscordRestOptions {
  readonly guildId: string;
  readonly cacheTtlMs: number;
  /** How long an unanswered lookup is remembered, so a Discord outage is not asked on every request. */
  readonly failureCacheTtlMs: number;
  readonly maxEntries?: number;
}

export const UNKNOWN_MEMBER: GuildMember = { membership: "unknown", nick: "", username: "", globalName: "" };

/** A Discord answer to GET /guilds/{guild}/members/{user}. */
export function toGuildMember(ok: boolean, status: number, payload: unknown): GuildMember {
  if (ok) {
    const member = (payload ?? {}) as { nick?: unknown; user?: { username?: unknown; global_name?: unknown } };
    return {
      membership: "member",
      nick: normalizeText(member.nick),
      username: normalizeText(member.user?.username),
      globalName: normalizeText(member.user?.global_name),
    };
  }
  // 404 is Unknown Member (or Unknown User): not on the server.
  return status === 404 ? { ...UNKNOWN_MEMBER, membership: "not_member" } : UNKNOWN_MEMBER;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly value: Promise<GuildMember>;
}

export class DiscordMemberDirectory implements GuildMemberLookup {
  private readonly options: DiscordMemberDirectoryOptions;
  private readonly cache: LRUCache<string, CacheEntry>;

  constructor(options: DiscordMemberDirectoryOptions) {
    this.options = options;
    this.cache = new LRUCache({ max: options.maxEntries ?? 2000 });
  }

  async getMember(discordId: string): Promise<GuildMember> {
    if (!this.options.botToken || !this.options.guildId || !/^\d+$/.test(discordId)) return UNKNOWN_MEMBER;
    const cached = this.cache.get(discordId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const path = `/guilds/${encodeURIComponent(this.options.guildId)}/members/${encodeURIComponent(discordId)}`;
    const value = fetchDiscordJson(path, this.options).then(({ ok, status, payload }) =>
      toGuildMember(ok, status, payload),
    );
    // Parallel requests for the same member share this lookup.
    this.cache.set(discordId, { expiresAt: Date.now() + this.options.failureCacheTtlMs, value });
    const member = await value;
    const ttl = member.membership === "unknown" ? this.options.failureCacheTtlMs : this.options.cacheTtlMs;
    this.cache.set(discordId, { expiresAt: Date.now() + ttl, value: Promise.resolve(member) });
    return member;
  }
}
