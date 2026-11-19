import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "../../lib/logger.ts";
import type { Config } from "../../config.ts";
import { cookiePair, createTestApp } from "../../test-support/app.ts";
import { DISCORD_TEST_ENV } from "../../test-support/fake-discord.ts";
import { SessionManager } from "../auth/session.ts";
import { ClubLogoCache } from "./logo-cache.ts";
import type { ClubManagement, ClubOutcome, ClubRequest, MyClubView } from "./management.ts";
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
  const otherVersion = await app.inject("/api/clubs/msbl/368/logo?v=oldhash");
  assert.equal(otherVersion.body, "route-logo");
  assert.equal(otherVersion.headers["cache-control"], "no-cache", "a URL naming another version is never kept");

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

// ---------------------------------------------------------------------------------------------------
// My Club and the bot's internal route

const INTERNAL_SECRET = "club-internal-secret-for-route-tests-0000";

const EMPTY_VIEW: MyClubView = {
  playerId: 7,
  club: null,
  invitations: [
    {
      id: 3,
      clubId: 5,
      clubName: "Hammer Bros",
      clubTag: "HB",
      invitedBy: "Olga",
      createdAt: Date.parse("2026-12-01T10:00:00.000Z"),
      expiresAt: Date.parse("2026-12-08T10:00:00.000Z"),
    },
  ],
  create: {
    allowed: false,
    refusal: { ok: false, code: "CREATE_TOO_NEW", message: "Too new.", until: Date.parse("2026-12-10T00:00:00.000Z") },
  },
  joinCooldownUntil: null,
  joinBlocks: [],
};

async function createMyClubApp(answer: (call: string, args: unknown[]) => ClubOutcome<unknown>) {
  const calls: { call: string; args: unknown[] }[] = [];
  let sessions: SessionManager | undefined;
  const record =
    (call: string) =>
    (...args: unknown[]) => {
      calls.push({ call, args });
      return Promise.resolve(answer(call, args));
    };
  const clubs = new Proxy({} as ClubManagement, { get: (_target, name) => record(String(name)) });
  const { app } = await createTestApp({
    env: { ...DISCORD_TEST_ENV, CLUB_INTERNAL_SECRET: INTERNAL_SECRET },
    data: (config: Config) => {
      sessions = new SessionManager({ ...config.session, now: Date.now });
      return {
        login: {
          sessions,
          oauth: { authorizeUrl: () => "", completeLogin: () => Promise.reject(new Error("unused")) },
        },
        clubs,
      };
    },
  });
  assert.ok(sessions);
  const cookie = cookiePair(sessions.createSessionCookie({ id: "123456789012345678", username: "tester" }, "Nick"));
  return { app, cookie, calls };
}

const okView = (): ClubOutcome<unknown> => ({ kind: "ok", result: EMPTY_VIEW });

