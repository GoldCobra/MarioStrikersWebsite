// The hidden admin page (docs/adr/0011) leaves the public site after the build. Its document and the modules
// only it uses move from dist/ to dist-private/<target>/, which nginx serves only behind the admin gate and
// under the page's secret path (/_/<token>/). Moved modules keep importing the shared ones from /_astro/; the
// document refers to its own modules relatively (modules/...), so they resolve under that path, and to the
// site's files absolutely (the shell's "./assets/..." would resolve below the secret path). The build fails
// when anything of a private page would stay public.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

export interface PrivatePage {
  /** The page's file in dist/, as Astro builds it. */
  readonly file: string;
  /** Its folder in dist-private/. */
  readonly target: string;
}

export const PRIVATE_PAGES: readonly PrivatePage[] = [{ file: "admin.html", target: "admin" }];

/** The private output next to dist/ (apps/web/dist-private). */
export const PRIVATE_DIST_NAME = "dist-private";

/** The folder of a private page's own modules, next to its index.html. */
export const PRIVATE_MODULES_DIR = "modules";

const ASSET_REFERENCE = /\/_astro\/([A-Za-z0-9._-]+)/g;
const RELATIVE_IMPORT = /(["'])\.\/([A-Za-z0-9._-]+\.(?:js|css))\1/g;
// Attribute values relative to a page at /<slug>, such as the shell's "./assets/...".
const DOT_RELATIVE_ATTRIBUTE = /(\s(?:src|href|srcset|data-fallback-src)=")\.\//g;

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** The /_astro/ files a document refers to. */
function referencedAssets(source: string): Set<string> {
  return new Set([...source.matchAll(ASSET_REFERENCE)].map((match) => match[1] ?? ""));
}

/** Every /_astro/ file reachable from `roots` through the modules' relative imports. */
function closure(assetsDir: string, roots: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.pop() ?? "";
    if (seen.has(name)) continue;
    seen.add(name);
    const file = path.join(assetsDir, name);
    if (!name.endsWith(".js") || !fs.existsSync(file)) continue;
    for (const [, , imported] of fs.readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
      if (imported) queue.push(imported);
    }
  }
  return seen;
}

export interface MovedPage {
  readonly page: PrivatePage;
  readonly modules: readonly string[];
}

/** Moves the private pages of a built site (`dist`) into `privateRoot`, which is emptied first. */
export function movePrivatePages(dist: string, privateRoot: string, pages = PRIVATE_PAGES): MovedPage[] {
  const assetsDir = path.join(dist, "_astro");
  const privateFiles = new Set(pages.map((page) => path.join(dist, page.file)));
  for (const file of privateFiles) {
    if (!fs.existsSync(file)) throw new Error(`Private page ${path.relative(dist, file)} was not built.`);
  }
  const publicDocuments = walk(dist).filter((file) => file.endsWith(".html") && !privateFiles.has(file));
  const publicModules = closure(
    assetsDir,
    publicDocuments.flatMap((file) => [...referencedAssets(fs.readFileSync(file, "utf8"))]),
  );

  fs.rmSync(privateRoot, { recursive: true, force: true });
  const moved: MovedPage[] = [];
  for (const page of pages) {
    const source = path.join(dist, page.file);
    const html = fs.readFileSync(source, "utf8");
    const own = [...closure(assetsDir, referencedAssets(html))].filter((name) => !publicModules.has(name));
    const ownSet = new Set(own);
    const target = path.join(privateRoot, page.target);
    fs.mkdirSync(path.join(target, PRIVATE_MODULES_DIR), { recursive: true });
    for (const name of own) {
      const file = path.join(assetsDir, name);
      let content = fs.readFileSync(file, "utf8");
      if (name.endsWith(".js")) {
        content = content.replace(RELATIVE_IMPORT, (match, quote: string, imported: string) =>
          ownSet.has(imported) ? match : `${quote}/_astro/${imported}${quote}`,
        );
      }
      fs.writeFileSync(path.join(target, PRIVATE_MODULES_DIR, name), content);
      fs.rmSync(file);
    }
    fs.writeFileSync(
      path.join(target, "index.html"),
      html
        .replace(DOT_RELATIVE_ATTRIBUTE, "$1/")
        .replace(ASSET_REFERENCE, (match, name: string) =>
          ownSet.has(name) ? `${PRIVATE_MODULES_DIR}/${name}` : match,
        ),
    );
    fs.rmSync(source);
    moved.push({ page, modules: own });
  }

  // Nothing of a private page may stay public: no document, no module, no reference to one.
  const movedNames = moved.flatMap((entry) => entry.modules);
  for (const file of walk(dist).filter((name) => /\.(?:html|js|css|xml)$/.test(name))) {
    const content = fs.readFileSync(file, "utf8");
    const leaked = movedNames.find((name) => content.includes(name));
    if (leaked) throw new Error(`${path.relative(dist, file)} still refers to the private module ${leaked}.`);
  }
  return moved;
}

export function privatePages(): AstroIntegration {
  return {
    name: "ms:private-pages",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const privateRoot = path.join(path.dirname(path.resolve(dist)), PRIVATE_DIST_NAME);
        for (const { page, modules } of movePrivatePages(dist, privateRoot)) {
          logger.info(`${page.file} → ${PRIVATE_DIST_NAME}/${page.target}/ with ${String(modules.length)} module(s)`);
        }
      },
    },
  };
}
