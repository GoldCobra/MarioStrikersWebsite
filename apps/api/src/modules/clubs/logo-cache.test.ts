import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { silentLogger } from "../../lib/logger.ts";
import { ClubLogoCache, getSourceIdentity, normalizeSourceUrl, type LogoDownloader } from "./logo-cache.ts";

function createCache(download: LogoDownloader, cacheDir: string, failureRetryMs = 6 * 60 * 60 * 1000): ClubLogoCache {
  return new ClubLogoCache({
    cacheDir,
    maxBytes: 1024 * 1024,
    fetchTimeoutMs: 5000,
    failureRetryMs,
    log: silentLogger,
    download,
  });
}

function image(body: string, contentType: string): ReturnType<LogoDownloader> {
  return Promise.resolve({ buffer: Buffer.from(body), contentType });
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

test("caches a logo and returns a local public URL", async () => {
  const calls: string[] = [];
  const cache = createCache(
    (url) => {
      calls.push(url);
      return image("club-logo", "image/webp");
    },
    await tempDir(),
  );
  const publicUrl = await cache.ensureClubLogo({
    club_id: 368,
    logo_source:
      "https://cdn.discordapp.com/attachments/1224758392799629383/1466384407114809466/Logo_club.webp?ex=one&is=two&hm=three",
  });
  const logoFile = await cache.getLogoFile(368);
  assert.match(publicUrl, /^\/api\/clubs\/msbl\/368\/logo\?v=[a-f0-9]{16}$/);
  assert.equal(calls.length, 1);
  assert.equal(logoFile?.contentType, "image/webp");
  assert.equal(await fs.readFile(logoFile.absolutePath, "utf8"), "club-logo");
});

test("reuses a cached Discord attachment when only auth query parameters change", async () => {
  let calls = 0;
  const cache = createCache(
    () => {
      calls += 1;
      return image("club-logo", "image/png");
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
    () => (fail ? Promise.reject(new Error("network down")) : image("old-logo", "image/png")),
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
      return fail ? Promise.reject(new Error("expired")) : image("fresh-logo", "image/webp");
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

test("unsupported content types are rejected and nothing is stored", async () => {
  const dir = await tempDir();
  const cache = createCache(() => image("<svg/>", "image/svg+xml"), dir);
  assert.equal(await cache.ensureClubLogo({ club_id: 44, logo_source: "https://example.com/logo.svg" }), "");
  assert.equal(await cache.getLogoFile(44), null);
});

test("missing and invalid club ids have no logo file", async () => {
  const cache = createCache(() => image("x", "image/png"), await tempDir());
  assert.equal(await cache.getLogoFile(999999), null);
  assert.equal(await cache.getLogoFile("abc"), null);
});
