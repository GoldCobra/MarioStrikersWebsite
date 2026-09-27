// The fixture API as developers start it (node src/dev.ts), checked from outside over HTTP.

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { PUBLIC_LEADERBOARD_VARIANTS } from "./cache/public-data-keys.ts";

const devPath = path.join(import.meta.dirname, "dev.ts");
const mainPath = path.join(import.meta.dirname, "main.ts");
const probe = ["--import", pathToFileURL(path.join(import.meta.dirname, "test-support", "fixture-probe.ts")).href];
let child: ChildProcess | undefined;
let base = "";
let tempDir = "";

function childEnvironment(overrides: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    PORT: "0",
    DEV_HOST: "127.0.0.1",
    MSSQL_HOST: "must-not-contact.example.test",
    MSSQL_DATABASE: "fake",
    MSSQL_USER: "fake",
    MSSQL_PASSWORD: "fake",
    DISCORD_CLIENT_SECRET: "must-not-use",
    DISCORD_BOT_TOKEN: "must-not-use",
    BOT_TOKEN: "must-not-use",
    ...overrides,
  };
  for (const key of ["NODE_TEST_CONTEXT", "NODE_OPTIONS", "CORS_ORIGIN", "LOG_LEVEL"]) Reflect.deleteProperty(env, key);
  return env;
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "strikers-dev-smoke-"));
  await fs.writeFile(
    path.join(tempDir, ".env"),
    "CORS_ORIGIN=dotenv-must-not-be-read\nMSSQL_HOST=dotenv-must-not-be-read\n",
  );
  const started = spawn(process.execPath, [...probe, devPath], {
    cwd: tempDir,
    env: childEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = started;
  base = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`Dev startup timed out: ${output}`));
    }, 15_000);
    started.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    started.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Dev exited early: ${String(code)} ${output}`));
    });
    started.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    started.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /on port (\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1] ?? ""}`);
      }
    });
  });
});

