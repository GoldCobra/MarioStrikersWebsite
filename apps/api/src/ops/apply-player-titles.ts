// npm run ops:player-titles: creates the player title tables when they are missing (and the GameCode column of
// a dbo.PlayerTitle from before 2026-10-02) and adds the categories and titles of modules/titles/catalog.ts
// the database does not have yet. Nothing existing is changed, so it can run again after a title was added
// to the catalog. One transaction, checked at the end.

import { TITLE_CATALOG, TITLE_CATEGORIES } from "../modules/titles/catalog.ts";
import {
  EXISTING_TABLES_QUERY,
  GAME_COLUMN_SQL,
  SCHEMA_SQL,
  TITLE_TABLES,
  buildSeedCategoriesQuery,
  buildSeedTitlesQuery,
  insertedRows,
} from "../modules/titles/repository.ts";
import { runOperation } from "./run-operation.ts";

type Row = Record<string, unknown>;

await runOperation("ops:player-titles", ({ database }) =>
  database.withTransaction(async (transaction) => {
    const existing = new Set(
      ((await transaction.request().query(EXISTING_TABLES_QUERY)).recordset as Row[]).map((row) => String(row.name)),
    );
    await transaction.request().query(SCHEMA_SQL);
    await transaction.request().query(GAME_COLUMN_SQL);
    const categoryRequest = transaction.request();
    const categories = await insertedRows(categoryRequest, buildSeedCategoriesQuery(TITLE_CATEGORIES, categoryRequest));
    const titleRequest = transaction.request();
    const titles = await insertedRows(titleRequest, buildSeedTitlesQuery(TITLE_CATALOG, titleRequest));

    const stored = (await transaction.request().query("SELECT Code FROM dbo.PlayerTitle;")).recordset as Row[];
    const codes = new Set(stored.map((row) => String(row.Code)));
    const missing = TITLE_CATALOG.filter((title) => !codes.has(title.code)).map((title) => title.code);
    if (missing.length) throw new Error(`Titles missing after the seed: ${missing.join(", ")}; nothing was saved.`);

    return {
      status: "ok",
      created_tables: TITLE_TABLES.filter((name) => !existing.has(name)),
      inserted_categories: categories,
      inserted_titles: titles,
      titles_in_database: codes.size,
    };
  }),
);
