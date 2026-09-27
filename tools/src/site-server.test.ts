import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { REPO_ROOT } from "./processes.ts";
import { createSiteServer } from "./site-server.ts";

let api: Server;
let site: Server;
let base = "";

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

before(async () => {
  // Stand-in API that echoes what it received.
  api = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      response.writeHead(201, { "Content-Type": "application/json", "Set-Cookie": "session=abc; HttpOnly" });
      response.end(JSON.stringify({ method: request.method, url: request.url, body, cookie: request.headers.cookie }));
    });
  });
  const apiOrigin = await listen(api);
  site = createSiteServer({ root: join(REPO_ROOT, "apps", "web", "public"), apiOrigin });
  base = await listen(site);
});

after(() => {
  site.close();
  api.close();
});

test("pages, assets and redirects follow the production routes", async () => {
  const page = await fetch(`${base}/msc-tierlist?ref=test`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await page.text(), /<body data-page="msc-tierlist">/);

  const css = await fetch(`${base}/css/global.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /text\/css/);

  const legacy = await fetch(`${base}/pages/players.html?sample=1`, { redirect: "manual" });
  assert.equal(legacy.status, 301);
  assert.equal(legacy.headers.get("location"), "/players?sample=1");

  assert.equal((await fetch(`${base}/assets/`)).status, 403);
  assert.equal((await fetch(`${base}/MSBL`)).status, 404);
  assert.equal((await fetch(`${base}/players`, { method: "POST" })).status, 405);

  const head = await fetch(`${base}/players`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("repository files outside the site are never served", async () => {
  for (const path of [
    "/package.json",
    "/../package.json",
    "/%2e%2e/package.json",
    "/apps/api/src/config.ts",
    "/.env",
  ]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
});

test("/api requests reach the API unchanged, with status, cookies and body", async () => {
  const response = await fetch(`${base}/api/auth/logout?x=1`, {
    method: "POST",
    headers: { Cookie: "session=old", "Content-Type": "text/plain" },
    body: "payload",
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("set-cookie"), "session=abc; HttpOnly");
  assert.deepEqual(await response.json(), {
    method: "POST",
    url: "/api/auth/logout?x=1",
    body: "payload",
    cookie: "session=old",
  });
});
