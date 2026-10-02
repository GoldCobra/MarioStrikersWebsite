// The title sync: reads the sources, lets the rules decide and writes what is new in one transaction.
// The API runs it once a day (TITLE_SYNC_INTERVAL_MS): every hour it looks up when the last run was logged
// in dbo.CommandLog, so restarts and releases never reset the day. `npm run ops:title-sync` runs it on
// demand, with the legacy ranks, and writes only with --apply.

import type { Database } from "../../db/database.ts";
import type { Logger } from "../../lib/logger.ts";
import { readLastSyncRun, readTitleSources, writeTitleAwards, type TitleCatalog } from "./repository.ts";
import { planTitleAwards, type TitleGrant } from "./rules.ts";

const HOUR_MS = 60 * 60 * 1000;

export interface TitleSyncOptions {
  /** Write the unlocks; without it the run only reports them. */
  readonly apply: boolean;
  /** Also award the legacy ranks (their data no longer changes, so the daily run leaves them out). */
  readonly legacy: boolean;
  /** Stored as dbo.PlayerTitleUnlock.GrantedBy and in the run's dbo.CommandLog row. */
  readonly grantedBy: string;
}

export interface TitleSyncReport {
  readonly applied: boolean;
  /** Unlocks written (0 without apply). */
  readonly granted: number;
  readonly newTitles: readonly string[];
  /** Planned unlocks per title code. */
  readonly byTitle: Readonly<Record<string, number>>;
  readonly grants: readonly TitleGrant[];
  readonly openPoints: readonly string[];
}

export function countByTitle(grants: readonly TitleGrant[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const grant of grants) counts[grant.titleCode] = (counts[grant.titleCode] ?? 0) + 1;
  return counts;
}

export async function runTitleSync(
  database: Pick<Database, "withPool" | "withTransaction">,
  options: TitleSyncOptions,
): Promise<TitleSyncReport> {
  const plan = planTitleAwards(await readTitleSources(database, { legacy: options.legacy }));
  const byTitle = countByTitle(plan.grants);
  const newTitles = plan.newTitles.map((title) => title.name);
  const granted = options.apply
    ? await writeTitleAwards(database, plan, {
        grantedBy: options.grantedBy,
        log: {
          granted: plan.grants.length,
          titles: byTitle,
          new_titles: newTitles,
          open_points: plan.openPoints.length,
        },
      })
    : 0;
  return { applied: options.apply, granted, newTitles, byTitle, grants: plan.grants, openPoints: plan.openPoints };
}

/** Whether a run is due: none was logged yet, or the last one is at least `intervalMs` old. */
export function isSyncDue(lastRun: Date | null, now: number, intervalMs: number): boolean {
  return !lastRun || now - lastRun.getTime() >= intervalMs;
}

export interface TitleSyncScheduleOptions {
  readonly database: Pick<Database, "withPool" | "withTransaction">;
  readonly log: Logger;
  /** Dropped when a run created titles, so new season titles show at once. */
  readonly catalog: Pick<TitleCatalog, "invalidate">;
  /** Time between runs; 0 switches the sync off. */
  readonly intervalMs: number;
  readonly checkEveryMs?: number;
  readonly firstCheckMs?: number;
  readonly now?: () => number;
}

export interface TitleSyncSchedule {
  start(): void;
  stop(): void;
  /** One check: runs the sync when it is due. */
  check(): Promise<void>;
}

export function createTitleSyncSchedule(options: TitleSyncScheduleOptions): TitleSyncSchedule {
  const { database, log, catalog, intervalMs } = options;
  const checkEveryMs = options.checkEveryMs ?? HOUR_MS;
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function check(): Promise<void> {
    if (running) return;
    running = true;
    try {
      if (!isSyncDue(await readLastSyncRun(database), now(), intervalMs)) return;
      const report = await runTitleSync(database, { apply: true, legacy: false, grantedBy: "website title sync" });
      if (report.newTitles.length) catalog.invalidate();
      log.info(
        { granted: report.granted, newTitles: report.newTitles, openPoints: report.openPoints.length },
        "[titles] Title sync done",
      );
    } catch (err) {
      log.warn({ err }, "[titles] Title sync failed");
    } finally {
      running = false;
    }
  }

  function schedule(delayMs: number): void {
    timer = setTimeout(() => {
      void check().finally(() => {
        if (timer) schedule(checkEveryMs);
      });
    }, delayMs);
    timer.unref();
  }

  return {
    start() {
      if (intervalMs <= 0 || timer) return;
      schedule(options.firstCheckMs ?? 60_000);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    check,
  };
}
