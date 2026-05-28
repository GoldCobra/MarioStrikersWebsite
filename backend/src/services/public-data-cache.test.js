const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PublicDataCache } = require("./public-data-cache");

function createSilentLogger() {
  return {
    info: function () {},
    warn: function () {}
  };
}

function createCache(options) {
  return new PublicDataCache(Object.assign({
    ttlMs: 60000,
    refreshIntervalMs: 0,
    parallelism: 1,
    snapshotPath: "",
    loadSnapshot: false,
    logger: createSilentLogger()
  }, options || {}));
}

test("returns a fresh hit after the initial cold miss", async function () {
  let calls = 0;
  const cache = createCache({
    loaders: {
      alpha: async function () {
        calls += 1;
        return { value: calls };
      }
    }
  });

  const first = await cache.get("alpha");
  const second = await cache.get("alpha");

  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.cacheStatus, "hit");
  assert.equal(first.payload.value, 1);
  assert.equal(second.payload.value, 1);
  assert.equal(calls, 1);
});

test("returns stale data immediately and refreshes in the background", async function () {
  let calls = 0;
  const cache = createCache({
    ttlMs: 60000,
    loaders: {
      alpha: async function () {
        calls += 1;
        return { value: "fresh-" + calls };
      }
    }
  });

  cache.entries.set("alpha", {
    payload: { value: "old" },
    generatedAtMs: Date.now() - 120000
  });

  const stale = await cache.get("alpha");
  const refreshPromise = cache.inFlight.get("alpha");
  assert.equal(stale.cacheStatus, "stale");
  assert.equal(stale.payload.value, "old");
  assert.ok(refreshPromise);

  await refreshPromise;
  const fresh = await cache.get("alpha");
  assert.equal(fresh.payload.value, "fresh-1");
});

test("shares one loader promise for parallel cold misses", async function () {
  let calls = 0;
  let resolveLoader;
  const loaderPromise = new Promise(function (resolve) {
    resolveLoader = resolve;
  });
  const cache = createCache({
    loaders: {
      alpha: async function () {
        calls += 1;
        return loaderPromise;
      }
    }
  });

  const firstPromise = cache.get("alpha");
  const secondPromise = cache.get("alpha");
  await Promise.resolve();
  assert.equal(calls, 1);

  resolveLoader({ value: "loaded" });
  const results = await Promise.all([firstPromise, secondPromise]);

  assert.equal(results[0].cacheStatus, "miss");
  assert.equal(results[1].cacheStatus, "miss");
  assert.equal(results[0].payload.value, "loaded");
  assert.equal(results[1].payload.value, "loaded");
  assert.equal(calls, 1);
});

test("loads and saves a persistent snapshot", async function () {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "public-data-cache-"));
  const snapshotPath = path.join(tempDir, "public-data-cache.json");

  const firstCache = createCache({
    snapshotPath: snapshotPath,
    loaders: {
      alpha: async function () {
        return { value: "snapshot" };
      }
    }
  });

  await firstCache.get("alpha");
  await firstCache.saveSnapshot();

  const secondCache = new PublicDataCache({
    ttlMs: 60000,
    refreshIntervalMs: 0,
    parallelism: 1,
    snapshotPath: snapshotPath,
    loaders: {
      alpha: async function () {
        return { value: "should-not-load" };
      }
    },
    logger: createSilentLogger()
  });

  const loaded = await secondCache.get("alpha");
  assert.equal(loaded.cacheStatus, "hit");
  assert.equal(loaded.payload.value, "snapshot");
});
