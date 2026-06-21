// Recursively syntax-checks every .js file under src/ with `node --check`.
// Replaces the hand-maintained file list that the previous `check` script kept
// in sync by hand (a new module used to silently go unchecked). Cross-platform:
// pure Node, no shell globbing.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SRC_ROOT = path.join(__dirname, "..");

function collectJsFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

const files = collectJsFiles(SRC_ROOT, []).sort();
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failed += 1;
    process.stderr.write("[check] Syntax error in " + path.relative(SRC_ROOT, file) + "\n");
    if (error && error.stderr) {
      process.stderr.write(error.stderr.toString());
    }
  }
}

if (failed) {
  process.stderr.write("[check] " + failed + " file(s) failed syntax check.\n");
  process.exit(1);
}

process.stdout.write("[check] " + files.length + " file(s) OK.\n");
