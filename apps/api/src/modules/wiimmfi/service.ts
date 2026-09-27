// Players online in Mario Strikers Charged on Wiimmfi. Wiimmfi's stats page sits behind Cloudflare,
// so it is fetched through FlareSolverr. Only the first request waits; afterwards visitors get the
// last good list while one background refresh at a time renews it.

import { toText } from "@ms/shared/text";
import type { Logger } from "../../lib/logger.ts";

export interface WiimmfiPlayer {
  region: string;
  friendCode: string;
  name: string;
}

const WIIMMFI_STATS_URL = "https://wiimmfi.de/stats/game/mschargedwii/text";

/**
 * Parses the pipe-separated text export. Fields after the leading "|":
 * id4, pid, fc, host, gid, ls_stat, ol_stat, status, suspend, n, name1, name2. Lines starting with "!" are comments.
 */
export function parseWiimmfiText(text: string): WiimmfiPlayer[] {
  const players: WiimmfiPlayer[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("!")) continue;
    const parts = trimmed.split("|");
    const name = (parts[11] ?? "").trim();
    if (name) players.push({ region: (parts[1] ?? "").trim(), friendCode: (parts[3] ?? "").trim(), name });
  }
  return players;
}

export async function fetchWiimmfiPlayers(flareSolverrUrl: string, timeoutMs: number): Promise<WiimmfiPlayer[]> {
  const response = await fetch(`${flareSolverrUrl}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url: WIIMMFI_STATS_URL, maxTimeout: 60000 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`FlareSolverr HTTP ${response.status}`);
  const data = (await response.json()) as { status?: string; message?: string; solution?: { response?: unknown } };
  if (data.status !== "ok") throw new Error(`FlareSolverr: ${data.message ?? data.status ?? "no status"}`);
  return parseWiimmfiText(toText(data.solution?.response));
}

export class WiimmfiService {
  private readonly load: () => Promise<WiimmfiPlayer[]>;
  private readonly maxAgeMs: number;
  private readonly log: Logger;
  private players: WiimmfiPlayer[] | null = null;
  private loadedAt = 0;
  private inFlight: Promise<WiimmfiPlayer[]> | null = null;

  constructor(options: { load: () => Promise<WiimmfiPlayer[]>; maxAgeMs?: number; log: Logger }) {
    this.load = options.load;
    this.maxAgeMs = options.maxAgeMs ?? 60_000;
    this.log = options.log;
  }

  private refresh(): Promise<WiimmfiPlayer[]> {
    this.inFlight ??= this.load()
      .then((players) => {
        this.players = players;
        this.loadedAt = Date.now();
        return players;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  async getPlayers(): Promise<WiimmfiPlayer[]> {
    if (!this.players) return this.refresh();
    if (Date.now() - this.loadedAt >= this.maxAgeMs) {
      this.refresh().catch((err: unknown) => {
        this.log.warn({ err }, "[wiimmfi] Refresh failed; serving the last list");
      });
    }
    return this.players;
  }
}
