import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { transform } from "lightningcss";

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

test("minifying keeps every at-rule, prefixed declaration, !important and referenced file", () => {
  const variables = new Map(
    [...source.matchAll(/^import (\w+) from "\.\/([\w-]+\.css)\?raw";$/gm)].map((match) => [match[1], match[2]]),
  );
  const order =
    /export const GLOBAL_CSS = \[([\s\S]*?)\]/
      .exec(source)?.[1]
      ?.split(",")
      .map((name) => name.trim()) ?? [];
  const css = order
    .filter(Boolean)
    .map((name) => readFileSync(path.join(import.meta.dirname, variables.get(name) ?? ""), "utf8"))
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const minified = transform({ filename: "global.css", code: Buffer.from(css), minify: true }).code.toString();

  const tally = (text: string, pattern: RegExp): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const match of text.matchAll(pattern)) counts[match[1] ?? match[0]] = (counts[match[1] ?? match[0]] ?? 0) + 1;
    return counts;
  };
  for (const pattern of [
    /@(media|font-face|supports|keyframes)\b/g,
    /(-(?:webkit|moz|ms)-[a-z-]+)\s*:/g,
    /(::?-(?:webkit|moz|ms)-[a-z-]+)/g,
    /([a-z-]+)\s*:[^;{}]*!important/g,
  ]) {
    assert.deepEqual(tally(minified, pattern), tally(css, pattern), pattern.source);
  }
  const files = (text: string): string[] =>
    [...new Set([...text.matchAll(/url\(\s*["']?([^"')\s]+)/g)].map((match) => match[1] ?? ""))].sort();
  assert.deepEqual(files(minified), files(css));
  assert.ok(minified.length < css.length * 0.85);
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
