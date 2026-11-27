import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { digestApiKey, findApiKey, generateApiKey, parseApiKeys } from "./keys.ts";

const TEST_KEY = "rch_test_" + "a".repeat(43);
const LIVE_KEY = "rch_live_" + "b".repeat(43);
const hex = (key: string): string => crypto.createHash("sha256").update(key).digest("hex");

test("keys are read from test: and live: entries of their SHA-256", () => {
  const { keys, problems } = parseApiKeys([`test:${hex(TEST_KEY)}`, ` LIVE:${hex(LIVE_KEY).toUpperCase()} `]);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    keys.map((key) => [key.environment, key.digest.toString("hex")]),
    [
      ["test", hex(TEST_KEY)],
      ["live", hex(LIVE_KEY)],
    ],
  );
});

test("a wrong entry is reported by its position, never by its value", () => {
  const { keys, problems } = parseApiKeys([
    `test:${hex(TEST_KEY)}`,
    "staging:" + hex(LIVE_KEY),
    `live:${hex(LIVE_KEY).slice(1)}`,
    TEST_KEY,
    `live:${hex(TEST_KEY)}`,
  ]);
  assert.equal(keys.length, 1);
  assert.deepEqual(problems, [
    "entry 2 is not test:<sha256 hex> or live:<sha256 hex>",
    "entry 3 is not test:<sha256 hex> or live:<sha256 hex>",
    "entry 4 is not test:<sha256 hex> or live:<sha256 hex>",
    "entry 5 repeats a key",
  ]);
  assert.ok(problems.every((problem) => !problem.includes(hex(LIVE_KEY)) && !problem.includes(TEST_KEY)));
});

test("a request's Bearer key finds its configured key, anything else none", () => {
  const { keys } = parseApiKeys([`test:${hex(TEST_KEY)}`, `live:${hex(LIVE_KEY)}`]);
  assert.equal(findApiKey(`Bearer ${TEST_KEY}`, keys)?.environment, "test");
  assert.equal(findApiKey(`Bearer ${LIVE_KEY}`, keys)?.environment, "live");
  assert.equal(findApiKey(`bearer   ${LIVE_KEY} `, keys)?.environment, "live");
  for (const header of [
    undefined,
    "",
    TEST_KEY,
    `Basic ${TEST_KEY}`,
    `Bearer ${TEST_KEY}x`,
    `Bearer ${TEST_KEY} extra`,
    "Bearer ",
    ["Bearer", TEST_KEY],
  ]) {
    assert.equal(findApiKey(header, keys), null, String(header));
  }
  assert.equal(findApiKey(`Bearer ${TEST_KEY}`, []), null);
});

test("a generated key has 256 random bits and its entry is its digest", () => {
  const first = generateApiKey("test");
  const second = generateApiKey("live");
  assert.match(first.key, /^rch_test_[A-Za-z0-9_-]{43}$/);
  assert.match(second.key, /^rch_live_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.key.slice(9), second.key.slice(9));
  assert.equal(first.entry, `test:${digestApiKey(first.key).toString("hex")}`);
  const { keys, problems } = parseApiKeys([first.entry, second.entry]);
  assert.deepEqual(problems, []);
  assert.equal(findApiKey(`Bearer ${second.key}`, keys)?.environment, "live");
});
