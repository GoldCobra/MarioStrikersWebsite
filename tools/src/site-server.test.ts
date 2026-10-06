import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createSiteServer } from "./site-server.ts";

let api: Server;
let site: Server;
let base = "";
let root = "";
let privateRoot = "";

/** A minimal built site: the files a build writes for two pages, a stylesheet and an asset folder. */
function writeSite(): string {
  const dir = mkdtempSync(join(tmpdir(), "strikers-site-"));
  for (const folder of ["pages", "css", "assets"]) mkdirSync(join(dir, folder));
  writeFileSync(join(dir, "index.html"), '<!doctype html><body data-page="index"></body>');
  for (const slug of ["msc-tierlist", "players"]) {
    writeFileSync(join(dir, "pages", `${slug}.html`), `<!doctype html><body data-page="${slug}"></body>`);
  }
  writeFileSync(join(dir, "css", "global.css"), "body{}");
  writeFileSync(join(dir, "404.html"), '<!doctype html><body data-page="404"></body>');
  return dir;
}

/** The admin page as the build moves it out of the site (apps/web/integrations/private-pages.ts). */
function writePrivatePages(): string {
  const dir = mkdtempSync(join(tmpdir(), "strikers-private-"));
  mkdirSync(join(dir, "admin", "modules"), { recursive: true });
  writeFileSync(join(dir, "admin", "index.html"), '<!doctype html><body data-page="admin"></body>');
  writeFileSync(join(dir, "admin", "modules", "admin.js"), "export {};");
  return dir;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

before(async () => {
  // Stand-in API that echoes what it received.
  api = createServer((request, response) => {
    // The admin gate: yes only for the admin cookie and the secret path.
    if (request.url === "/internal/admin-gate") {
      const allowed =
        request.headers.cookie === "admin=yes" && String(request.headers["x-original-uri"]).startsWith("/_/secret/");
      response.writeHead(allowed ? 204 : 401);
      response.end();
      return;
    }
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      response.writeHead(201, { "Content-Type": "application/json", "Set-Cookie": "session=abc; HttpOnly" });
      response.end(JSON.stringify({ method: request.method, url: request.url, body, cookie: request.headers.cookie }));
    });
  });
  const apiOrigin = await listen(api);
  root = writeSite();
  privateRoot = writePrivatePages();
  site = createSiteServer({ root, apiOrigin, privateRoot });
  base = await listen(site);
});

after(() => {
  site.close();
  api.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(privateRoot, { recursive: true, force: true });
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
  const missing = await fetch(`${base}/MSBL`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /data-page="404"/);
  assert.equal((await fetch(`${base}/404.html`)).status, 404);
  assert.equal((await fetch(`${base}/players`, { method: "POST" })).status, 405);

  // Documents carry the production security headers; other files do not need them.
  const policy = page.headers.get("content-security-policy-report-only") ?? page.headers.get("content-security-policy");
  assert.match(policy ?? "", /default-src 'self'/);
  assert.equal(page.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.match(missing.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.equal(css.headers.get("cross-origin-opener-policy"), null);

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

test("the admin page is served only when the gate says yes; anything else is the ordinary not-found page", async () => {
  const notFound = await fetch(`${base}/does-not-exist`);
  const expected = { status: notFound.status, body: await notFound.text() };
  const admin = { Cookie: "admin=yes" };
  for (const [path, headers] of [
    ["/_/secret/", {}],
    ["/_/secret/", { Cookie: "admin=no" }],
    ["/_/wrong/", admin],
    ["/_/secret", admin],
    ["/_/secret/missing.js", admin],
    ["/_/secret/../404.html", admin],
    ["/_/", admin],
  ] as const) {
    const response = await fetch(`${base}${path}`, { headers });
    assert.deepEqual(
      { status: response.status, body: await response.text() },
      expected,
      `${path} ${JSON.stringify(headers)}`,
    );
  }

  const page = await fetch(`${base}/_/secret/`, { headers: admin });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-page="admin"/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const module = await fetch(`${base}/_/secret/modules/admin.js`, { headers: admin });
  assert.equal(module.status, 200);
  assert.match(module.headers.get("content-type") ?? "", /javascript/);
});