test("My Club needs a session and answers no-store snake_case", async () => {
  const { app, cookie, calls } = await createMyClubApp(okView);
  const anonymous = await app.inject("/api/my-club");
  assert.equal(anonymous.statusCode, 401);
  assert.deepEqual(anonymous.json(), { error: "Authentication required.", code: "AUTH_REQUIRED" });
  const response = await app.inject({ url: "/api/my-club", headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const body = response.json<Record<string, unknown>>();
  assert.equal(body.player_id, 7);
  assert.deepEqual(body.invitations, [
    {
      id: 3,
      club_id: 5,
      club_name: "Hammer Bros",
      club_tag: "HB",
      invited_by: "Olga",
      created_at: "2026-12-01T10:00:00.000Z",
      expires_at: "2026-12-08T10:00:00.000Z",
    },
  ]);
  assert.deepEqual(body.create, {
    allowed: false,
    reason: { error: "Too new.", code: "CREATE_TOO_NEW", until: "2026-12-10T00:00:00.000Z" },
  });
  assert.equal(
    (calls[0]?.args[0] as ClubRequest).identity.id,
    "123456789012345678",
    "the actor comes from the session",
  );
});

test("changes are JSON, same-site, and their outcomes map to statuses", async () => {
  const outcomes: Record<string, ClubOutcome<unknown>> = {
    create: { kind: "refused", refusal: { ok: false, code: "NAME_TAKEN", message: "Taken." } },
    join: { kind: "closed" },
    leave: { kind: "not_member" },
    confirmActivity: { kind: "discord_unavailable" },
    updateSettings: {
      kind: "invalid",
      errors: [{ field: "regions", code: "REQUIRED", message: "Select at least one region." }],
    },
  };
  const { app, cookie, calls } = await createMyClubApp((call) => outcomes[call] ?? okView());
  const json = { cookie, "content-type": "application/json" };
  const notJson = await app.inject({ method: "POST", url: "/api/my-club/create", headers: { cookie }, payload: "x" });
  assert.equal(notJson.statusCode, 415);
  const crossSite = await app.inject({
    method: "POST",
    url: "/api/my-club/create",
    headers: { ...json, origin: "https://evil.example", host: "mariostrikers.gg" },
    payload: {},
  });
  assert.equal(crossSite.statusCode, 403);
  assert.equal(crossSite.json<{ code: string }>().code, "FORBIDDEN");

  const taken = await app.inject({ method: "POST", url: "/api/my-club/create", headers: json, payload: { name: "X" } });
  assert.equal(taken.statusCode, 409);
  assert.deepEqual(taken.json(), { error: "Taken.", code: "NAME_TAKEN" });
  assert.deepEqual(calls.at(-1)?.args[1], { name: "X" });

  const closed = await app.inject({ method: "POST", url: "/api/my-club/join", headers: json, payload: { club_id: 5 } });
  assert.equal(closed.statusCode, 403);
  assert.equal(closed.json<{ code: string }>().code, "CLUB_MANAGEMENT_CLOSED");
  assert.equal(calls.at(-1)?.args[1], 5);

  const gone = await app.inject({ method: "POST", url: "/api/my-club/leave", headers: { cookie } });
  assert.equal(gone.statusCode, 403);
  assert.equal(gone.json<{ code: string }>().code, "NOT_GUILD_MEMBER");

  const down = await app.inject({ method: "POST", url: "/api/my-club/activity", headers: { cookie } });
  assert.equal(down.statusCode, 503);
  assert.equal(down.json<{ code: string }>().code, "DISCORD_UNAVAILABLE");

  const invalid = await app.inject({
    method: "PUT",
    url: "/api/my-club/settings",
    headers: json,
    payload: { regions: [] },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json<{ code: string; fields: unknown[] }>().fields.length, 1);

  const badId = await app.inject({
    method: "POST",
    url: "/api/my-club/join",
    headers: json,
    payload: { club_id: "x" },
  });
  assert.equal(badId.statusCode, 400);
  const officerUrl = "/api/my-club/members/4/officer";
  const noFlag = await app.inject({ method: "PUT", url: officerUrl, headers: json, payload: {} });
  assert.equal(noFlag.statusCode, 400);
  const promote = await app.inject({ method: "PUT", url: officerUrl, headers: json, payload: { officer: true } });
  assert.equal(promote.statusCode, 200);
  assert.deepEqual(calls.at(-1)?.args.slice(1), [4, true]);
});

test("the bot's internal route needs the shared secret and otherwise does not exist", async () => {
  const { app, calls } = await createMyClubApp(() => ({
    kind: "ok",
    result: { accepted: true, clubName: "Hammer Bros", clubTag: "HB" },
  }));
  const url = "/internal/clubs/invitations/12/answer";
  const body = { discord_user_id: "123456789012345678", answer: "accept" };
  for (const authorization of [undefined, "Bearer wrong", INTERNAL_SECRET]) {
    const response = await app.inject({
      method: "POST",
      url,
      headers: authorization ? { authorization } : {},
      payload: body,
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: "Not found.", code: "NOT_FOUND" });
  }
  assert.equal(calls.length, 0);
  const auth = { authorization: "Bearer " + INTERNAL_SECRET };
  const answered = await app.inject({ method: "POST", url, headers: auth, payload: body });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), { accepted: true, club_name: "Hammer Bros", club_tag: "HB" });
  assert.deepEqual(calls[0], { call: "answerFromDiscord", args: ["123456789012345678", 12, true] });
  const bad = await app.inject({
    method: "POST",
    url,
    headers: auth,
    payload: { discord_user_id: "1", answer: "maybe" },
  });
  assert.equal(bad.statusCode, 400);
});

test("F6: the logo upload takes an image body of up to 2 MB, and the logo route serves an uploaded logo first", async () => {
  const { app, cookie, calls } = await createMyClubApp(okView);
  const upload = await app.inject({
    method: "PUT",
    url: "/api/my-club/logo",
    headers: { cookie, "content-type": "image/png" },
    payload: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  });
  assert.equal(upload.statusCode, 200);
  assert.equal(calls.at(-1)?.call, "uploadLogo");
  assert.ok(Buffer.isBuffer(calls.at(-1)?.args[1]));
  const wrongType = await app.inject({
    method: "PUT",
    url: "/api/my-club/logo",
    headers: { cookie, "content-type": "image/gif" },
    payload: Buffer.from("GIF89a"),
  });
  assert.equal(wrongType.statusCode, 415);
  const tooLarge = await app.inject({
    method: "PUT",
    url: "/api/my-club/logo",
    headers: { cookie, "content-type": "image/webp" },
    payload: Buffer.alloc(2 * 1024 * 1024 + 1),
  });
  assert.equal(tooLarge.statusCode, 413);
  const json = await app.inject({
    method: "POST",
    url: "/api/my-club/create",
    headers: { cookie, "content-type": "application/json" },
    payload: JSON.stringify({ name: "x".repeat(20 * 1024) }),
  });
  assert.equal(json.statusCode, 413, "every other route keeps the 16 KB body limit");

  const { app: logoApp } = await createTestApp({
    data: {
      getUploadedClubLogo: (clubId) =>
        Promise.resolve(clubId === 5 ? { contentType: "image/webp", hash: "abc", data: Buffer.from("webp") } : null),
    },
  });
  const served = await logoApp.inject("/api/clubs/msbl/5/logo?v=abc");
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers["content-type"], "image/webp");
  assert.equal(served.headers["cache-control"], "public, max-age=2592000, immutable");
  assert.equal(served.body, "webp");
  const revalidated = await logoApp.inject({ url: "/api/clubs/msbl/5/logo", headers: { "if-none-match": '"abc"' } });
  assert.equal(revalidated.statusCode, 304);
});
