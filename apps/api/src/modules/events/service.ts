// Community tournaments are the text channels of one Discord category. They are read with the bot
// token, refreshed hourly, and the last good list is kept when Discord is unavailable.

import { normalizeText } from "@ms/shared/text";
import { fetchDiscordJson, type DiscordRestOptions } from "../../integrations/discord/rest.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import type { Logger } from "../../lib/logger.ts";

const TEXT_CHANNEL_TYPES = new Set([0, 5, 15, 16]);
const EXCLUDED_EVENT_KEYS = new Set(["tournaments", "event-voice-channel"]);
// Channel names start with a coloured marker that tells the game.
const EVENT_GAME_MARKERS = [
  { game: "sms", imageUrl: "/assets/games/smsball.png", symbols: ["🔹", "🔷", "💠"] },
  { game: "msc", imageUrl: "/assets/games/mscball.png", symbols: ["🔸", "🔶", "🟠", "🟧"] },
  { game: "msbl", imageUrl: "/assets/games/msblball.png", symbols: ["🔺", "🔻", "🔴", "🟥"] },
] as const;

export interface CommunityEvent {
  id: string;
  name: string;
  display_name: string;
  game: string;
  image_url: string;
  slug: string;
  position: number;
  url: string;
}

export interface EventsPayload {
  count: number;
  rows: CommunityEvent[];
}

export interface DiscordChannel {
  id?: unknown;
  parent_id?: unknown;
  type?: unknown;
  name?: unknown;
  position?: unknown;
}

function cleanChannelName(value: unknown): string {
  return normalizeText(value)
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectEventGame(value: unknown): { game: string; image_url: string } {
  const text = normalizeText(value);
  const marker = EVENT_GAME_MARKERS.find((candidate) => candidate.symbols.some((symbol) => text.includes(symbol)));
  return marker ? { game: marker.game, image_url: marker.imageUrl } : { game: "", image_url: "" };
}

export function formatEventDisplayName(value: unknown): string {
  return cleanChannelName(value).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

function toEventKey(value: unknown): string {
  return cleanChannelName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildDiscordChannelUrl(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${encodeURIComponent(guildId)}/${encodeURIComponent(channelId)}`;
}

function toEventRow(channel: DiscordChannel, guildId: string): CommunityEvent | null {
  const id = normalizeDiscordId(channel.id);
  const name = cleanChannelName(channel.name);
  if (!id || !name) return null;
  const game = detectEventGame(channel.name);
  const position = Number(channel.position);
  return {
    id,
    name,
    display_name: formatEventDisplayName(name),
    game: game.game,
    image_url: game.image_url,
    slug: toEventKey(name) || "event",
    position: Number.isFinite(position) ? position : 999999,
    url: buildDiscordChannelUrl(guildId, id),
  };
}

export function filterCommunityEventChannels(
  channels: unknown,
  options: { guildId: unknown; categoryId: unknown },
): CommunityEvent[] {
  const categoryId = normalizeDiscordId(options.categoryId);
  const guildId = normalizeDiscordId(options.guildId);
  if (!categoryId || !guildId || !Array.isArray(channels)) return [];
  return (channels as DiscordChannel[])
    .filter(
      (channel) =>
        normalizeDiscordId(channel.parent_id) === categoryId &&
        TEXT_CHANNEL_TYPES.has(Number(channel.type)) &&
        !EXCLUDED_EVENT_KEYS.has(toEventKey(channel.name)),
    )
    .map((channel) => toEventRow(channel, guildId))
    .filter((row): row is CommunityEvent => row !== null)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export interface EventsSourceOptions extends DiscordRestOptions {
  readonly guildId: string;
  readonly categoryId: string;
}

export async function fetchCommunityEvents(options: EventsSourceOptions): Promise<EventsPayload> {
  const guildId = normalizeDiscordId(options.guildId);
  const categoryId = normalizeDiscordId(options.categoryId);
  if (!normalizeText(options.botToken) || !guildId || !categoryId) return { count: 0, rows: [] };
  const response = await fetchDiscordJson(`/guilds/${encodeURIComponent(guildId)}/channels`, options);
  if (!response.ok || !Array.isArray(response.payload)) {
    throw new Error(`Discord events channel request failed (${response.status}).`);
  }
  const rows = filterCommunityEventChannels(response.payload, { guildId, categoryId });
  return { count: rows.length, rows };
}

export class CommunityEventsCache {
  private readonly loader: () => Promise<EventsPayload>;
  private readonly refreshIntervalMs: number;
  private readonly log: Logger;
  private payload: EventsPayload | null = null;
  private inFlight: Promise<EventsPayload> | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(options: { loader: () => Promise<EventsPayload>; refreshIntervalMs: number; log: Logger }) {
    this.loader = options.loader;
    this.refreshIntervalMs = options.refreshIntervalMs;
    this.log = options.log;
  }

  refresh(): Promise<EventsPayload> {
    this.inFlight ??= this.loader()
      .then((payload) => {
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        this.payload = { count: rows.length, rows };
        return this.payload;
      })
      .catch((err: unknown) => {
        this.log.warn({ err }, "[events-cache] Refresh failed");
        if (this.payload) return this.payload;
        throw err;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  get(): Promise<EventsPayload> {
    return this.payload ? Promise.resolve(this.payload) : this.refresh();
  }

  start(): void {
    if (this.intervalHandle) return;
    this.refresh().catch(() => undefined);
    if (this.refreshIntervalMs > 0) {
      this.intervalHandle = setInterval(() => {
        this.refresh().catch(() => undefined);
      }, this.refreshIntervalMs);
      this.intervalHandle.unref();
    }
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    await this.inFlight?.catch(() => undefined);
  }
}
