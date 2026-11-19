import assert from "node:assert/strict";
import test from "node:test";
import { silentLogger, type Logger } from "../../lib/logger.ts";
import { createUploadedLogos, type UploadedLogo } from "./uploaded-logos.ts";

const LOGO: UploadedLogo = { contentType: "image/webp", hash: "abc", data: Buffer.from("webp") };

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("the index is read once a minute, and a club without an uploaded logo never reads one", async () => {
  const clock = { now: 0 };
  const calls: string[] = [];
  const logos = createUploadedLogos(
    {
      hashes: () => {
        calls.push("hashes");
        return Promise.resolve(new Map([[5, "abc"]]));
      },
      logo: (clubId) => {
        calls.push(`logo ${String(clubId)}`);
        return Promise.resolve(clubId === 5 ? LOGO : undefined);
      },
    },
    { log: silentLogger, now: () => clock.now },
  );
  assert.equal(await logos.get(7), null);
  assert.deepEqual(await logos.get(5), LOGO);
  clock.now = 59_999;
  assert.equal(await logos.get(7), null);
  assert.deepEqual(calls, ["hashes", "logo 5"]);
  clock.now = 60_000;
  assert.equal(await logos.get(7), null, "an expired index answers while it is read again");
  assert.deepEqual(calls, ["hashes", "logo 5", "hashes"]);
});

test("after a change the next lookup waits for a read that started after it", async () => {
  let stored = new Map<number, string>();
  const releases: (() => void)[] = [];
  const logos = createUploadedLogos(
    {
      hashes: () => {
        const snapshot = new Map(stored);
        return new Promise((resolve) => {
          releases.push(() => {
            resolve(snapshot);
          });
        });
      },
      logo: () => Promise.resolve(LOGO),
    },
    { log: silentLogger, now: () => 0 },
  );
  const before = logos.get(5);
  stored = new Map([[5, "abc"]]);
  logos.invalidate();
  const after = logos.get(5);
  assert.equal(releases.length, 2, "the change starts a read of its own");
  releases[0]?.();
  await flush();
  releases[1]?.();
  assert.deepEqual(await after, LOGO);
  assert.deepEqual(await before, LOGO, "the read from before the change is dropped, not answered");
});

test("a failed index read serves link logos for a minute; a failed read of a known logo throws", async () => {
  const clock = { now: 0 };
  let down = true;
  const warnings: unknown[] = [];
  const log: Logger = { ...silentLogger, warn: (...args: unknown[]) => warnings.push(args) };
  const logos = createUploadedLogos(
    {
      hashes: () => (down ? Promise.reject(new Error("database down")) : Promise.resolve(new Map([[5, "abc"]]))),
      logo: () => (down ? Promise.reject(new Error("database down")) : Promise.resolve(LOGO)),
    },
    { log, now: () => clock.now },
  );
  assert.equal(await logos.get(5), null, "link logos only");
  assert.equal(warnings.length, 1);
  down = false;
  assert.equal(await logos.get(5), null, "no new read before the minute is over");
  clock.now = 60_000;
  await logos.get(5);
  await flush();
  assert.deepEqual(await logos.get(5), LOGO);
  down = true;
  await assert.rejects(logos.get(5), /database down/, "a known logo never falls back to an older link");
});
