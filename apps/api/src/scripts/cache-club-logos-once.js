const { getMsblClubs } = require("../services/clubs-service");
const { closePool } = require("../db");

async function main() {
  try {
    const rows = await getMsblClubs();
    const withLogo = rows.filter(function (row) {
      return !!String(row.logo || "").trim();
    });

    console.log(JSON.stringify({
      status: "ok",
      game: "msbl",
      clubs: rows.length,
      cached_logos: withLogo.length,
      sample: withLogo.slice(0, 5).map(function (row) {
        return {
          club_id: row.club_id,
          tag: row.tag,
          name: row.name,
          logo: row.logo
        };
      })
    }, null, 2));
  } catch (error) {
    console.error("[club-logos:cache] failed: " + error.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
