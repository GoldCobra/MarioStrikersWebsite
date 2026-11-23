// The whole member list of the Discord server, read with the bot token ("List Guild Members", 1,000 per page) and
// kept in memory: who is on the server now, since when, with which names and roles. Club rosters, the profile
// editor's names and club management (the invite list, the absence rule, succession) read it; a club change still
// asks Discord live for the acting member (members.ts). The list is read at start and again in the background every
// maxAgeMs, so no page waits for Discord once it exists. A read that fails, or comes back much shorter than the
// last complete list, keeps the last list, so a Discord hiccup never makes everyone look absent.

import { normalizeText } from "@ms/shared/text";
import { toRoleIds } from "./members.ts";
import { fetchDiscordJson, type DiscordRestOptions } from "./rest.ts";

export interface SnapshotMember {
  readonly id: string;
  readonly username: string;
  readonly globalName: string;
  /** The server nickname; "" without one. */
  readonly nick: string;
  readonly roles: readonly string[];
  /** When the member (last) joined the server, in ms; null when Discord sends none. */
  readonly joinedAt: number | null;
}

export interface GuildMemberSnapshot {
  readonly members: ReadonlyMap<string, SnapshotMember>;
  /** When the list was read completely, in ms. */
  readonly takenAt: number;
}

export interface GuildMemberListOptions extends DiscordRestOptions {
  readonly guildId: string;
  /** The list is read again in the background this often (and when it is asked for and older). */
  readonly maxAgeMs: number;
  /** After a failed read, the next attempt waits this long (default one minute). */
  readonly retryAfterMs?: number;
  /** A new list shorter than this share of the last complete one is not trusted (default 0.9). */
  readonly minShare?: number;
  readonly now?: () => number;
}

const PAGE_SIZE = 1000;
/** 50,000 members; the server has about 5,700. */
const MAX_PAGES = 50;

/** One entry of Discord's member list; null without a user id. */
export function toSnapshotMember(payload: unknown): SnapshotMember | null {
  const member = (payload ?? {}) as {
    nick?: unknown;
    roles?: unknown;
    joined_at?: unknown;
    user?: { id?: unknown; username?: unknown; global_name?: unknown };
  };
  const id = normalizeText(member.user?.id);
  if (!/^\d+$/.test(id)) return null;
  const joinedAt = typeof member.joined_at === "string" ? Date.parse(member.joined_at) : Number.NaN;
  return {
    id,
    username: normalizeText(member.user?.username),
    globalName: normalizeText(member.user?.global_name),
    nick: normalizeText(member.nick),
    roles: toRoleIds(member.roles),
    joinedAt: Number.isFinite(joinedAt) ? joinedAt : null,
  };
}

export class GuildMemberList {
  private readonly options: GuildMemberListOptions;
  private snapshot: GuildMemberSnapshot | null = null;
  private pending: Promise<GuildMemberSnapshot | null> | null = null;
  private failedAt = Number.NEGATIVE_INFINITY;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: GuildMemberListOptions) {
    this.options = options;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private retryWaiting(): boolean {
    return this.now() - this.failedAt < (this.options.retryAfterMs ?? 60_000);
  }

  /**
   * The newest complete list, at once: an older one is returned while a new one is read in the background. Only
   * before the first list exists is the read waited for. Null when no list could be read yet (check takenAt).
   */
  async get(): Promise<GuildMemberSnapshot | null> {
    const { snapshot } = this;
    if (snapshot) {
      if (this.now() - snapshot.takenAt >= this.options.maxAgeMs && !this.retryWaiting()) void this.refresh();
      return snapshot;
    }
    if (this.retryWaiting()) return null;
    return (await this.refresh()) ?? this.snapshot;
  }

  /** The list as it is in memory, without reading or waiting; null until the first read has finished. */
  peek(): GuildMemberSnapshot | null {
    return this.snapshot;
  }

  /** Reads the list now (one read at a time); resolves to the new list, or null when the read failed. */
  refresh(): Promise<GuildMemberSnapshot | null> {
    if (!this.options.botToken || !this.options.guildId) return Promise.resolve(null);
    this.pending ??= this.read().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Reads the list now and again every maxAgeMs. */
  start(): void {
    if (this.timer || !this.options.botToken || !this.options.guildId) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.options.maxAgeMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async read(): Promise<GuildMemberSnapshot | null> {
    const members = new Map<string, SnapshotMember>();
    let after = "0";
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const path =
        `/guilds/${encodeURIComponent(this.options.guildId)}/members` +
        `?limit=${String(PAGE_SIZE)}&after=${encodeURIComponent(after)}`;
      const response = await fetchDiscordJson(path, this.options);
      if (!response.ok || !Array.isArray(response.payload)) return this.fail();
      const entries = (response.payload as unknown[]).map(toSnapshotMember).filter((entry) => entry !== null);
      for (const entry of entries) members.set(entry.id, entry);
      const last = entries.at(-1);
      if ((response.payload as unknown[]).length < PAGE_SIZE || !last) return this.keep(members);
      after = last.id;
    }
    return this.fail();
  }

  private keep(members: Map<string, SnapshotMember>): GuildMemberSnapshot | null {
    const previous = this.snapshot?.members.size ?? 0;
    if (members.size < previous * (this.options.minShare ?? 0.9)) return this.fail();
    this.snapshot = { members, takenAt: this.now() };
    return this.snapshot;
  }

  private fail(): null {
    this.failedAt = this.now();
    return null;
  }
}
