// Production-like local stack with invented data: the built site (apps/web/dist) routed like nginx,
// plus the API in fixture mode. Used by `npm run preview` and the comparison checks.
//   PORT (default 8787): site; the API listens on PORT + 1000 and is reached through /api.

import { join } from "node:path";
import { REPO_ROOT, readPort, startProcess, stopOnExit, waitForHttp } from "./processes.ts";
import { createSiteServer } from "./site-server.ts";

const port = readPort("PORT", 8787);
const apiPort = port + 1000;
const apiOrigin = `http://127.0.0.1:${apiPort}`;

const api = startProcess("api", process.execPath, ["apps/api/src/dev.ts"], {
  PORT: String(apiPort),
  DEV_HOST: "127.0.0.1",
});
await waitForHttp(`${apiOrigin}/api/health`, api);

const site = createSiteServer({ root: join(REPO_ROOT, "apps", "web", "dist"), apiOrigin });
site.listen(port, "127.0.0.1", () => {
  console.log(`[site] Built site with sample data: http://localhost:${port}`);
});
stopOnExit([api], () => site.close());
