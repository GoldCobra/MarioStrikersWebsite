// Compares two APIs endpoint by endpoint, including every player and club profile and logo.
//   node tools/src/api-diff.ts compare <reference> <candidate origin> [--pace=<ms>]
//   node tools/src/api-diff.ts record <origin> <snapshot.json> [--pace=<ms>]
// <reference> is a running API (http://...) or a snapshot recorded earlier, e.g. from production before
// a release. --pace sends one request at a time with that pause, to stay polite to production and below
// its rate limits. Differences between two running APIs are retried once, because live data can change.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const GAMES = ["msbl", "msc", "sms"];
const MODES = ["elo1v1", "elo2v2", "whr"];
const LEADERBOARD_VARIANTS = ["", "?limit=5", "?limit=5&offset=3", "?limit=150", "?offset=100", "/top", "/top?limit=3"];
// Error codes the rewrite added; the previous API answered the same errors without them.
const NEW_ERROR_CODES = new Set(["BAD_REQUEST", "NOT_FOUND", "INTERNAL", "FORBIDDEN", "UPSTREAM_UNAVAILABLE"]);
const PARALLEL_REQUESTS = 3;

interface Snapshot {
  status: number;
  contentType: string;
  body: unknown;
}

interface SnapshotFile {
  origin: string;
  recordedAt: string;
  snapshots: Record<string, Snapshot>;
}

interface Source {
  readonly live: boolean;
  get(path: string): Promise<Snapshot>;
}

const [mode = "", first = "", second = "", ...flags] = process.argv.slice(2);
const pace = Number(/^--pace=(\d+)$/.exec(flags.find((flag) => flag.startsWith("--pace=")) ?? "")?.[1] ?? 0);
if (!["compare", "record"].includes(mode) || !first || !second) {
  console.error(
    "Usage: node tools/src/api-diff.ts compare <reference origin|snapshot.json> <candidate origin> [--pace=<ms>]\n" +
      "       node tools/src/api-diff.ts record <origin> <snapshot.json> [--pace=<ms>]",
  );
  process.exit(2);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSnapshot(origin: string, path: string): Promise<Snapshot> {
  for (;;) {
    const response = await fetch(origin + path, {
      redirect: "manual",
      headers: { "User-Agent": "mariostrikers-api-diff" },
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 429) {
      // Only reached when --pace is too short for the production rate limits.
      await delay(Number(response.headers.get("retry-after") ?? 30) * 1000);
      continue;
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0] ?? "";
    const buffer = Buffer.from(await response.arrayBuffer());
    let body: unknown;
    if (contentType === "application/json") {
      body = JSON.parse(buffer.toString("utf8")) as unknown;
    } else if (contentType.startsWith("image/")) {
      body = { bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
    } else {
      body = buffer.toString("utf8");
    }
    return normalize(path, { status: response.status, contentType, body });
  }
}

function normalize(path: string, snapshot: Snapshot): Snapshot {
  let body = snapshot.body;
  if (snapshot.status >= 400 && body && typeof body === "object" && !Array.isArray(body)) {
    const { code, ...rest } = body as Record<string, unknown>;
    body = typeof code === "string" && !NEW_ERROR_CODES.has(code) ? { ...rest, code } : rest;
  }
  if (path === "/api/competitive-season/current" && body && typeof body === "object") {
    // The clock is generated per response.
    body = { ...(body as Record<string, unknown>), serverNowUtc: "<now>" };
  }
  return { ...snapshot, body };
}

function liveSource(origin: string): Source {
  let queue = Promise.resolve();
  return {
    live: true,
    get(path) {
      if (pace <= 0) return fetchSnapshot(origin, path);
      // One request at a time, with a pause after each.
      const result = queue.then(() => fetchSnapshot(origin, path));
      queue = result.then(
        () => delay(pace),
        () => delay(pace),
      );
      return result;
    },
  };
}

function fileSource(file: string): Source {
  const recorded = JSON.parse(readFileSync(file, "utf8")) as SnapshotFile;
  console.log(`[api-diff] Reference: ${recorded.origin} as recorded at ${recorded.recordedAt}.`);
  return {
    live: false,
    get(path) {
      const snapshot = recorded.snapshots[path];
      return snapshot ? Promise.resolve(snapshot) : Promise.reject(new Error(`${path} was not recorded.`));
    },
  };
}

/** JSON paths where the two values differ, e.g. "rows[3].rating". */
function differences(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (out.length >= 20 || isDeepStrictEqual(a, b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) {
      out.push(`${path || "(root)"}: length ${a.length} vs ${b.length}`);
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const next = Array.isArray(a) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
      differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], next, out);
    }
    return out;
  }
  out.push(`${path || "(root)"}: ${preview(a)} vs ${preview(b)}`);
  return out;
}

function preview(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value).slice(0, 80);
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index] as T);
      }
    }),
  );
  return results;
}

