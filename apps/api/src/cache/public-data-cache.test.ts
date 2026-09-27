import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { silentLogger, type Logger } from "../lib/logger.ts";
import { PublicDataCache, type PublicDataCacheOptions } from "./public-data-cache.ts";

function createCache(options: Partial<PublicDataCacheOptions>): PublicDataCache {
  return new PublicDataCache({
    loaders: {},
    ttlMs: 60000,
    refreshIntervalMs: 0,
    parallelism: 1,
    snapshotPath: "",
    loadSnapshot: false,
    log: silentLogger,
    ...options,
  });
}

test("returns a fresh hit after the initial cold miss", async () => {
  let calls = 0;
  const cache = createCache({
    loaders: {
      alpha: () => {
        calls += 1;
        return Promise.resolve({ value: calls });
      },
    },
  });
  const first = await cache.get("alpha");
  const second = await cache.get("alpha");
  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.cacheStatus, "hit");
  assert.deepEqual(first.payload, { value: 1 });
  assert.deepEqual(second.payload, { value: 1 });
  assert.equal(calls, 1);
});

test("returns stale data immediately and refreshes in the background", async () => {
  let calls = 0;
  const cache = createCache({
    loaders: {
      alpha: () => {
        calls += 1;
        return Promise.resolve({ value: `fresh-${calls}` });
      },
    },
  });
  cache.entries.set("alpha", { payload: { value: "old" }, generatedAtMs: Date.now() - 120000 });
  const stale = await cache.get("alpha");
  const refresh = cache.inFlight.get("alpha");
  assert.equal(stale.cacheStatus, "stale");
  assert.deepEqual(stale.payload, { value: "old" });
  assert.ok(refresh);
  await refresh;
  assert.deepEqual((await cache.get("alpha")).payload, { value: "fresh-1" });
});

test("shares one loader promise for parallel cold misses", async () => {
  let calls = 0;
  let resolveLoader: (value: unknown) => void = () => undefined;
  const loaded = new Promise((resolve) => {
    resolveLoader = resolve;
  });
  const cache = createCache({
    loaders: {
      alpha: () => {
        calls += 1;
        return loaded;
      },
    },
  });
  const first = cache.get("alpha");
  const second = cache.get("alpha");
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveLoader({ value: "loaded" });
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => [result.cacheStatus, result.payload]),
    [
      ["miss", { value: "loaded" }],
      ["miss", { value: "loaded" }],
    ],
  );
  assert.equal(calls, 1);
});

test("loads and saves a persistent snapshot", async () => {
  const snapshotPath = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "public-data-cache-")),
    "public-data-cache.json",
  );
  const first = createCache({ snapshotPath, loaders: { alpha: () => Promise.resolve({ value: "snapshot" }) } });
  await first.get("alpha");
  await first.saveSnapshot();
  const second = createCache({
    snapshotPath,
    loadSnapshot: true,
    loaders: { alpha: () => Promise.resolve({ value: "should-not-load" }) },
  });
  const loaded = await second.get("alpha");
  assert.equal(loaded.cacheStatus, "hit");
  assert.deepEqual(loaded.payload, { value: "snapshot" });
});

test("snapshots of another version or unknown keys are ignored", async () => {
  const snapshotPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "public-data-cache-")), "snapshot.json");
  const saved = { generatedAt: new Date().toISOString(), payload: { value: "saved" } };
  await fs.writeFile(snapshotPath, JSON.stringify({ version: 4, entries: { alpha: saved } }));
  const oldVersion = createCache({
    snapshotPath,
    loadSnapshot: true,
    loaders: { alpha: () => Promise.resolve("loaded") },
  });
  assert.equal((await oldVersion.get("alpha")).cacheStatus, "miss");
  await fs.writeFile(snapshotPath, JSON.stringify({ version: 5, entries: { beta: saved } }));
  const unknownKey = createCache({
    snapshotPath,
    loadSnapshot: true,
    loaders: { alpha: () => Promise.resolve("loaded") },
  });
  assert.equal(unknownKey.entries.size, 0);
});

test("logs slow refreshes and warmup duration", async () => {
  const warnings: string[] = [];
  const infos: string[] = [];
  const log: Logger = {
    ...silentLogger,
    info: (_details: unknown, message?: string) => {
      infos.push(String(message));
    },
    warn: (_details: unknown, message?: string) => {
      warnings.push(String(message));
    },
  };
  const cache = createCache({
    slowRefreshThresholdMs: 1,
    log,
    loaders: {
      alpha: async () => {
        await new Promise((done) => setTimeout(done, 5));
        return { value: "slow" };
      },
    },
  });
  await cache.warmupAll();
  assert.ok(warnings.some((message) => /Slow refresh for alpha: \d+ms/.test(message)));
  assert.ok(infos.some((message) => /Warmup complete: 1\/1 datasets refreshed in \d+ms/.test(message)));
});
