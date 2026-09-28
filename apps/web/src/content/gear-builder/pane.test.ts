// The generated Gear Builder panes against their recorded output (pane.golden.json). The first recording
// matched the snapshot's former pane files line by line (trimmed); an intended markup change re-records it.
// Everything the builder's scripts read (ids, classes, values) must stay as it is.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { GEAR_CHARACTERS } from "./characters.ts";
import { renderPane } from "./pane.ts";

const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "pane.golden.json"), "utf8")) as {
  readonly panes: Readonly<Record<string, string>>;
};

test("every character pane renders like the former pane file", () => {
  assert.deepEqual(GEAR_CHARACTERS.map((character) => character.slug).sort(), Object.keys(golden.panes).sort());
  for (const character of GEAR_CHARACTERS) {
    const trimmed = renderPane(character)
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
    assert.equal(createHash("sha256").update(trimmed).digest("hex"), golden.panes[character.slug], character.slug);
  }
});

function paneOf(slug: string): string {
  const character = GEAR_CHARACTERS.find((entry) => entry.slug === slug);
  assert.ok(character, slug);
  return renderPane(character);
}

test("panes have the tab, table, card and button ids the builder scripts look up", () => {
  const luigi = paneOf("luigi");
  assert.match(luigi, /id="tab-02" role="tabpanel" aria-labelledby="tab-02-link"/);
  assert.match(luigi, /id="table02"/);
  assert.match(luigi, /class="buildcard luigi" id="card2"/);
  assert.equal(luigi.match(/id="btn1\d\d"/g)?.length, 40);
  assert.equal(paneOf("mario").match(/id="btn\d\d"/g)?.length, 40);
});
