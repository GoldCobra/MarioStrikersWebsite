import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { isPublicAddress, safeDownload, type SafeDownloadOptions } from "./safe-download.ts";

let server: Server;
let port = 0;

before(async () => {
  server = createServer((request, response) => {
    if (request.url === "/logo.png") {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end("png-bytes");
    } else if (request.url === "/to-internal") {
      response.writeHead(302, { Location: "http://internal.test/secret" });
      response.end();
    } else if (request.url === "/to-logo") {
      response.writeHead(301, { Location: "/logo.png" });
      response.end();
    } else if (request.url === "/loop") {
      response.writeHead(302, { Location: "/loop" });
      response.end();
    } else if (request.url === "/huge") {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.write(Buffer.alloc(600));
      response.end(Buffer.alloc(600));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server.close();
});

// "localhost" is the stub server (the only host test isolation lets through); "internal.test" stands for a
// private network host.
const options: SafeDownloadOptions = {
  maxBytes: 1000,
  timeoutMs: 5000,
  allowInsecureHttp: true,
  lookup: (hostname) =>
    Promise.resolve(
      hostname === "localhost" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.5", family: 4 }],
    ),
  isAllowedAddress: (address) => address === "127.0.0.1",
};
const url = (path: string): string => `http://localhost:${port}${path}`;

test("downloads a public image with its content type", async () => {
  const result = await safeDownload(url("/logo.png"), options);
  assert.equal(result.contentType, "image/png");
  assert.equal(result.buffer.toString(), "png-bytes");
});

test("follows a redirect and re-checks the target", async () => {
  assert.equal((await safeDownload(url("/to-logo"), options)).buffer.toString(), "png-bytes");
  await assert.rejects(safeDownload(url("/to-internal"), options), /private address/);
});

test("stops redirect loops", async () => {
  await assert.rejects(safeDownload(url("/loop"), options), /redirected too often/);
});

test("caps the body while it streams", async () => {
  await assert.rejects(safeDownload(url("/huge"), options), /larger than the configured maximum/);
});

test("only HTTPS on port 443 is allowed in production mode", async () => {
  const strict = { ...options, allowInsecureHttp: false };
  await assert.rejects(safeDownload(url("/logo.png"), strict), /HTTPS on port 443/);
  await assert.rejects(safeDownload("https://logo.test:8443/logo.png", strict), /HTTPS on port 443/);
  await assert.rejects(safeDownload("ftp://logo.test/logo.png", strict), /HTTPS on port 443/);
});

test("literal private addresses are refused without a lookup", async () => {
  await assert.rejects(
    safeDownload("https://169.254.169.254/latest/meta-data", { maxBytes: 1000, timeoutMs: 1000 }),
    /private address/,
  );
});

test("the public address policy rejects private, loopback and reserved ranges", () => {
  for (const address of [
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["1.1.1.1", "162.159.128.233", "2606:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});
