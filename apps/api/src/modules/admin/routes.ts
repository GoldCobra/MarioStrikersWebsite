// The hidden admin page (docs/adr/0011): nginx's gate for its files and its API, nothing else. Every refusal
// looks exactly like a path that does not exist: the API answers its standard 404, and nginx turns a refused
// gate into the site's not-found page. The API routes sit in one plugin whose first hook is the guard, so a
// route added there later cannot be reached without it.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { LRUCache } from "lru-cache";
import { toText } from "@ms/shared/text";
import type { Config } from "../../config.ts";
import { NO_STORE } from "../../http/cache-control.ts";
import { sendNotFound } from "../../http/errors.ts";
import { sendNoStore, type RouteContext } from "../../http/route-context.ts";
import type { AdminAuditEntry } from "./audit.ts";
import { createAdminGuard, type AdminCheck, type AdminIdentity } from "./guard.ts";

/** nginx's auth_request target. Outside /api/, so only nginx inside the container network reaches it. */
export const ADMIN_GATE_PATH = "/internal/admin-gate";
export const ADMIN_API_PREFIX = "/api/admin";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_AUDIT_ENTRIES = 50;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Rate limit headers would tell an admin route from an unknown path; the limit is applied after the guard
// and keyed by the admin, never shown.
const NO_LIMIT_HEADERS = { "x-ratelimit-limit": false, "x-ratelimit-remaining": false, "x-ratelimit-reset": false };

function toAuditResponse(entry: AdminAuditEntry) {
  return {
    at: entry.at,
    discord_user_id: entry.discordUserId,
    action: entry.action,
    target: entry.target,
    outcome: entry.outcome,
  };
}

/** The page's path below its token: "" or "index.html" is the document itself, anything else one of its files. */
function isPageDocument(uri: string): boolean {
  const path = uri.split(/[?#]/)[0] ?? "";
  const rest = path.split("/").slice(3).join("/");
  return rest === "" || rest === "index.html";
}

export function registerAdminRoutes(app: FastifyInstance, { config, data }: RouteContext): void {
  const guard = createAdminGuard(data);
  const audit = data.admin?.audit ?? null;
  const identities = new WeakMap<FastifyRequest, AdminIdentity>();
  // The page's opening is logged once per session and day, not for every file or reload.
  const opened = new LRUCache<string, true>({ max: 1000, ttl: DAY_MS });

  /** A refusal worth a line in the log: someone with the page's address, or a session that once was an admin's. */
  function logRefusal(request: FastifyRequest, check: AdminCheck & { ok: false }, where: string): void {
    request.log.warn(
      { discord_user_id: check.discordUserId || undefined, reason: check.reason, ip: request.ip },
      `[admin] ${where} refused`,
    );
  }

  app.get(ADMIN_GATE_PATH, async (request, reply) => {
    reply.header("Cache-Control", NO_STORE);
    const uri = toText(request.headers["x-original-uri"]);
    if (!guard?.isPagePath(uri)) return reply.code(401).send();
    const check = await guard.check(request.headers.cookie);
    if (!check.ok) {
      logRefusal(request, check, "Admin page");
      return reply.code(401).send();
    }
    const { admin } = check;
    const key = `${admin.discordUserId}:${String(admin.accessUntil)}:${String(Math.floor(data.now() / DAY_MS))}`;
    if (audit && isPageDocument(uri) && !opened.has(key)) {
      opened.set(key, true);
      await audit
        .record({
          discordUserId: admin.discordUserId,
          action: "page.open",
          outcome: "allowed",
          ip: request.ip,
          requestId: request.id,
        })
        .catch((err: unknown) => {
          request.log.error({ err }, "[admin] Audit record failed");
        });
    }
    return reply.code(204).send();
  });

  app.register(
    (admin, _options, done) => {
      admin.addHook("onRequest", async (request, reply) => {
        // A change must see a role removed a moment ago; reads may use the briefly cached answer.
        const check = guard
          ? await guard.check(request.headers.cookie, { fresh: !SAFE_METHODS.has(request.method) })
          : null;
        if (!check?.ok) {
          // Members without the login's admin claim are everyday visitors; only former admins are logged.
          if (check && check.reason !== "no_session" && check.reason !== "no_claim") {
            logRefusal(request, check, "Admin API");
          }
          return sendNotFound(reply);
        }
        identities.set(request, check.admin);
      });

      admin.get("/overview", adminRateLimit(config, 60), async (request, reply) => {
        const identity = identities.get(request);
        if (!identity) return sendNotFound(reply);
        let entries: AdminAuditEntry[] | null = null;
        try {
          entries = audit ? await audit.recent(RECENT_AUDIT_ENTRIES) : [];
        } catch (err) {
          request.log.error({ err }, "[admin] Audit log could not be read");
        }
        return sendNoStore(reply, {
          admin: {
            discord_user_id: identity.discordUserId,
            username: identity.username,
            global_name: identity.globalName,
          },
          access_until: new Date(identity.accessUntil).toISOString(),
          role_checked_at: new Date(identity.checkedAt).toISOString(),
          audit: entries?.map(toAuditResponse) ?? null,
        });
      });
      done();
    },
    { prefix: ADMIN_API_PREFIX },
  );

  /** Per admin (not per address), after the guard, without rate limit headers. */
  function adminRateLimit(settings: Config, max: number) {
    if (!settings.rateLimitEnabled) return {};
    return {
      config: {
        rateLimit: {
          max,
          timeWindow: 60_000,
          hook: "preHandler" as const,
          keyGenerator: (request: FastifyRequest) => identities.get(request)?.discordUserId ?? request.ip,
          addHeaders: { ...NO_LIMIT_HEADERS, "retry-after": false },
          addHeadersOnExceeding: NO_LIMIT_HEADERS,
        },
      },
    };
  }
}
