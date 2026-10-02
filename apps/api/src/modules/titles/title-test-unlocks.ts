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

import type { Database, Queryable } from "../../db/database.ts";
import { mssql } from "../../db/database.ts";
import { isTemplateTitle, selectedTitle, type CatalogTitle } from "./availability.ts";
import { CATALOG_QUERY, toCatalogTitle } from "./repository.ts";

type Row = Record<string, unknown>;

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

async function readPlayerState(
  db: Queryable,
  playerId: number,
): Promise<{ exists: boolean; regular: number[]; tests: number[]; selected: number | null; catalog: CatalogTitle[] }> {
  const request = db.request();
  request.multiple = true;
  request.input("playerId", mssql.Int, playerId);
  const sets = (
    await request.query(
      [
        "SELECT p.ID FROM dbo.Player p WHERE p.ID = @playerId;",
        "SELECT u.TitleId FROM dbo.PlayerTitleUnlock u WHERE u.PlayerId = @playerId;",
        "SELECT x.TitleId FROM dbo.PlayerTitleTestUnlock x WITH (UPDLOCK, HOLDLOCK) WHERE x.PlayerId = @playerId;",
        "SELECT a.TitleId FROM dbo.PlayerActiveTitle a WITH (UPDLOCK, HOLDLOCK) WHERE a.PlayerId = @playerId;",
        CATALOG_QUERY,
      ].join(" "),
    )
  ).recordsets as unknown as Row[][];
  const ids = (set: Row[] | undefined): number[] => (set ?? []).map((row) => Number(row.TitleId));
  return {
    exists: (sets[0] ?? []).length > 0,
    regular: ids(sets[1]),
    tests: ids(sets[2]),
    selected: sets[3]?.[0] ? Number(sets[3][0].TitleId) : null,
    catalog: (sets[4] ?? []).map(toCatalogTitle),
  };
}

export async function runTestUnlocks(
  database: Pick<Database, "withTransaction">,
  options: {
    readonly playerId: number;
    readonly mode: TestUnlockMode;
    readonly apply: boolean;
    readonly grantedBy: string;
  },
): Promise<TestUnlockReport> {
  const { playerId, mode, apply } = options;
  if (!Number.isInteger(playerId) || playerId <= 0) throw new Error("--player needs a player id.");
  return database.withTransaction(async (transaction) => {
    const state = await readPlayerState(transaction, playerId);
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
        const request = transaction.request();
        request.input("playerId", mssql.Int, playerId);
        request.input("titleId", mssql.Int, title.id);
        request.input("grantedBy", mssql.NVarChar(100), options.grantedBy);
        request.input("note", mssql.NVarChar(200), NOTE);
        const result = await request.query(
          "INSERT INTO dbo.PlayerTitleTestUnlock (PlayerId, TitleId, GrantedBy, Note) SELECT @playerId, @titleId, @grantedBy, @note" +
            " WHERE NOT EXISTS (SELECT 1 FROM dbo.PlayerTitleTestUnlock x WHERE x.PlayerId = @playerId AND x.TitleId = @titleId);",
        );
        inserted += result.rowsAffected[0] ?? 0;
      }
      if (inserted !== add.length) {
        throw new Error(`Planned ${add.length} test unlocks but inserted ${inserted}; nothing was saved.`);
      }
    } else {
      report.titles = state.tests.map((id) => codeOf.get(id) ?? String(id));
      // The selection stays only if the player can still select it without the test unlocks.
      const keeps =
        state.selected === null || selectedTitle(state.catalog, state.regular, state.selected, { playerId }) !== null;
      report.clearedSelection = keeps ? "" : (codeOf.get(state.selected ?? 0) ?? String(state.selected));
      if (!apply || (!state.tests.length && keeps)) return report;
      const request = transaction.request();
      request.input("playerId", mssql.Int, playerId);
      const result = await request.query("DELETE FROM dbo.PlayerTitleTestUnlock WHERE PlayerId = @playerId;");
      if ((result.rowsAffected[0] ?? 0) !== state.tests.length) {
        throw new Error("The test unlocks changed meanwhile; nothing was removed.");
      }
      if (!keeps) {
        const clear = transaction.request();
        clear.input("playerId", mssql.Int, playerId);
        await clear.query("DELETE FROM dbo.PlayerActiveTitle WHERE PlayerId = @playerId;");
      }
    }

    const log = transaction.request();
    log.input(
      "log",
      mssql.NVarChar(4000),
      JSON.stringify({
        granted_by: options.grantedBy,
        player_id: playerId,
        mode,
        titles: report.titles.length,
        cleared_selection: report.clearedSelection,
      }),
    );
    await log.query(`INSERT INTO dbo.CommandLog (Command, Parameters) VALUES (N'${TEST_UNLOCK_LOG_COMMAND}', @log);`);
    return { ...report, applied: true };
  });
}
