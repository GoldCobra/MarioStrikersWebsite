// Check browser JavaScript and literal local asset references without a build step.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../../..");
const errors = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function checkReference(file, raw) {
  const value = raw.trim().replace(/&amp;/g, "&");
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value) || /[{}]/.test(value)) return;
  let pathname;
  try {
    pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  } catch {
    errors.push(`${relative(file)}: invalid asset URL ${value}`);
    return;
  }
  // Extensionless page URLs and API calls are checked by the server smoke tests.
  if (!/\.(?:html|css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|xml)$/i.test(pathname)) return;
  // Fetched fragments are inserted into a page; URLs resolve against that host
  // page, not the template's deeper filesystem directory.
  const baseDirectory = relative(file).startsWith("pages/templates/")
    ? path.join(root, "pages")
    : path.dirname(file);
  let target = pathname.startsWith("/")
    ? path.join(root, pathname.slice(1))
    : path.resolve(baseDirectory, pathname);
  // Browser-loaded templates resolve root-relative assets explicitly; legacy root
  // HTML page aliases still map to physical files in pages/.
  if (!fs.existsSync(target) && /^\/[a-z\d-]+\.html$/i.test(pathname)) {
    target = path.join(root, "pages", pathname.slice(1));
  }
  const withinRoot = path.relative(root, target);
  if (withinRoot.startsWith("..") || path.isAbsolute(withinRoot) || !fs.existsSync(target)) {
    errors.push(`${relative(file)}: missing local asset ${value}`);
  }
}

const scripts = [...walk(path.join(root, "js")), ...walk(path.join(root, "assets/gear-builder"))]
  .filter((file) => /\.(?:js|mjs)$/.test(file));
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    errors.push(`${relative(file)}: ${error.stderr || error.message}`);
  }
}

const htmlFiles = [path.join(root, "index.html"), ...walk(path.join(root, "pages"))]
  .filter((file) => file.endsWith(".html"));
const cssFiles = [...walk(path.join(root, "css")), ...walk(path.join(root, "assets/gear-builder"))]
  .filter((file) => file.endsWith(".css"));
for (const file of htmlFiles) {
  const source = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  for (const match of source.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) {
    checkReference(file, match[1]);
  }
}
for (const file of cssFiles) {
  const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) {
    checkReference(file, match[1]);
  }
}

if (errors.length) {
  process.stderr.write(errors.join("\n") + "\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`[frontend] ${scripts.length} scripts, ${htmlFiles.length} pages and ${cssFiles.length} stylesheets checked.\n`);
}
