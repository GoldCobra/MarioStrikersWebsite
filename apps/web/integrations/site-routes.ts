// Development server routing: the same resolveRoute() that production nginx mirrors, so clean URLs,
// legacy redirects and 404s behave locally exactly as they do on the live site.

import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { PAGE_FILES, createSourceSiteFiles } from "@ms/shared/site/node-static-files";
import { resolveRoute } from "@ms/shared/site/routes";

// Requests the dev server itself answers (Vite client, modules, the API proxy).
const PASS_THROUGH = /^\/(?:api\/|@|__|node_modules\/|src\/)/;

/** The dev server's own route of a rendered page: "/" or "/pages/<slug>". */
function astroRoute(file: string): string {
  return file === "/index.html" ? "/" : file.replace(/\.html$/, "");
}

export function siteRoutes(): AstroIntegration {
  return {
    name: "ms:site-routes",
    hooks: {
      "astro:server:setup": ({ server }) => {
        const files = createSourceSiteFiles(fileURLToPath(new URL("../public", import.meta.url)));
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (PASS_THROUGH.test(url.pathname)) {
            next();
            return;
          }
          const route = resolveRoute(url.pathname, url.search, files);
          if (route.kind === "redirect") {
            response.writeHead(301, { Location: route.location });
            response.end();
          } else if (route.kind === "file") {
            request.url = (PAGE_FILES.has(route.path) ? astroRoute(route.path) : route.path) + url.search;
            next();
          } else if (route.kind === "not-found") {
            // Astro renders src/pages/404.astro with status 404 for a path no route matches.
            request.url = "/__not-found";
            next();
          } else {
            response.writeHead(403, { "Content-Type": "text/plain" });
            response.end("Forbidden.");
          }
        });
      },
    },
  };
}
