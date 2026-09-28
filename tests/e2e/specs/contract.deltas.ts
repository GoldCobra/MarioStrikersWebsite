import type { ContractRecord } from "./contract.spec.ts";

// Intended API differences between the reference commit and the working tree.
// Each entry names the change and the phase that introduced it; the normalizer is applied to both sides.

// P2a (Fastify): errors gained a machine-readable code; the pre-existing codes stay compared.
const NEW_ERROR_CODES = new Set(["BAD_REQUEST", "NOT_FOUND", "INTERNAL", "FORBIDDEN", "UPSTREAM_UNAVAILABLE"]);
// P2a: the fixtures answer invalid ids with 400 like the live API always did (they answered 404).
const INVALID_ID_PATHS = new Set(["/api/players/abc/profile", "/api/players/0/profile", "/api/clubs/msbl/abc/profile"]);
// P2a: the login binds its OAuth state to the browser with this cookie (login CSRF protection).
const OAUTH_STATE_COOKIE = "msc_oauth_state=";

// P7: the season and Wiimmfi responses use snake_case keys like every other response (they had camelCase).
const SNAKE_CASED_PATHS = new Set(["/api/competitive-season/current", "/api/wiimmfi/msc-charged"]);

function snakeCaseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeCaseKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      snakeCaseKeys(entry),
    ]),
  );
}

function normalizeCookie(cookie: string): string {
  // P2a: fixture cookies now come from the production session code: same attributes, with an Expires on
  // clearing and in the production order.
  const [pair = "", ...attributes] = cookie.split("; ");
  const kept = attributes.filter((attribute) => attribute !== "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return [pair, ...kept.sort()].join("; ");
}

export function normalizeContract(record: ContractRecord): ContractRecord {
  const headers = { ...record.headers };
  // P2a: ETags are weak hashes from @fastify/etag instead of Express; only their presence is compared.
  if (headers.etag?.startsWith("W/")) headers.etag = "W/<hash>";
  // P2a: error responses are never cached.
  if (record.status >= 400 && headers["cache-control"] === "no-store") delete headers["cache-control"];

  let body = SNAKE_CASED_PATHS.has(record.path) ? snakeCaseKeys(record.body) : record.body;
  if (record.status >= 400 && body && typeof body === "object" && "code" in body) {
    const { code, ...rest } = body as Record<string, unknown>;
    if (typeof code === "string" && NEW_ERROR_CODES.has(code)) body = rest;
  }

  const setCookie = record.setCookie
    ?.split("\n")
    .filter((cookie) => !cookie.startsWith(OAUTH_STATE_COOKIE))
    .map(normalizeCookie)
    .join("\n");

  let normalized: ContractRecord = { ...record, headers, body, setCookie: setCookie || undefined };
  if (INVALID_ID_PATHS.has(record.path)) {
    normalized = { ...normalized, status: 0, body: "invalid id (fixtures now answer 400 like the live API)" };
  }
  // P2a: a callback whose state does not match this browser's login redirects to /profile?auth=failed,
  // like every other failed login, instead of answering a plain-text 400.
  const rejectedState =
    record.path.startsWith("/api/auth/discord/callback") &&
    ((record.status === 400 && record.body === "Invalid OAuth state.") ||
      (record.status === 302 && record.location === "/profile?auth=failed"));
  if (rejectedState) {
    normalized = { ...normalized, status: 0, headers: {}, location: undefined, body: "rejected OAuth state" };
  }
  return normalized;
}
