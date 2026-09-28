// Checks the built site (apps/web/dist; run npm run build first): browser scripts for syntax errors and
// every literal local asset reference in its HTML and CSS for a matching file.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createStaticFiles } from "@ms/shared/site/node-static-files";
import { resolveRoute } from "@ms/shared/site/routes";
import { SITE_ORIGIN } from "@ms/shared/site/site";

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

// The bundled modules and the Gear Builder snapshot's own scripts.
const scripts = [...walk(path.join(root, "_astro")), ...walk(path.join(root, "assets/gear-builder"))].filter((file) =>
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
// Page images reserve their space before they load and describe themselves (alt="" marks decoration).
// Fragments in pages/templates/ are filled in by scripts and are exempt.
function checkImages(file: string, source: string): void {
  if (relative(file).startsWith("pages/templates/")) return;
  for (const [tag] of source.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\ssrc=/.test(tag)) continue;
    if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) {
      errors.push(`${relative(file)}: image without width and height ${tag}`);
    }
    const alt = /\salt="([^"]*)"/.exec(tag)?.[1];
    if (alt === undefined || /\.(?:png|jpe?g|gif|webp|avif|svg)\b/i.test(alt)) {
      errors.push(`${relative(file)}: image without a descriptive alt text ${tag}`);
    }
  }
}

// A Content Security Policy blocks inline event handlers and inline scripts. The Gear Builder snapshot's
// template is the one exception: its host turns the handlers into listeners.
const INLINE_HANDLER = /<[a-z][^>]*\son[a-z]+\s*=/i;
const INLINE_SCRIPT = /<script\b(?![^>]*\ssrc=)(?![^>]*type="application\/ld\+json")[^>]*>/i;
function checkInlineCode(file: string, source: string): void {
  if (relative(file) === "pages/templates/msbl-gear-builder.html") return;
  if (INLINE_HANDLER.test(source)) errors.push(`${relative(file)}: inline event handler`);
  if (INLINE_SCRIPT.test(source)) errors.push(`${relative(file)}: inline script`);
}
for (const file of walk(path.join(root, "_astro")).filter((name) => name.endsWith(".js"))) {
  if (/\son(?:error|load|click)=\\?["']/.test(fs.readFileSync(file, "utf8"))) {
    errors.push(`${relative(file)}: markup with an inline event handler`);
  }
}

// Ids must be unique within a document (the Gear Builder snapshot's template is its authors').
function checkIds(file: string, source: string): void {
  if (relative(file) === "pages/templates/msbl-gear-builder.html") return;
  const seen = new Set<string>();
  for (const [, id] of source.matchAll(/<[a-z][^>]*\sid="([^"]+)"/gi)) {
    if (id && seen.has(id)) errors.push(`${relative(file)}: duplicate id "${id}"`);
    if (id) seen.add(id);
  }
}

// Links between pages must reach a page, directly or through a redirect, as production nginx routes them.
const staticFiles = createStaticFiles(root);
function checkPageLink(file: string, raw: string): void {
  const value = raw.trim().replace(/&amp;/g, "&");
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value) || ASSET_EXTENSION.test(value.split(/[?#]/)[0] ?? ""))
    return;
  const url = new URL(value, servedUrl(file));
  let route = resolveRoute(url.pathname, url.search, staticFiles);
  if (route.kind === "redirect") {
    const target = new URL(route.location, url);
    route = resolveRoute(target.pathname, target.search, staticFiles);
  }
  if (route.kind !== "file") errors.push(`${relative(file)}: link to ${value} does not reach a page`);
}

// Every indexable page names itself as canonical, and the sitemap lists exactly those pages.
const indexable = new Set<string>();
function checkCanonical(file: string, source: string): void {
  const name = relative(file);
  const slug = name === "index.html" ? "" : /^pages\/([a-z\d-]+)\.html$/.exec(name)?.[1];
  if (slug === undefined) return;
  const canonical = /<link rel="canonical" href="([^"]+)">/.exec(source)?.[1];
  const noindex = /<meta name="robots" content="[^"]*noindex/.test(source);
  if (canonical !== undefined && canonical !== `${SITE_ORIGIN}/${slug}`) {
    errors.push(`${name}: canonical ${canonical} is not the page's own URL`);
  }
  if (!noindex && canonical) indexable.add(canonical);
}

for (const file of htmlFiles) {
  const source = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  checkInlineCode(file, source);
  checkIds(file, source);
  checkCanonical(file, source);
  for (const match of source.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) {
    checkReference(file, match[1] ?? "");
  }
  if (!relative(file).startsWith("pages/templates/")) {
    for (const match of source.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["']/gi))
      checkPageLink(file, match[1] ?? "");
  }
  checkImages(file, source);
}

const sitemap = new Set(
  [...fs.readFileSync(path.join(root, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1],
  ),
);
for (const url of sitemap) if (url && !indexable.has(url)) errors.push(`sitemap.xml: ${url} is not an indexable page`);
for (const url of indexable) if (!sitemap.has(url)) errors.push(`sitemap.xml: indexable page ${url} is missing`);
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
