// npm run ops:club-logos: downloads every MSBL club logo that is not cached yet.

import { ClubLogoCache } from "../modules/clubs/logo-cache.ts";
import { getMsblClubs } from "../modules/clubs/service.ts";
import { runOperation } from "./run-operation.ts";

await runOperation("ops:club-logos", async ({ config, database, log }) => {
  const { cachePath, maxBytes, fetchTimeoutMs, failureRetryMs } = config.clubLogos;
  const logos = new ClubLogoCache({ cacheDir: cachePath, maxBytes, fetchTimeoutMs, failureRetryMs, log });
  const rows = await getMsblClubs(database, logos);
  const withLogo = rows.filter((row) => row.logo.trim());
  return {
    status: "ok",
    game: "msbl",
    clubs: rows.length,
    cached_logos: withLogo.length,
    sample: withLogo.slice(0, 5).map(({ club_id, tag, name, logo }) => ({ club_id, tag, name, logo })),
  };
});
