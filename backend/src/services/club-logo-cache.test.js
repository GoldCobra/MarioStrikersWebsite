const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { attachClubLogos } = require("./clubs-service");
const {
  ClubLogoCache,
  getSourceIdentity,
  normalizeSourceUrl
} = require("./club-logo-cache");

function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "club-logo-cache-"));
}

function createLookupFn(address) {
  return async function () {
    return [{ address: address || "1.1.1.1", family: 4 }];
  };
}

function createImageResponse(body, contentType) {
  const buffer = Buffer.from(body || "image-bytes");
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "content-type": contentType || "image/webp",
      "content-length": String(buffer.length)
    }),
    arrayBuffer: async function () {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}

test("keeps signed Discord query parameters in the download source", function () {
  const source = "https://media.discordapp.net/attachments/1224758392799629383/1466384407114809466/Logo_club.webp?ex=6a196ee6&is=6a181d66&hm=abc123&=&format=webp";
  const normalized = normalizeSourceUrl(source);

  assert.match(normalized, /^https:\/\/media\.discordapp\.net\/attachments\//);
  assert.match(normalized, /ex=6a196ee6/);
  assert.match(normalized, /is=6a181d66/);
  assert.match(normalized, /hm=abc123/);
  assert.match(normalized, /format=webp/);
});

test("uses stable Discord source identity without expiring auth parameters", function () {
  const first = "https://media.discordapp.net/attachments/1/2/logo.webp?ex=one&is=two&hm=three&format=webp";
  const second = "https://cdn.discordapp.com/attachments/1/2/logo.webp?ex=four&is=five&hm=six&format=webp";

  assert.equal(getSourceIdentity(first), getSourceIdentity(second));
  assert.equal(getSourceIdentity(first), "discord:/attachments/1/2/logo.webp?format=webp");
});

test("caches a logo and returns a local public URL", async function () {
  const tempDir = await createTempDir();
  const fetchCalls = [];
  const cache = new ClubLogoCache({
    cacheDir: tempDir,
    lookupFn: createLookupFn(),
    fetchFn: async function (url) {
      fetchCalls.push(url);
      return createImageResponse("club-logo", "image/webp");
    },
    logger: { warn: function () {} }
  });

  const publicUrl = await cache.ensureClubLogo({
    club_id: 368,
    logo_source: "https://cdn.discordapp.com/attachments/1224758392799629383/1466384407114809466/Logo_club.webp?ex=one&is=two&hm=three"
  });
  const logoFile = await cache.getLogoFile(368);
  const cachedBytes = await fs.readFile(logoFile.absolutePath, "utf8");

  assert.match(publicUrl, /^\/api\/clubs\/msbl\/368\/logo\?v=[a-f0-9]{16}$/);
  assert.equal(fetchCalls.length, 1);
  assert.equal(logoFile.contentType, "image/webp");
  assert.equal(cachedBytes, "club-logo");
});

test("reuses a cached Discord attachment when only auth query parameters change", async function () {
  const tempDir = await createTempDir();
  const fetchCalls = [];
  const cache = new ClubLogoCache({
    cacheDir: tempDir,
    lookupFn: createLookupFn(),
    fetchFn: async function (url) {
      fetchCalls.push(url);
      return createImageResponse("club-logo", "image/png");
    },
    logger: { warn: function () {} }
  });

  const first = await cache.ensureClubLogo({
    club_id: 10,
    logo_source: "https://cdn.discordapp.com/attachments/1/2/logo.png?ex=one&is=two&hm=three"
  });
  const second = await cache.ensureClubLogo({
    club_id: 10,
    logo_source: "https://media.discordapp.net/attachments/1/2/logo.png?ex=four&is=five&hm=six"
  });

  assert.equal(first, second);
  assert.equal(fetchCalls.length, 1);
});

test("keeps the previous cached logo when a new download fails", async function () {
  const tempDir = await createTempDir();
  let failDownloads = false;
  const cache = new ClubLogoCache({
    cacheDir: tempDir,
    lookupFn: createLookupFn(),
    fetchFn: async function () {
      if (failDownloads) {
        throw new Error("network down");
      }
      return createImageResponse("old-logo", "image/png");
    },
    logger: { warn: function () {} }
  });

  const oldUrl = await cache.ensureClubLogo({
    club_id: 22,
    logo_source: "https://cdn.discordapp.com/attachments/1/2/logo.png?ex=one&is=two&hm=three"
  });
  failDownloads = true;
  const retainedUrl = await cache.ensureClubLogo({
    club_id: 22,
    logo_source: "https://cdn.discordapp.com/attachments/1/3/new-logo.png?ex=one&is=two&hm=three"
  });

  assert.equal(retainedUrl, oldUrl);
});

test("throttles repeated failures for the same source URL but retries changed signed URLs", async function () {
  const tempDir = await createTempDir();
  const fetchCalls = [];
  let shouldFail = true;
  const cache = new ClubLogoCache({
    cacheDir: tempDir,
    failureRetryMs: 60000,
    lookupFn: createLookupFn(),
    fetchFn: async function (url) {
      fetchCalls.push(url);
      if (shouldFail) {
        throw new Error("expired");
      }
      return createImageResponse("fresh-logo", "image/webp");
    },
    logger: { warn: function () {} }
  });

  const firstSource = "https://cdn.discordapp.com/attachments/1/2/logo.webp?ex=one&is=two&hm=three";
  const secondSource = "https://cdn.discordapp.com/attachments/1/2/logo.webp?ex=four&is=five&hm=six";

  assert.equal(await cache.ensureClubLogo({ club_id: 33, logo_source: firstSource }), "");
  assert.equal(await cache.ensureClubLogo({ club_id: 33, logo_source: firstSource }), "");
  shouldFail = false;
  const retried = await cache.ensureClubLogo({ club_id: 33, logo_source: secondSource });

  assert.equal(fetchCalls.length, 2);
  assert.match(retried, /^\/api\/clubs\/msbl\/33\/logo\?v=[a-f0-9]{16}$/);
});

test("attachClubLogos leaves empty SQL logos empty and removes internal source values", async function () {
  const rows = [
    { club_id: 1, logo_source: "", logo: "" },
    { club_id: 2, logo_source: "https://example.com/logo.png", logo: "" }
  ];
  const logoCache = {
    ensureClubLogo: async function () {
      return "/api/clubs/msbl/2/logo?v=abc";
    }
  };

  const result = await attachClubLogos(rows, logoCache);

  assert.equal(result[0].logo, "");
  assert.equal(result[1].logo, "/api/clubs/msbl/2/logo?v=abc");
  assert.equal(Object.prototype.hasOwnProperty.call(result[0], "logo_source"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result[1], "logo_source"), false);
});
