// Node file-system view of a built site for resolveRoute(); used by local servers, tools and tests.

import { statSync } from "node:fs";
import { join } from "node:path";
import type { StaticFiles } from "./routes.ts";

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
