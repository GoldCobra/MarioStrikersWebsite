import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createStaticFiles } from "./node-static-files.ts";
import { resolveRoute, type Route } from "./routes.ts";

const repoRoot = join(import.meta.dirname, "../../../..");
const site = createStaticFiles(join(repoRoot, "apps/web/public"));

interface RecordedRoute {
  path: string;
  status: number;
  location: string | null;
}

function toRecorded(path: string, route: Route): RecordedRoute {
  switch (route.kind) {
    case "file":
      return { path, status: 200, location: null };
    case "redirect":
      return { path, status: 301, location: route.location };
    case "forbidden":
      return { path, status: 403, location: null };
    case "not-found":
      return { path, status: 404, location: null };
  }
}

test("every URL shape recorded against production nginx resolves identically", () => {
  const golden = JSON.parse(readFileSync(join(repoRoot, "tests/e2e/golden/routes.json"), "utf8")) as RecordedRoute[];
  assert.ok(golden.length > 300);
  for (const expected of golden) {
    const [pathname = "", query = ""] = expected.path.split(/\?(.*)/s);
    const actual = toRecorded(expected.path, resolveRoute(pathname, query ? `?${query}` : "", site));
    assert.deepEqual(actual, expected, expected.path);
  }
});

test("prototype member names are ordinary unknown pages", () => {
  assert.deepEqual(resolveRoute("/constructor", "?submenu=toString", site), { kind: "not-found" });
  assert.deepEqual(resolveRoute("/games", "?submenu=constructor", site), { kind: "file", path: "/pages/games.html" });
});

test("path traversal never reaches files outside the site", () => {
  assert.deepEqual(resolveRoute("/../package.json", "", site), { kind: "not-found" });
  assert.deepEqual(resolveRoute("/assets/../../../package.json", "", site), { kind: "not-found" });
});
