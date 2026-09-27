import { defineConfig } from "astro/config";
import { siteRoutes } from "./integrations/site-routes.ts";

export default defineConfig({
  site: "https://mariostrikers.gg",
  output: "static",
  // Trailing slashes are handled by resolveRoute() (dev) and nginx (production), like every other route.
  trailingSlash: "ignore",
  build: { format: "file" },
  // Keep the markup byte-for-byte: whitespace between inline elements is visible.
  compressHTML: false,
  devToolbar: { enabled: false },
  integrations: [siteRoutes()],
  vite: {
    // Modules stay separate files, so a Content-Security-Policy can allow scripts by origin.
    build: { assetsInlineLimit: 0 },
    server: {
      proxy: { "/api": process.env.MS_API_ORIGIN ?? "http://127.0.0.1:8788" },
    },
  },
});
