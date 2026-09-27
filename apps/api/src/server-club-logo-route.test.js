const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

async function createLogoCacheFixture() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "club-logo-route-"));
  const fileName = "368-testhash.webp";
  await fs.writeFile(path.join(tempDir, fileName), "route-logo");
  await fs.writeFile(path.join(tempDir, "manifest.json"), JSON.stringify({
    version: 1,
    clubs: {
      "368": {
        sourceUrl: "https://cdn.discordapp.com/attachments/1/2/logo.webp?ex=one&is=two&hm=three",
        sourceIdentity: "discord:/attachments/1/2/logo.webp",
        hash: "testhash",
        fileName: fileName,
        contentType: "image/webp",
        byteLength: 10,
        cachedAt: new Date().toISOString()
      }
    }
  }), "utf8");
  return tempDir;
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve(server);
    });
  });
}

test("serves cached club logos from the API", async function () {
  process.env.CLUB_LOGO_CACHE_PATH = await createLogoCacheFixture();
  const { createApp } = require("./server");
  const server = await listen(createApp());

  try {
    const port = server.address().port;
    const response = await fetch("http://127.0.0.1:" + port + "/api/clubs/msbl/368/logo?v=testhash");
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(body, "route-logo");
  } finally {
    server.close();
  }
});

test("returns 404 for missing cached club logos", async function () {
  process.env.CLUB_LOGO_CACHE_PATH = await createLogoCacheFixture();
  const { createApp } = require("./server");
  const server = await listen(createApp());

  try {
    const port = server.address().port;
    const response = await fetch("http://127.0.0.1:" + port + "/api/clubs/msbl/999999/logo");

    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});
