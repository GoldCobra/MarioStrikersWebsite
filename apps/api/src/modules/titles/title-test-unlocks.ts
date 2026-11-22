// Temporary test unlocks (npm run ops:title-test-unlocks, docs/adr/0009): titles a player can select for
// testing, kept in dbo.PlayerTitleTestUnlock and never in dbo.PlayerTitleUnlock, so they change no earned or
// fixed title, no stats, accolades or season rewards.
//
//   --player <id> --grant-all   every active title a player could select that they have not earned (every
//                               game variant, every level, also another player's fixed title)
//   --player <id> --revoke      removes that player's test unlocks, and the selection when only a test
//                               unlock allowed it
//
// Without --apply it only reports. Each applied run is one transaction and one dbo.CommandLog row
// (WebsiteTitleTestUnlock); a second run changes nothing.

import type { Database } from "../../db/database.ts";
import { isTemplateTitle, selectedTitle, type CatalogTitle } from "./availability.ts";
import {
  deleteSelectedTitle,
  deleteTestUnlocks,
  insertTestUnlock,
  logCommand,
  readTestUnlockState,
} from "./repository.ts";

export const TEST_UNLOCK_LOG_COMMAND = "WebsiteTitleTestUnlock";
const NOTE = "Temporary test access (owner, 2026-10-02); remove only on the owner's word.";

export type TestUnlockMode = "grant-all" | "revoke";

export interface TestUnlockReport {
  readonly applied: boolean;
  readonly playerId: number;
  readonly mode: TestUnlockMode;
  /** Codes granted (grant-all) or removed (revoke). */
  readonly titles: readonly string[];
  /** The selection removed because only a test unlock allowed it; "" for none. */
  readonly clearedSelection: string;
}

/** The titles a test unlock can add: active, no template, not global (Free Titles need none). */
export function testableTitles(catalog: readonly CatalogTitle[], regularIds: Iterable<number>): CatalogTitle[] {
  const regular = new Set(regularIds);
  return catalog.filter(
    (title) => title.isActive && !isTemplateTitle(title) && !title.isGlobal && !regular.has(title.id),
  );
}

export async function runTestUnlocks(
  database: Database,
  options: {
    readonly playerId: number;
    readonly mode: TestUnlockMode;
    readonly apply: boolean;
    readonly grantedBy: string;
  },
): Promise<TestUnlockReport> {
  const { playerId, mode, apply } = options;
  if (!Number.isInteger(playerId) || playerId <= 0) throw new Error("--player needs a player id.");
  // Clearing a selection only a test unlock allowed is no activity of the player, so an applied revoke runs with the
  // activity triggers paused; of the tables it writes, only dbo.PlayerActiveTitle has one.
  const skipPlayerActivity = apply && mode === "revoke";
  return database.transaction(
    async (tx) => {
      const state = await readTestUnlockState(tx, playerId);
      if (!state.exists) throw new Error(`Player ${playerId} does not exist; nothing was changed.`);
      const codeOf = new Map(state.catalog.map((title) => [title.id, title.code]));
      const report = { applied: false, playerId, mode, titles: [] as string[], clearedSelection: "" };

      if (mode === "grant-all") {
        const have = new Set(state.tests);
        const add = testableTitles(state.catalog, state.regular).filter((title) => !have.has(title.id));
        report.titles = add.map((title) => title.code);
        if (!apply || !add.length) return report;
        let inserted = 0;
        for (const title of add) {
          inserted += await insertTestUnlock(tx, {
            playerId,
            titleId: title.id,
            grantedBy: options.grantedBy,
            note: NOTE,
          });
        }
        if (inserted !== add.length) {
          throw new Error(`Planned ${add.length} test unlocks but inserted ${inserted}; nothing was saved.`);
        }
      } else {
        report.titles = state.tests.map((id) => codeOf.get(id) ?? String(id));
        // The selection stays only if the player can still select it without the test unlocks.
        const keeps =
          state.selected === null || selectedTitle(state.catalog, state.regular, state.selected, { playerId }) !== null;
        report.clearedSelection = keeps ? "" : (codeOf.get(state.selected) ?? String(state.selected));
        if (!apply || (!state.tests.length && keeps)) return report;
        if ((await deleteTestUnlocks(tx, playerId)) !== state.tests.length) {
          throw new Error("The test unlocks changed meanwhile; nothing was removed.");
        }
        if (!keeps) await deleteSelectedTitle(tx, playerId);
      }

      await logCommand(tx, TEST_UNLOCK_LOG_COMMAND, {
        granted_by: options.grantedBy,
        player_id: playerId,
        mode,
        titles: report.titles.length,
        cleared_selection: report.clearedSelection,
      });
      return { ...report, applied: true };
    },
    { skipPlayerActivity },
  );
}
