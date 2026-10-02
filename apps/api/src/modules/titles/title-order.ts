// The title rules of 2026-10-02 in the database (npm run ops:title-order): the categories' SortOrder of
// catalog.ts (special, MSL, season, tournament, legacy, free) and no exclusive group for the two TOURNAMENT
// WINNER titles, so a player can select both. ops:player-titles only adds missing rows, so these existing
// rows need their own change. Without `apply` it only reports. With it, both tables are copied first and
// exactly 4 categories and 2 titles change in one transaction; any other count rolls everything back. Run
// again, it finds nothing to change.

import { toText } from "@ms/shared/text";
import { mssql, type Database, type Queryable } from "../../db/database.ts";
import { TITLE_CATALOG, TITLE_CATEGORIES } from "./catalog.ts";

type Row = Record<string, unknown>;

export const TITLE_ORDER_BACKUPS = ["dbo.PlayerTitleCategory_Backup_20261002", "dbo.PlayerTitle_Backup_20261002"];
const UNGROUPED = ["tournament-winner", "tournament-winner-green"];
/** What the database of 2026-10-02 needs: msl, competitive-season, tournament, special; both TOURNAMENT WINNER. */
const EXPECTED = { categories: 4, titles: 2 };

export interface TitleOrderReport {
  readonly applied: boolean;
  readonly status: string;
  readonly categorySortOrder: string[];
  readonly ungroupedTitles: string[];
}

interface Planned {
  readonly sort: readonly { code: string; from: number; to: number }[];
  readonly groups: readonly { code: string; group: string | null; level: number | null }[];
}

function ungroupedRequest(db: Queryable): mssql.Request {
  const request = db.request();
  UNGROUPED.forEach((code, index) => request.input(`t${String(index)}`, mssql.VarChar(64), code));
  return request;
}

async function plannedChanges(db: Queryable): Promise<Planned> {
  const categories = (await db.request().query("SELECT Code, SortOrder FROM dbo.PlayerTitleCategory;"))
    .recordset as Row[];
  const sort = TITLE_CATEGORIES.flatMap((category) => {
    const stored = categories.find((row) => String(row.Code) === category.code);
    if (!stored) throw new Error(`Category ${category.code} is missing; run ops:player-titles first.`);
    const from = Number(stored.SortOrder);
    return from === category.sortOrder ? [] : [{ code: category.code, from, to: category.sortOrder }];
  });
  const titles = (
    await ungroupedRequest(db).query(
      "SELECT Code, ExclusiveGroup, ExclusiveLevel FROM dbo.PlayerTitle WHERE Code IN (@t0, @t1);",
    )
  ).recordset as Row[];
  const groups = UNGROUPED.flatMap((code) => {
    const stored = titles.find((row) => String(row.Code) === code);
    if (!stored) throw new Error(`Title ${code} is missing; run ops:player-titles first.`);
    const group = stored.ExclusiveGroup === null ? null : toText(stored.ExclusiveGroup);
    const level = stored.ExclusiveLevel === null ? null : Number(stored.ExclusiveLevel);
    return group === null && level === null ? [] : [{ code, group, level }];
  });
  return { sort, groups };
}

async function tableExists(db: Queryable, name: string): Promise<boolean> {
  const request = db.request();
  request.input("name", mssql.NVarChar(128), name);
  const rows = (await request.query("SELECT OBJECT_ID(@name, N'U') AS id;")).recordset as Row[];
  return rows[0]?.id !== null && rows[0]?.id !== undefined;
}

export async function applyTitleOrder(
  database: Pick<Database, "withTransaction">,
  apply: boolean,
): Promise<TitleOrderReport> {
  for (const code of UNGROUPED) {
    if (TITLE_CATALOG.find((title) => title.code === code)?.exclusiveGroup !== undefined) {
      throw new Error(`catalog.ts still puts ${code} in an exclusive group.`);
    }
  }
  return database.withTransaction(async (transaction) => {
    const planned = await plannedChanges(transaction);
    const report = {
      applied: false,
      categorySortOrder: planned.sort.map((change) => `${change.code}: ${String(change.from)} -> ${String(change.to)}`),
      ungroupedTitles: planned.groups.map(
        (change) => `${change.code}: ${change.group ?? "NULL"}/${String(change.level ?? "NULL")} -> NULL/NULL`,
      ),
    };
    if (!planned.sort.length && !planned.groups.length) return { ...report, status: "nothing to change" };
    if (planned.sort.length !== EXPECTED.categories || planned.groups.length !== EXPECTED.titles) {
      throw new Error(
        `Expected ${String(EXPECTED.categories)} categories and ${String(EXPECTED.titles)} titles to change, ` +
          `found ${String(planned.sort.length)} and ${String(planned.groups.length)}; nothing was changed.`,
      );
    }
    if (!apply) return { ...report, status: "dry run: add -- --apply to change these rows" };

    for (const backup of TITLE_ORDER_BACKUPS) {
      if (await tableExists(transaction, backup)) throw new Error(`${backup} exists already; nothing was changed.`);
    }
    const [categoryBackup, titleBackup] = TITLE_ORDER_BACKUPS;
    await transaction.request().query(`SELECT * INTO ${String(categoryBackup)} FROM dbo.PlayerTitleCategory;`);
    await transaction.request().query(`SELECT * INTO ${String(titleBackup)} FROM dbo.PlayerTitle;`);

    let categories = 0;
    for (const change of planned.sort) {
      const request = transaction.request();
      request.input("code", mssql.VarChar(40), change.code);
      request.input("from", mssql.Int, change.from);
      request.input("to", mssql.Int, change.to);
      const result = await request.query(
        "UPDATE dbo.PlayerTitleCategory SET SortOrder = @to WHERE Code = @code AND SortOrder = @from;",
      );
      categories += result.rowsAffected[0] ?? 0;
    }
    const titles =
      (
        await ungroupedRequest(transaction).query(
          "UPDATE dbo.PlayerTitle SET ExclusiveGroup = NULL, ExclusiveLevel = NULL WHERE Code IN (@t0, @t1)" +
            " AND (ExclusiveGroup IS NOT NULL OR ExclusiveLevel IS NOT NULL);",
        )
      ).rowsAffected[0] ?? 0;
    if (categories !== EXPECTED.categories || titles !== EXPECTED.titles) {
      throw new Error(
        `Changed ${String(categories)} categories and ${String(titles)} titles instead of ` +
          `${String(EXPECTED.categories)} and ${String(EXPECTED.titles)}; everything was rolled back.`,
      );
    }
    const after = await plannedChanges(transaction);
    if (after.sort.length || after.groups.length) throw new Error("Values differ after the change; rolled back.");
    return {
      ...report,
      applied: true,
      status: `changed ${String(categories)} categories and ${String(titles)} titles`,
    };
  });
}
