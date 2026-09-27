import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "../../lib/logger.ts";
import { createTestApp } from "../../test-support/app.ts";
import { ClubLogoCache } from "./logo-cache.ts";
import type { ClubProfile } from "./mappers.ts";

async function createLogoCache(): Promise<ClubLogoCache> {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "club-logo-route-"));
  const fileName = "368-testhash.webp";
  await fs.writeFile(path.join(cacheDir, fileName), "route-logo");
  const entry = {
    sourceUrl: "https://cdn.discordapp.com/attachments/1/2/logo.webp?ex=one&is=two&hm=three",
    sourceIdentity: "discord:/attachments/1/2/logo.webp",
    hash: "testhash",
    fileName,
    contentType: "image/webp",
    byteLength: 10,
    cachedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(cacheDir, "manifest.json"), JSON.stringify({ version: 1, clubs: { 368: entry } }));
  return new ClubLogoCache({ cacheDir, maxBytes: 1024, fetchTimeoutMs: 1000, failureRetryMs: 1000, log: silentLogger });
}

test("serves cached club logos with a revalidatable immutable ETag", async () => {
  const logos = await createLogoCache();
  const { app } = await createTestApp({ data: { getClubLogoFile: (clubId) => logos.getLogoFile(clubId) } });
  const response = await app.inject("/api/clubs/msbl/368/logo?v=testhash");
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "image/webp");
  assert.equal(response.headers["cache-control"], "public, max-age=2592000, immutable");
  assert.equal(response.headers.etag, '"testhash"');
  assert.equal(response.body, "route-logo");

  const revalidated = await app.inject({ url: "/api/clubs/msbl/368/logo", headers: { "if-none-match": '"testhash"' } });
  assert.equal(revalidated.statusCode, 304);
  assert.equal(revalidated.body, "");

  for (const url of ["/api/clubs/msbl/999999/logo", "/api/clubs/msbl/abc/logo"]) {
    const missing = await app.inject(url);
    assert.equal(missing.statusCode, 404, url);
    assert.deepEqual(missing.json(), { error: "Club logo not found.", code: "NOT_FOUND" });
  }
});

test("serves the club profile payload unchanged", async () => {
  const profile = {
    club: {
      club_id: 12,
      name: "Kickass FC",
      tag: "KFC",
      join_conditions: "Open to Anyone",
      region: "EU",
      club_code: "785XF50",
      regions: ["EU", "NA", "APAC"],
      club_codes: ["785XF50", "1G9MXHW", "7XM8WL2"],
      first_uniform: "Red",
      second_uniform: "Blue",
      stadium: "Lava Castle",
      discord_server: "https://discord.gg/msbl",
      created_at: "2026-01-01T00:00:00.000Z",
      logo: "/api/clubs/msbl/12/logo?v=abc",
      owner_name: "SaMuRaI7",
      owner_discord_id: "703837067322458112",
    },
    roster: [
      {
        player_id: 1,
        name: "SaMuRaI7",
        country: "ca",
        discord_id: "703837067322458112",
        discord_name: "samurai7",
        is_owner: true,
        is_officer: false,
        role: "owner",
      },
    ],
  } as unknown as ClubProfile;
  const requested: number[] = [];
  const { app } = await createTestApp({
    data: {
      getClubProfile: (clubId) => {
        requested.push(clubId);
        return Promise.resolve(clubId === 12 ? profile : null);
      },
    },
  });
  const response = await app.inject("/api/clubs/msbl/12/profile");
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), profile);

  const missing = await app.inject("/api/clubs/msbl/999999/profile");
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "Club not found.", code: "NOT_FOUND" });
  for (const invalid of ["abc", "0", "-1"]) {
    const response400 = await app.inject(`/api/clubs/msbl/${invalid}/profile`);
    assert.equal(response400.statusCode, 400, invalid);
    assert.deepEqual(response400.json(), { error: "Invalid club id.", code: "BAD_REQUEST" });
  }
  assert.deepEqual(requested, [12, 999999]);
});
