// Uploaded club logos (dbo.ClubLogo, docs/adr/0013) for the public logo route. Which clubs have one comes from a
// small index (club id → hash), read at most once a minute and again right after a club change, so a link logo
// never waits for the database and keeps coming from the disk cache while the database is down.

import type { Logger } from "../../lib/logger.ts";

export interface UploadedLogo {
  readonly contentType: string;
  readonly hash: string;
  readonly data: Buffer;
}

export interface UploadedLogoReader {
  /** Every uploaded logo's club id and hash. */
  hashes(): Promise<ReadonlyMap<number, string>>;
  /** One club's uploaded logo; undefined without one. */
  logo(clubId: number): Promise<UploadedLogo | undefined>;
}

export interface UploadedLogos {
  /** The club's uploaded logo, null without one; a failed read of a known logo throws (never a stale fallback). */
  get(clubId: number): Promise<UploadedLogo | null>;
  /** After a club change: the next lookup waits for an index read that started after it. */
  invalidate(): void;
}

const INDEX_TTL_MS = 60_000;

export function createUploadedLogos(
  reader: UploadedLogoReader,
  options: { readonly log: Pick<Logger, "warn">; readonly now?: () => number; readonly ttlMs?: number },
): UploadedLogos {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? INDEX_TTL_MS;
  let index: { readonly at: number; readonly hashes: ReadonlyMap<number, string> } | null = null;
  let generation = 0;
  let pending: { readonly generation: number; readonly done: Promise<void> } | null = null;

  /** One index read per generation at a time; a read that started before an invalidation is dropped. */
  function refresh(): Promise<void> {
    if (pending?.generation === generation) return pending.done;
    const started = generation;
    const done: Promise<void> = reader
      .hashes()
      .then(
        (hashes) => {
          if (started === generation) index = { at: now(), hashes };
        },
        (error: unknown) => {
          options.log.warn({ err: error }, "[clubs] Uploaded logos could not be listed; link logos only for now");
          // One interval with what was known (nothing on a first read), so a database outage costs one wait.
          if (started === generation) index = { at: now(), hashes: index?.hashes ?? new Map<number, string>() };
        },
      )
      .finally(() => {
        if (pending?.done === done) pending = null;
      });
    pending = { generation: started, done };
    return done;
  }

  /** A fresh index answers; an expired one answers while a read runs; none (the start, after a change) waits. */
  async function hashes(): Promise<ReadonlyMap<number, string>> {
    for (;;) {
      if (index && now() - index.at < ttlMs) return index.hashes;
      if (index) {
        void refresh();
        return index.hashes;
      }
      await refresh();
    }
  }

  return {
    async get(clubId) {
      if (!(await hashes()).has(clubId)) return null;
      return (await reader.logo(clubId)) ?? null;
    },
    invalidate() {
      generation += 1;
      index = null;
    },
  };
}
