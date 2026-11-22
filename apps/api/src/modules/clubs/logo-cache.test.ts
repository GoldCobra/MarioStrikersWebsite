import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { silentLogger } from "../../lib/logger.ts";
import { ClubLogoCache, getSourceIdentity, normalizeSourceUrl, type LogoDownloader } from "./logo-cache.ts";

function createCache(download: LogoDownloader, cacheDir: string, failureRetryMs = 6 * 60 * 60 * 1000): ClubLogoCache {
  return new ClubLogoCache({
    cacheDir,
    maxBytes: 5 * 1024 * 1024,
    fetchTimeoutMs: 5000,
    failureRetryMs,
    log: silentLogger,
    download,
  });
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } })
    .png()
    .toBuffer();
}

async function served(body: Promise<Buffer>, contentType: string): ReturnType<LogoDownloader> {
  return { buffer: await body, contentType };
}

const tempDir = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), "club-logo-cache-"));

test("keeps signed Discord query parameters in the download source", () => {
  const normalized = normalizeSourceUrl(
    "https://media.discordapp.net/attachments/1224758392799629383/1466384407114809466/Logo_club.webp?ex=6a196ee6&is=6a181d66&hm=abc123&=&format=webp",
  );
  assert.match(normalized, /^https:\/\/media\.discordapp\.net\/attachments\//);
  for (const part of ["ex=6a196ee6", "is=6a181d66", "hm=abc123", "format=webp"]) assert.ok(normalized.includes(part));
});

test("uses stable Discord source identity without expiring auth parameters", () => {
  const first = "https://media.discordapp.net/attachments/1/2/logo.webp?ex=one&is=two&hm=three&format=webp";
  const second = "https://cdn.discordapp.com/attachments/1/2/logo.webp?ex=four&is=five&hm=six&format=webp";
  assert.equal(getSourceIdentity(first), getSourceIdentity(second));
  assert.equal(getSourceIdentity(first), "discord:/attachments/1/2/logo.webp?format=webp");
});

test("a downloaded logo is stored as the site's 512 px WebP under its image hash", async () => {
  const calls: string[] = [];
  const cache = createCache(
    (url) => {
      calls.push(url);
      return served(png(1600, 1200), "image/png");
    },
    await tempDir(),
  );
  const publicUrl = await cache.ensureClubLogo({
    club_id: 368,
    logo_source:
      "https://cdn.discordapp.com/attachments/1224758392799629383/1466384407114809466/Logo_club.png?ex=one&is=two&hm=three",
  });
  const logoFile = await cache.getLogoFile(368);
  assert.ok(logoFile);
  assert.equal(calls.length, 1);
  assert.equal(logoFile.contentType, "image/webp");
  assert.match(logoFile.absolutePath, /368-[a-f0-9]{16}\.webp$/);
  assert.equal(publicUrl, `/api/clubs/msbl/368/logo?v=${logoFile.hash}`);
  const meta = await sharp(logoFile.absolutePath).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 512, 384]);
});

test("reuses a cached Discord attachment when only auth query parameters change", async () => {
  let calls = 0;
  const cache = createCache(
    () => {
      calls += 1;
      return served(png(300, 300), "image/png");
    },
    await tempDir(),
  );
  const first = await cache.ensureClubLogo({
    club_id: 10,
    logo_source: "https://cdn.discordapp.com/attachments/1/2/logo.png?ex=one&is=two&hm=three",
  });
  const second = await cache.ensureClubLogo({
    club_id: 10,
    logo_source: "https://media.discordapp.net/attachments/1/2/logo.png?ex=four&is=five&hm=six",
  });
  assert.equal(first, second);
  assert.equal(calls, 1);
});

test("keeps the previous cached logo when a new download fails", async () => {
  let fail = false;
  const cache = createCache(
    () => (fail ? Promise.reject(new Error("network down")) : served(png(300, 300), "image/png")),
    await tempDir(),
  );
  const oldUrl = await cache.ensureClubLogo({
    club_id: 22,
    logo_source: "https://cdn.discordapp.com/attachments/1/2/logo.png?ex=one&is=two&hm=three",
  });
  fail = true;
  const retained = await cache.ensureClubLogo({
    club_id: 22,
    logo_source: "https://cdn.discordapp.com/attachments/1/3/new-logo.png?ex=one&is=two&hm=three",
  });
  assert.equal(retained, oldUrl);
});

