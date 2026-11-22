// npm run ops:player-titles: adds the categories and titles of modules/titles/catalog.ts the database does not have
// yet (the title tables exist since 2026-10-02). Nothing existing is changed, so it can run again after a title was
// added to the catalog. One transaction, checked at the end: when a title of the catalog is still missing, nothing
// is saved.

import { TITLE_CATALOG, TITLE_CATEGORIES } from "../modules/titles/catalog.ts";
import { fetchTitleCodes, insertMissingCategories, insertMissingTitles } from "../modules/titles/repository.ts";
import { runOperation } from "./run-operation.ts";

await runOperation("ops:player-titles", ({ database }) =>
  database.transaction(async (tx) => {
    const categories = await insertMissingCategories(tx, TITLE_CATEGORIES);
    const titles = await insertMissingTitles(tx, TITLE_CATALOG);

    const codes = await fetchTitleCodes(tx);
    const missing = TITLE_CATALOG.filter((title) => !codes.has(title.code)).map((title) => title.code);
    if (missing.length) throw new Error(`Titles missing after the seed: ${missing.join(", ")}; nothing was saved.`);

    return {
      status: "ok",
      inserted_categories: categories,
      inserted_titles: titles,
      titles_in_database: codes.size,
    };
  }),
);
