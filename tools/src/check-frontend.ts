// Checks the built site (apps/web/dist; run npm run build first): browser scripts for syntax errors and
// every literal local asset reference in its HTML and CSS for a matching file.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../apps/web/dist");
if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("[frontend] No built site in apps/web/dist; run npm run build first.");
  process.exit(1);
}
const ASSET_EXTENSION = /\.(?:html|css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|xml)$/i;
const errors: string[] = [];

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function relative(file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

// The URL a browser resolves the file's relative references against. Pages in pages/ are served at
// /<slug>; fetched fragments are inserted into such a page.
function servedUrl(file: string): URL {
  const name = relative(file);
  if (name.startsWith("pages/templates/")) return new URL("https://site.test/page");
  const page = /^pages\/([a-z\d-]+)\.html$/.exec(name)?.[1];
  return new URL(page ? `/${page}` : `/${name}`, "https://site.test");
}

function checkReference(file: string, raw: string): void {
  const value = raw.trim().replace(/&amp;/g, "&");
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value) || /[{}]/.test(value)) return;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(value, servedUrl(file)).pathname);
  } catch {
    errors.push(`${relative(file)}: invalid asset URL ${value}`);
    return;
  }
  // Extensionless page URLs and API calls are checked by the route and API tests.
  if (!ASSET_EXTENSION.test(pathname)) return;
  let target = path.join(root, pathname.slice(1));
  // Legacy root HTML page aliases map to physical files in pages/.
  if (!fs.existsSync(target) && /^\/[a-z\d-]+\.html$/i.test(pathname)) {
    target = path.join(root, "pages", pathname.slice(1));
  }
  const withinRoot = path.relative(root, target);
  if (withinRoot.startsWith("..") || path.isAbsolute(withinRoot) || !fs.existsSync(target)) {
    errors.push(`${relative(file)}: missing local asset ${value}`);
  }
}

const scripts = [...walk(path.join(root, "js")), ...walk(path.join(root, "assets/gear-builder"))].filter((file) =>
  /\.(?:js|mjs)$/.test(file),
);
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString();
    errors.push(`${relative(file)}: ${stderr ?? String(error)}`);
  }
}

const rootPages = fs.readdirSync(root).map((name) => path.join(root, name));
const htmlFiles = [...rootPages, ...walk(path.join(root, "pages"))].filter((file) => file.endsWith(".html"));
const cssFiles = [...walk(path.join(root, "css")), ...walk(path.join(root, "assets/gear-builder"))].filter((file) =>
  file.endsWith(".css"),
);
for (const file of htmlFiles) {
  const source = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  for (const match of source.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) {
    checkReference(file, match[1] ?? "");
  }
}
for (const file of cssFiles) {
  const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) checkReference(file, match[1] ?? "");
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `[frontend] ${scripts.length} scripts, ${htmlFiles.length} pages and ${cssFiles.length} stylesheets checked.\n`,
  );
}
