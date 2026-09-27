import assert from "node:assert/strict";
import { test } from "node:test";
import { silentLogger } from "../../lib/logger.ts";
import { WiimmfiService, parseWiimmfiText, type WiimmfiPlayer } from "./service.ts";

const SAMPLE = [
  "! id4|pid|fc|host|gid|ls|ol|status|suspend|n|name1|name2",
  "|R4QP|601234567|1234-5678-9012|0|0|0|0|0|0|1|  Player One |",
  "|R4QE|601234568|2234-5678-9012|0|0|0|0|0|0|1||",
  "",
  "|R4QJ|601234569|3234-5678-9012|0|0|0|0|0|0|1|サンプル|",
].join("\n");

test("the Wiimmfi text export parses into region, friend code and name", () => {
  assert.deepEqual(parseWiimmfiText(SAMPLE), [
    { region: "R4QP", friendCode: "1234-5678-9012", name: "Player One" },
    { region: "R4QJ", friendCode: "3234-5678-9012", name: "サンプル" },
  ]);
  assert.deepEqual(parseWiimmfiText(""), []);
});

test("only the first request waits; later ones get the last list while one refresh runs", async () => {
  let loads = 0;
  let release: (players: WiimmfiPlayer[]) => void = () => undefined;
  const service = new WiimmfiService({
    maxAgeMs: 0,
    log: silentLogger,
    load: () => {
      loads += 1;
      if (loads === 1) return Promise.resolve([{ region: "R4QP", friendCode: "1", name: "First" }]);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  assert.equal((await service.getPlayers())[0]?.name, "First");
  // Stale now: both calls answer immediately from the cache and share one background refresh.
  assert.equal((await service.getPlayers())[0]?.name, "First");
  assert.equal((await service.getPlayers())[0]?.name, "First");
  assert.equal(loads, 2);
  release([{ region: "R4QP", friendCode: "2", name: "Second" }]);
  await new Promise((done) => setImmediate(done));
  assert.equal((await service.getPlayers())[0]?.name, "Second");
});

test("a failed first load is reported, a failed refresh keeps the last list", async () => {
  let fail = true;
  const service = new WiimmfiService({
    maxAgeMs: 0,
    log: silentLogger,
    load: () =>
      fail
        ? Promise.reject(new Error("FlareSolverr down"))
        : Promise.resolve([{ region: "", friendCode: "", name: "Ok" }]),
  });
  await assert.rejects(service.getPlayers(), /FlareSolverr down/);
  fail = false;
  assert.equal((await service.getPlayers())[0]?.name, "Ok");
  fail = true;
  assert.equal((await service.getPlayers())[0]?.name, "Ok");
});
