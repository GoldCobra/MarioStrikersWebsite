// Shared datasets (leaderboards, player and club lists, the season) are refreshed in the background
// and served from memory: fresh within ttlMs, stale while one refresh per key runs, loaded on a cold
// miss. Everything is read again at start; the database next to the API answers in milliseconds.

import { mapLimit } from "../lib/concurrency.ts";
import type { Logger } from "../lib/logger.ts";

export type CacheStatus = "hit" | "stale" | "miss" | "fixture";
export type Loader = () => Promise<unknown>;

export interface CacheResult<T = unknown> {
  readonly payload: T;
  readonly cacheStatus: CacheStatus;
  readonly generatedAt: string;
}

/** What the routes need from the cache; the fixtures provide their own. */
export interface PublicDataSource {
  get(key: string): Promise<CacheResult>;
}

interface Entry {
  readonly payload: unknown;
  readonly generatedAtMs: number;
}

export interface PublicDataCacheOptions {
  readonly loaders: Readonly<Record<string, Loader>>;
  readonly ttlMs: number;
  readonly refreshIntervalMs: number;
  readonly parallelism: number;
  readonly log: Logger;
  readonly slowRefreshThresholdMs?: number;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export class PublicDataCache implements PublicDataSource {
  readonly entries = new Map<string, Entry>();
  readonly inFlight = new Map<string, Promise<Entry>>();
  private readonly loaders: Map<string, Loader>;
  private readonly ttlMs: number;
  private readonly refreshIntervalMs: number;
  private readonly parallelism: number;
  private readonly slowRefreshThresholdMs: number;
  private readonly log: Logger;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(options: PublicDataCacheOptions) {
    this.loaders = new Map(Object.entries(options.loaders));
    this.ttlMs = positive(options.ttlMs, 60_000);
    this.refreshIntervalMs = positive(options.refreshIntervalMs, 60_000);
    this.parallelism = positive(options.parallelism, 2);
    this.slowRefreshThresholdMs = positive(options.slowRefreshThresholdMs ?? 1500, 1500);
    this.log = options.log;
  }

  getKeys(): string[] {
    return [...this.loaders.keys()];
  }

  private toResult(entry: Entry, cacheStatus: CacheStatus): CacheResult {
    return { payload: entry.payload, cacheStatus, generatedAt: new Date(entry.generatedAtMs).toISOString() };
  }

  async get(key: string): Promise<CacheResult> {
    const entry = this.entries.get(key);
    if (entry && Date.now() - entry.generatedAtMs < this.ttlMs) return this.toResult(entry, "hit");
    if (entry) {
      this.refresh(key).catch((err: unknown) => {
        this.log.warn({ err, key }, "[public-data-cache] Refresh failed");
      });
      return this.toResult(entry, "stale");
    }
    return this.toResult(await this.refresh(key), "miss");
  }

  refresh(key: string): Promise<Entry> {
    const running = this.inFlight.get(key);
    if (running) return running;
    const loader = this.loaders.get(key);
    if (!loader) return Promise.reject(new Error(`Unknown public data cache key: ${key}`));
    const startedAt = Date.now();
    const promise = Promise.resolve()
      .then(loader)
      .then((payload) => {
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs >= this.slowRefreshThresholdMs) {
          this.log.warn({ key, elapsedMs }, `[public-data-cache] Slow refresh for ${key}: ${elapsedMs}ms.`);
        }
        const entry = { payload, generatedAtMs: Date.now() };
        this.entries.set(key, entry);
        return entry;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  async warmupAll(): Promise<number> {
    const keys = this.getKeys();
    let refreshed = 0;
    const startedAt = Date.now();
    await mapLimit(keys, this.parallelism, async (key) => {
      try {
        await this.refresh(key);
        refreshed += 1;
      } catch (err) {
        this.log.warn({ err, key }, "[public-data-cache] Warmup failed");
      }
    });
    const elapsedMs = Date.now() - startedAt;
    this.log.info(
      { refreshed, total: keys.length, elapsedMs },
      `[public-data-cache] Warmup complete: ${refreshed}/${keys.length} datasets refreshed in ${elapsedMs}ms.`,
    );
    return refreshed;
  }

  start(): void {
    if (this.intervalHandle) return;
    void this.warmupAll();
    if (this.refreshIntervalMs > 0) {
      this.intervalHandle = setInterval(() => void this.warmupAll(), this.refreshIntervalMs);
      this.intervalHandle.unref();
    }
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }
}