after(async () => {
  if (child?.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

async function json<T>(route: string, init?: RequestInit): Promise<T> {
  return (await (await fetch(base + route, init)).json()) as T;
}

test("fixture startup ignores .env and serves clearly marked sample data", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("x-data-source"), "fixtures");
  assert.deepEqual(await response.json(), { status: "ok", source: "fixtures" });
});

test("all public API families return populated fixture contracts", async () => {
  for (const variant of PUBLIC_LEADERBOARD_VARIANTS) {
    const response = await fetch(`${base}/api/leaderboards/${variant.game}/${variant.mode}?limit=2`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { game: string; mode: string; rows: { display_name: string }[] };
    assert.equal(body.game, variant.game);
    assert.equal(body.mode, variant.mode);
    assert.equal(body.rows.length, 2);
    assert.equal(body.rows[0]?.display_name, "Sample Player");
  }
  const paginated = await json<{ rows: { player_id: number }[] }>("/api/leaderboards/msbl/elo1v1?limit=1&offset=1");
  assert.equal(paginated.rows.length, 1);
  assert.equal(paginated.rows[0]?.player_id, 2);
  assert.equal((await json<{ count: number }>("/api/leaderboards/msbl/elo1v1/top?limit=1")).count, 1);
  for (const route of ["/api/players", "/api/clubs", "/api/clubs/msbl", "/api/events/community"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    const data = (await response.json()) as { count: number; rows: unknown[] };
    assert.ok(data.count > 0, route);
    assert.equal(data.count, data.rows.length, route);
  }
  const profile = await json<{
    player: { name: string };
    ratings: { msbl: { rating: number; season_reward_level: { current_wins: number; required_wins: number } } };
  }>("/api/players/1/profile");
  assert.equal(profile.player.name, "Sample Player");
  assert.ok(profile.ratings.msbl.rating > 0);
  assert.equal(profile.ratings.msbl.season_reward_level.current_wins, 0);
  assert.equal(profile.ratings.msbl.season_reward_level.required_wins, 5);
  const club = await json<{ club: { name: string; join_conditions: string }; roster: unknown[] }>(
    "/api/clubs/msbl/1/profile",
  );
  assert.equal(club.club.name, "Sample Strikers");
  assert.equal(club.club.join_conditions, "Open to Anyone");
  assert.ok(club.roster.length > 0);
  const logo = await fetch(`${base}/api/clubs/msbl/1/logo`);
  assert.match(logo.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.match(await logo.text(), /SAMPLE/);
  assert.equal(
    (await json<{ season: { displayName: string } }>("/api/competitive-season/current")).season.displayName,
    "Dusk Season 2026",
  );
  assert.equal(
    (await json<{ players: { name: string }[] }>("/api/wiimmfi/msc-charged")).players[0]?.name,
    "Sample Player",
  );
  assert.equal((await fetch(`${base}/api/players/9999/profile`)).status, 404);
  assert.equal((await fetch(`${base}/api/clubs/msbl/9999/profile`)).status, 404);
  assert.equal((await fetch(`${base}/api/clubs/msbl/9999/logo`)).status, 404);
  assert.equal((await fetch(`${base}/api/leaderboards/invalid/elo1v1`)).status, 400);
});

test("sample login and logout use local callbacks and isolated signed cookies", async () => {
  assert.deepEqual(await json("/api/auth/me"), { authenticated: false });
  assert.equal((await fetch(`${base}/api/profile/me`)).status, 401);
  const start = await fetch(`${base}/api/auth/discord/start?returnTo=%2Fprofile`, { redirect: "manual" });
  assert.equal(start.status, 302);
  const location = start.headers.get("location") ?? "";
  assert.ok(location.startsWith("/api/auth/discord/callback?"));
  const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const callback = await fetch(base + location, { redirect: "manual", headers: { cookie: stateCookie } });
  assert.equal(callback.headers.get("location"), "/profile?auth=success");
  const cookie =
    callback.headers
      .getSetCookie()
      .find((value) => value.startsWith("msc_dev_session="))
      ?.split(";")[0] ?? "";
  assert.ok(cookie);
  const signedIn = await json<{ authenticated: boolean; user: { global_name: string } }>("/api/auth/me", {
    headers: { cookie },
  });
  assert.equal(signedIn.authenticated, true);
  assert.equal(signedIn.user.global_name, "Sample Player");
  assert.equal(
    (await json<{ profile: { player: { id: number } } }>("/api/profile/me", { headers: { cookie } })).profile.player.id,
    1,
  );
  const tampered = cookie.slice(0, -1) + (cookie.endsWith("x") ? "y" : "x");
  assert.equal(
    (await json<{ authenticated: boolean }>("/api/auth/me", { headers: { cookie: tampered } })).authenticated,
    false,
  );
  const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie } });
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
  const cleared = (logout.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  assert.equal(
    (await json<{ authenticated: boolean }>("/api/auth/me", { headers: { cookie: cleared } })).authenticated,
    false,
  );
  // Without this browser's state cookie the same callback fails.
  const replayed = await fetch(base + location, { redirect: "manual" });
  assert.equal(replayed.headers.get("location"), "/profile?auth=failed");
  const external = await fetch(`${base}/api/auth/discord/start?returnTo=https%3A%2F%2Fexample.com`, {
    redirect: "manual",
  });
  const externalCookie = (external.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const safeCallback = await fetch(base + (external.headers.get("location") ?? ""), {
    redirect: "manual",
    headers: { cookie: externalCookie },
  });
  assert.equal(safeCallback.headers.get("location"), "/profile?auth=success");
});

test("fixture process drops live credentials, blocks outgoing calls and never loads database code", () => {
  const result = spawnSync(process.execPath, [...probe, devPath], {
    cwd: tempDir,
    env: childEnvironment({ MSC_PROBE_ISOLATION: "1" }),
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[probe\] isolation ok/);
});

test("entry points refuse the wrong mode", () => {
  const dev = spawnSync(process.execPath, [devPath], {
    env: childEnvironment({ NODE_ENV: "production" }),
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.notEqual(dev.status, 0);
  assert.match(dev.stderr, /cannot run in production/);
  const main = spawnSync(process.execPath, [mainPath], {
    cwd: tempDir,
    env: childEnvironment({ MSC_DEV_FIXTURES: "1" }),
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.notEqual(main.status, 0);
  assert.match(main.stderr, /Fixtures require npm run dev/);
});

test("occupied development port produces a clear error without stopping the existing server", async () => {
  const result = spawnSync(process.execPath, [devPath], {
    cwd: tempDir,
    env: childEnvironment({ PORT: new URL(base).port }),
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already in use/);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
