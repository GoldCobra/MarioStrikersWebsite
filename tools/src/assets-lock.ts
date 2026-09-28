// Guards against stale browser caches: images, fonts and the Gear Builder snapshot keep their URL when
// their content changes, and browsers cache them for up to a month. assets.lock.json records a hash of
// every such file; a changed file fails `npm run check` until its ?v= cache tag is bumped where it is
// referenced (or it gets a new name) and the lock is renewed:
//   node tools/src/assets-lock.ts          check (part of npm run check)
//   node tools/src/assets-lock.ts --write  renew the lock after the tags are bumped

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./processes.ts";

const PUBLIC = path.join(REPO_ROOT, "apps/web/public");
const LOCK = path.join(REPO_ROOT, "apps/web/assets.lock.json");
const ROOTS = ["assets", "pages/templates"];

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const current: Record<string, string> = {};
for (const root of ROOTS) {
  for (const file of walk(path.join(PUBLIC, root)).sort()) {
    const name = path.relative(PUBLIC, file).split(path.sep).join("/");
    current[name] = createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
  }
}

if (process.argv.includes("--write")) {
  fs.writeFileSync(LOCK, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`[assets] ${Object.keys(current).length} files locked.`);
} else {
  const locked = JSON.parse(fs.readFileSync(LOCK, "utf8")) as Record<string, string>;
  const changed = Object.keys(current).filter((name) => locked[name] !== undefined && locked[name] !== current[name]);
  const added = Object.keys(current).filter((name) => locked[name] === undefined);
  const removed = Object.keys(locked).filter((name) => current[name] === undefined);
  if (changed.length || added.length || removed.length) {
    for (const name of changed)
      console.error(`[assets] changed: ${name} (bump its ?v= cache tag where it is referenced, or give it a new name)`);
    for (const name of added) console.error(`[assets] new: ${name}`);
    for (const name of removed) console.error(`[assets] removed: ${name}`);
    console.error("[assets] Then renew the lock: node tools/src/assets-lock.ts --write");
    process.exitCode = 1;
  } else {
    console.log(`[assets] ${Object.keys(current).length} files match the lock.`);
  }
}