test("throttles repeated failures for the same source URL but retries changed signed URLs", async () => {
  const calls: string[] = [];
  let fail = true;
  const cache = createCache(
    (url) => {
      calls.push(url);
      return fail ? Promise.reject(new Error("expired")) : served(png(300, 300), "image/webp");
    },
    await tempDir(),
    60000,
  );
  const firstSource = "https://cdn.discordapp.com/attachments/1/2/logo.webp?ex=one&is=two&hm=three";
  assert.equal(await cache.ensureClubLogo({ club_id: 33, logo_source: firstSource }), "");
  assert.equal(await cache.ensureClubLogo({ club_id: 33, logo_source: firstSource }), "");
  fail = false;
  const retried = await cache.ensureClubLogo({
    club_id: 33,
    logo_source: "https://cdn.discordapp.com/attachments/1/2/logo.webp?ex=four&is=five&hm=six",
  });
  assert.equal(calls.length, 2);
  assert.match(retried, /^\/api\/clubs\/msbl\/33\/logo\?v=[a-f0-9]{16}$/);
});

test("a file cached before the current rendition is re-encoded from itself, without a download", async () => {
  const dir = await tempDir();
  const sourceUrl = "https://cdn.discordapp.com/attachments/1/2/old.png?ex=one&is=two&hm=three";
  await fs.writeFile(path.join(dir, "56-0123456789abcdef.png"), await png(1903, 1907));
  const entry = {
    sourceUrl,
    sourceIdentity: getSourceIdentity(sourceUrl),
    hash: "0123456789abcdef",
    fileName: "56-0123456789abcdef.png",
    contentType: "image/png",
    byteLength: 1,
    cachedAt: "2026-01-01T00:00:00.000Z",
  };
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ version: 1, clubs: { 56: entry } }));
  const cache = createCache(() => Promise.reject(new Error("the link has expired")), dir);

  const publicUrl = await cache.ensureClubLogo({ club_id: 56, logo_source: sourceUrl });
  const logoFile = await cache.getLogoFile(56);
  assert.ok(logoFile);
  assert.equal(publicUrl, `/api/clubs/msbl/56/logo?v=${logoFile.hash}`);
  assert.notEqual(logoFile.hash, "0123456789abcdef");
  assert.equal(logoFile.contentType, "image/webp");
  assert.deepEqual(await fs.readdir(dir).then((files) => files.sort()), [
    path.basename(logoFile.absolutePath),
    "manifest.json",
  ]);
  const meta = await sharp(logoFile.absolutePath).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 511, 512]);
  // Once re-encoded, the file is served as it is.
  assert.equal(await cache.ensureClubLogo({ club_id: 56, logo_source: sourceUrl }), publicUrl);
});

test("unsupported content types are rejected and nothing is stored", async () => {
  const dir = await tempDir();
  const cache = createCache(() => served(Promise.resolve(Buffer.from("<svg/>")), "image/svg+xml"), dir);
  assert.equal(await cache.ensureClubLogo({ club_id: 44, logo_source: "https://example.com/logo.svg" }), "");
  assert.equal(await cache.getLogoFile(44), null);
});

test("an image whose bytes are not what its response claims is not stored", async () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300"/></svg>',
  );
  const cache = createCache(() => served(Promise.resolve(svg), "image/png"), await tempDir());
  assert.equal(await cache.ensureClubLogo({ club_id: 45, logo_source: "https://example.com/logo.png" }), "");
  assert.equal(await cache.getLogoFile(45), null);
});

test("missing and invalid club ids have no logo file", async () => {
  const cache = createCache(() => served(png(300, 300), "image/png"), await tempDir());
  assert.equal(await cache.getLogoFile(999999), null);
  assert.equal(await cache.getLogoFile("abc"), null);
});
