// Node file-system views of the site for resolveRoute(); used by local servers, tools and tests.

import { statSync } from "node:fs";
import { join } from "node:path";
import { PAGES } from "./pages.ts";
import { pageFile, type StaticFiles } from "./routes.ts";

/** A built site (apps/web/dist) or any other directory served as the web root. */
export function createStaticFiles(root: string): StaticFiles {
  const kindOf = (path: string): "file" | "directory" | undefined => {
    // Reject traversal outside the root; resolveRoute only ever passes request paths.
    if (path.split("/").includes("..")) return undefined;
    const stats = statSync(join(root, decodeURIComponent(path)), { throwIfNoEntry: false });
    if (!stats) return undefined;
    return stats.isFile() ? "file" : stats.isDirectory() ? "directory" : undefined;
  };
  return {
    isFile: (path) => !path.endsWith("/") && kindOf(path) === "file",
    isDirectory: (path) => kindOf(path) === "directory",
  };
}

/** Page files a build writes for the registered pages ("/index.html", "/pages/<slug>.html"). */
export const PAGE_FILES: ReadonlySet<string> = new Set(PAGES.map((page) => pageFile(page.slug)));

/** The site before a build: static files from apps/web/public plus the pages rendered from the registry. */
export function createSourceSiteFiles(publicRoot: string): StaticFiles {
  const files = createStaticFiles(publicRoot);
  return {
    isFile: (path) => PAGE_FILES.has(path) || files.isFile(path),
    isDirectory: (path) => files.isDirectory(path),
  };
}
