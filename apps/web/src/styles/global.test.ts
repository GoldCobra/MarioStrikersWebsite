import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// global.ts imports its partials through Vite (?raw), so the check reads its source instead.
const source = readFileSync(path.join(import.meta.dirname, "global.ts"), "utf8");

test("every partial is part of the global stylesheet exactly once", () => {
  const imports = new Map(
    [...source.matchAll(/^import (\w+) from "\.\/([\w-]+\.css)\?raw";$/gm)].map((match) => [match[1], match[2]]),
  );
  const partials = readdirSync(import.meta.dirname).filter((file) => file.endsWith(".css"));
  assert.deepEqual([...imports.values()].sort(), partials.sort());

  const order = /export const GLOBAL_CSS = \[([\s\S]*?)\]\.join\(""\);/.exec(source)?.[1] ?? "";
  const listed = order
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  assert.deepEqual([...listed].sort(), [...imports.keys()].sort());
  assert.equal(new Set(listed).size, listed.length);
});

test("the cascade opens with the base rules and ends with the page-width overrides", () => {
  const order =
    /export const GLOBAL_CSS = \[([\s\S]*?)\]/
      .exec(source)?.[1]
      ?.split(",")
      .map((name) => name.trim()) ?? [];
  assert.equal(order[0], "base");
  assert.ok(order.indexOf("mobile") > order.indexOf("tablet"));
  assert.ok(order.indexOf("tablet") > order.indexOf("clubPopup"));
});
