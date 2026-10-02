import assert from "node:assert/strict";
import test from "node:test";
import { TITLE_GAMES, gameByCode, gameByType, gameLabel, gameRank, titleGameCode } from "./games.ts";

test("the three games share the ids of Tournament, PlayerStats and CompetitiveGame, in the site's order", () => {
  assert.deepEqual(
    TITLE_GAMES.map((game) => [game.code, game.gameType, game.suffix]),
    [
      ["MSBL", 3, "msbl"],
      ["MSC", 1, "msc"],
      ["SMS", 2, "sms"],
    ],
  );
  assert.equal(gameByType(1)?.code, "MSC");
  assert.equal(gameByType(0), null);
  assert.equal(gameByCode(" msbl ")?.gameType, 3);
  assert.equal(gameLabel(2), "SMS");
  assert.equal(gameLabel(7), "game 7");
});

test("anything that is no known game is none, and sorts after the games", () => {
  assert.equal(titleGameCode("sms"), "SMS");
  assert.equal(titleGameCode(null), "");
  assert.equal(titleGameCode("?"), "");
  assert.deepEqual(["", "SMS", "MSBL", "MSC"].map(gameRank), [3, 2, 0, 1]);
});
