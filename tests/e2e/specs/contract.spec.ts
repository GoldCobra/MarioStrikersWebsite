import { expect, request, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { FIXTURE_CLUB_COUNT, FIXTURE_PLAYER_COUNT, LEADERBOARD_GAMES, LEADERBOARD_MODES } from "../lib/site.ts";
import { normalizeContract } from "./contract.deltas.ts";

// API A/B: every endpoint variant must answer identically on the reference and the candidate stack,
// apart from differences listed in contract.deltas.ts.
const REF_URL = process.env.REF_URL ?? "";
const CAND_URL = process.env.CAND_URL ?? "";
const COMPARED_HEADERS = ["content-type", "cache-control", "x-data-cache", "x-data-generated-at", "x-data-source", "etag"];

export interface ContractRecord {
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  location?: string;
  setCookie?: string;
  body: unknown;
}

function normalizeLocation(value: string | undefined): string | undefined {
  // OAuth state tokens are signed with a per-process secret.
  return value?.replace(/([?&]state=)[^&]+/, "$1<state>");
}

function normalizeSetCookie(value: string | undefined): string | undefined {
  return value?.replace(/=([^;]+)/, (_match, token: string) => (token ? "=<token>" : "="));
}

async function record(method: "GET" | "POST", context: APIRequestContext, path: string): Promise<ContractRecord> {
  const response: APIResponse = method === "GET"
    ? await context.get(path, { maxRedirects: 0 })
    : await context.post(path, { maxRedirects: 0 });
  const headers: Record<string, string> = {};
  const all = response.headers();
  for (const name of COMPARED_HEADERS) {
    const isRedirect = response.status() >= 300 && response.status() < 400;
    if (all[name] !== undefined && !(isRedirect && name === "content-type")) headers[name] = all[name];
  }
  const contentType = all["content-type"] ?? "";
  const buffer = await response.body();
  const isRedirect = response.status() >= 300 && response.status() < 400;
  // Redirect bodies are framework boilerplate; status and Location carry the contract.
  const body = isRedirect ? null : contentType.includes("json")
    ? JSON.parse(buffer.toString("utf8")) as unknown
    : contentType.startsWith("image/") ? { bytes: buffer.length, sha: buffer.toString("base64").slice(0, 64) } : buffer.toString("utf8");
  return normalizeContract({
    method, path, status: response.status(), headers, location: normalizeLocation(all["location"]),
    setCookie: normalizeSetCookie(all["set-cookie"]), body
  });
}

function leaderboardPaths(): string[] {
  const paths: string[] = [];
  for (const game of LEADERBOARD_GAMES) {
    for (const mode of LEADERBOARD_MODES) {
      const base = `/api/leaderboards/${game}/${mode}`;
      paths.push(base, base + "?limit=5", base + "?limit=5&offset=3", base + "?limit=150", base + "?offset=100",
        base + "/top", base + "/top?limit=3", base + "/top?limit=500");
    }
  }
  paths.push("/api/leaderboards/invalid/elo1v1", "/api/leaderboards/msbl/invalid", "/api/leaderboards/msbl/elo1v1?limit=abc",
    "/api/leaderboards/msbl/elo1v1?offset=-1", "/api/leaderboards/MSBL/ELO1V1");
  return paths;
}

function entityPaths(): string[] {
  const paths = ["/api/players", "/api/clubs", "/api/clubs/msbl", "/api/competitive-season/current", "/api/events/community",
    "/api/wiimmfi/msc-charged", "/api/health", "/api/auth/me", "/api/profile/me", "/api/unknown", "/api/players/9999/profile",
    "/api/players/abc/profile", "/api/players/0/profile", "/api/clubs/msbl/9999/profile", "/api/clubs/msbl/abc/profile",
    "/api/clubs/msbl/9999/logo", "/api/clubs/msbl/abc/logo"];
  for (let id = 1; id <= FIXTURE_PLAYER_COUNT; id += 1) paths.push(`/api/players/${id}/profile`);
  for (let id = 1; id <= FIXTURE_CLUB_COUNT; id += 1) paths.push(`/api/clubs/msbl/${id}/profile`, `/api/clubs/msbl/${id}/logo`);
  return paths;
}

async function authFlow(context: APIRequestContext, code: "sample" | "sample-unlinked"): Promise<ContractRecord[]> {
  const records: ContractRecord[] = [];
  const start = await context.get("/api/auth/discord/start?returnTo=/profile", { maxRedirects: 0 });
  records.push(await record("GET", context, "/api/auth/discord/start?returnTo=/profile"));
  const location = (start.headers()["location"] ?? "").replace("code=sample&", `code=${code}&`);
  records.push(await record("GET", context, location));
  records.push(await record("GET", context, "/api/auth/me"));
  records.push(await record("GET", context, "/api/profile/me"));
  records.push(await record("POST", context, "/api/auth/logout"));
  records.push(await record("GET", context, "/api/auth/me"));
  records.push(await record("GET", context, "/api/auth/discord/callback?code=sample&state=forged"));
  records.push(await record("GET", context, "/api/auth/discord/start?returnTo=https://evil.example/"));
  return records.map((entry) => ({ ...entry, path: entry.path.replace(/([?&]state=)[^&]+/, "$1<state>") }));
}

test.describe("API contract", () => {
  test.skip(!REF_URL || !CAND_URL, "REF_URL and CAND_URL are set by run.ts.");

  for (const [name, paths] of [["leaderboards", leaderboardPaths()], ["entities", entityPaths()]] as const) {
    test(name, async () => {
      const reference = await request.newContext({ baseURL: REF_URL });
      const candidate = await request.newContext({ baseURL: CAND_URL });
      for (const path of paths) {
        const expected = await record("GET", reference, path);
        const actual = await record("GET", candidate, path);
        expect(actual, path).toEqual(expected);
      }
      await reference.dispose();
      await candidate.dispose();
    });
  }

  for (const code of ["sample", "sample-unlinked"] as const) {
    test(`auth flow ${code}`, async () => {
      const reference = await request.newContext({ baseURL: REF_URL });
      const candidate = await request.newContext({ baseURL: CAND_URL });
      expect(await authFlow(candidate, code)).toEqual(await authFlow(reference, code));
      await reference.dispose();
      await candidate.dispose();
    });
  }
});
