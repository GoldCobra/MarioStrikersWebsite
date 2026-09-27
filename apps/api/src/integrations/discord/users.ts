// Discord usernames for club rosters, looked up with the bot token and cached in a bounded LRU.
// Failed lookups are cached briefly so a missing member does not trigger a request on every view.

import { LRUCache } from "lru-cache";
import { normalizeText } from "@ms/shared/text";
import { mapLimit } from "../../lib/concurrency.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import { fetchDiscordJson, type DiscordRestOptions } from "./rest.ts";

export interface DiscordUserLookupOptions extends DiscordRestOptions {
  readonly guildId: string;
  readonly cacheTtlMs: number;
  readonly failureCacheTtlMs: number;
  readonly parallelism: number;
  readonly maxEntries?: number;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly value?: string;
  readonly pending?: Promise<string>;
}

export interface RosterNameRow {
  discord_id: string;
  discord_name: string;
}

export function toDiscordUsername(member: unknown): string {
  const record = (member ?? {}) as Record<string, unknown>;
  const user = (record.user ?? record) as Record<string, unknown>;
  return normalizeText(user.username) || normalizeText(record.nick) || normalizeText(user.global_name);
}

export class DiscordUserDirectory {
  private readonly options: DiscordUserLookupOptions;
  private readonly cache: LRUCache<string, CacheEntry>;

  constructor(options: DiscordUserLookupOptions) {
    this.options = options;
    this.cache = new LRUCache({ max: options.maxEntries ?? 5000 });
  }

  private async fetchUsername(discordId: string): Promise<string> {
    const user = await fetchDiscordJson(`/users/${encodeURIComponent(discordId)}`, this.options);
    if (user.ok) {
      const username = toDiscordUsername(user.payload);
      if (username) return username;
    }
    if (!this.options.guildId) return "";
    const member = await fetchDiscordJson(
      `/guilds/${encodeURIComponent(this.options.guildId)}/members/${encodeURIComponent(discordId)}`,
      this.options,
    );
    return member.ok ? toDiscordUsername(member.payload) : "";
  }

  /** Username for a stored Discord id or mention; "" when unknown or when no bot token is set. */
  async getUsername(discordIdRaw: unknown): Promise<string> {
    const discordId = normalizeDiscordId(discordIdRaw);
    if (!discordId || !this.options.botToken) return "";
    const key = [this.options.apiBase, this.options.guildId || "-", discordId].join(":");
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.pending ?? cached.value ?? "";

    const ttl = Math.max(0, this.options.cacheTtlMs);
    const pending = this.fetchUsername(discordId).then((value) => {
      const username = normalizeText(value);
      const entryTtl = username ? ttl : Math.max(0, Math.min(ttl, this.options.failureCacheTtlMs || 0));
      this.cache.set(key, { value: username, expiresAt: Date.now() + entryTtl });
      return username;
    });
    this.cache.set(key, { pending, expiresAt: now + ttl });
    return pending;
  }

  /** Fills empty discord_name fields in place; existing names are kept. */
  async resolveRosterNames<T extends RosterNameRow>(rows: T[]): Promise<T[]> {
    if (!this.options.botToken) return rows;
    const ids = [
      ...new Set(
        rows.map((row) => (normalizeText(row.discord_name) ? "" : normalizeDiscordId(row.discord_id))).filter(Boolean),
      ),
    ];
    if (!ids.length) return rows;
    const namesById = new Map<string, string>();
    await mapLimit(ids, this.options.parallelism, async (id) => {
      const username = await this.getUsername(id);
      if (username) namesById.set(id, username);
    });
    for (const row of rows) {
      const name = namesById.get(normalizeDiscordId(row.discord_id));
      if (!normalizeText(row.discord_name) && name) row.discord_name = name;
    }
    return rows;
  }

  clear(): void {
    this.cache.clear();
  }
}