async function listIds(source: Source, path: string, field: string): Promise<number[]> {
  const list = (await source.get(path)).body as { rows?: Record<string, unknown>[] };
  return (list.rows ?? []).map((row) => Number(row[field])).filter((id) => Number.isInteger(id) && id > 0);
}

async function requestPaths(source: Source): Promise<string[]> {
  const paths = [
    "/api/health",
    "/api/players",
    "/api/clubs",
    "/api/clubs/msbl",
    "/api/competitive-season/current",
    "/api/events/community",
    "/api/auth/me",
    "/api/profile/me",
    "/api/players/abc/profile",
    "/api/players/999999999/profile",
    "/api/clubs/msbl/abc/profile",
    "/api/clubs/msbl/999999999/profile",
    "/api/clubs/msbl/999999999/logo",
    "/api/leaderboards/invalid/elo1v1",
    "/api/leaderboards/msbl/invalid",
  ];
  for (const game of GAMES) {
    for (const leaderboardMode of MODES) {
      for (const variant of LEADERBOARD_VARIANTS) paths.push(`/api/leaderboards/${game}/${leaderboardMode}${variant}`);
    }
  }
  for (const id of await listIds(source, "/api/players", "player_id")) paths.push(`/api/players/${id}/profile`);
  for (const id of await listIds(source, "/api/clubs/msbl", "club_id")) {
    paths.push(`/api/clubs/msbl/${id}/profile`, `/api/clubs/msbl/${id}/logo`);
  }
  return paths;
}

const parallel = pace > 0 ? 1 : PARALLEL_REQUESTS;

if (mode === "record") {
  const source = liveSource(first);
  const paths = await requestPaths(source);
  console.log(`[api-diff] Recording ${paths.length} requests from ${first}...`);
  const snapshots: Record<string, Snapshot> = {};
  await mapLimit(paths, parallel, async (path) => {
    snapshots[path] = await source.get(path);
  });
  const file: SnapshotFile = { origin: first, recordedAt: new Date().toISOString(), snapshots };
  writeFileSync(second, JSON.stringify(file));
  console.log(`[api-diff] Wrote ${paths.length} responses to ${second}.`);
} else {
  const reference = first.startsWith("http") ? liveSource(first) : fileSource(first);
  const candidate = liveSource(second);
  const paths = await requestPaths(reference);
  console.log(`[api-diff] Comparing ${paths.length} requests...`);
  const results = await mapLimit(paths, parallel, async (path) => {
    for (let attempt = 0; ; attempt += 1) {
      const [expected, actual] = await Promise.all([reference.get(path), candidate.get(path)]);
      const found = differences(expected, actual);
      if (found.length === 0 || attempt === 1 || !reference.live) return { path, found };
    }
  });
  const failed = results.filter((result) => result.found.length > 0);
  for (const { path, found } of failed) {
    console.log(`\n${path}`);
    for (const line of found) console.log(`  ${line}`);
  }
  console.log(`\n[api-diff] ${results.length - failed.length} identical, ${failed.length} different.`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}
