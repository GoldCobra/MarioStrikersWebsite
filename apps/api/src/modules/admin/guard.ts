// The one check behind the admin page, its API and the "Admin" link of the account menu (docs/adr/0011).
// It fails closed: without a session, without the admin claim of the login, with a session older than the
// admin limit, or when Discord does not confirm (or cannot be asked) that the member holds an admin role
// right now, the answer is no. Only members whose login carried the claim are ever looked up, so nobody
// else causes a Discord request or waits for one.

import crypto from "node:crypto";
import type { GuildMember, GuildMemberLookup } from "../../integrations/discord/members.ts";
import type { Session, SessionManager } from "../auth/session.ts";
import type { AdminAuditStore } from "./audit.ts";

/** Where the admin page lives: nginx asks the gate for every file under it (infra/nginx/frontend.conf). */
export const ADMIN_PAGE_PREFIX = "/_/";

/** A session issued this far in the future is not trusted (clock skew between containers is far smaller). */
const MAX_CLOCK_SKEW_MS = 60_000;

export interface AdminSettings {
  /** Discord role ids of the community server that make a member an admin. */
  readonly roleIds: readonly string[];
  /** The page's secret path segment. */
  readonly pathToken: string;
  /** How long after the login a session may use the admin page. */
  readonly sessionMaxAgeMs: number;
}

/** What the data source provides when the admin page is on. */
export interface AdminAccess {
  readonly settings: AdminSettings;
  /** Members with their current roles, read with the bot token and cached briefly. */
  readonly members: GuildMemberLookup;
  readonly audit: AdminAuditStore;
}

export interface AdminIdentity {
  readonly discordUserId: string;
  readonly username: string;
  readonly globalName: string;
  /** When this session stops opening the admin page: the admin limit after login, at most the session's end. */
  readonly accessUntil: number;
  /** When Discord's answer (possibly cached) was taken as confirmed. */
  readonly checkedAt: number;
}

export type AdminRefusal =
  "no_session" | "no_claim" | "session_too_old" | "not_member" | "no_role" | "discord_unavailable";

export type AdminCheck =
  | { readonly ok: true; readonly admin: AdminIdentity }
  | { readonly ok: false; readonly reason: AdminRefusal; readonly discordUserId: string };

export function hasAdminRole(roles: readonly string[], roleIds: readonly string[]): boolean {
  return roles.some((role) => roleIds.includes(role));
}

function digest(value: string): Buffer {
  return crypto.createHash("sha256").update(value).digest();
}

export class AdminGuard {
  private readonly access: AdminAccess;
  private readonly sessions: SessionManager;
  private readonly now: () => number;
  private readonly tokenDigest: Buffer;

  constructor(access: AdminAccess, sessions: SessionManager, now: () => number) {
    this.access = access;
    this.sessions = sessions;
    this.now = now;
    this.tokenDigest = digest(access.settings.pathToken);
  }

  /** The admin page's address, as the account menu links it. */
  get pagePath(): string {
    return `${ADMIN_PAGE_PREFIX}${this.access.settings.pathToken}/`;
  }

  /**
   * Whether a requested URI lies under the admin page (/_/<token>/...). The token is compared in constant
   * time; the gate checks this before anything else, so a wrong path costs the same as any other.
   */
  isPagePath(uri: string): boolean {
    if (!uri.startsWith(ADMIN_PAGE_PREFIX)) return false;
    const rest = uri.slice(ADMIN_PAGE_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return false;
    return crypto.timingSafeEqual(digest(rest.slice(0, slash)), this.tokenDigest);
  }

  /** The admin behind this request's session cookie; `fresh` asks Discord even when an answer is cached. */
  async check(cookieHeader: unknown, { fresh = false }: { readonly fresh?: boolean } = {}): Promise<AdminCheck> {
    const session = this.sessions.readSession(cookieHeader);
    if (!session) return { ok: false, reason: "no_session", discordUserId: "" };
    const discordUserId = session.discord_user_id;
    const refuse = (reason: AdminRefusal): AdminCheck => ({ ok: false, reason, discordUserId });
    if (session.adm !== true) return refuse("no_claim");
    const accessUntil = this.accessUntil(session);
    if (accessUntil === null) return refuse("session_too_old");

    let member: GuildMember;
    try {
      member = await this.access.members.getMember(discordUserId, { fresh });
    } catch {
      return refuse("discord_unavailable");
    }
    if (member.membership === "unknown") return refuse("discord_unavailable");
    if (member.membership !== "member") return refuse("not_member");
    if (!hasAdminRole(member.roles, this.access.settings.roleIds)) return refuse("no_role");
    return {
      ok: true,
      admin: {
        discordUserId,
        username: member.username || session.discord_user?.username || "",
        globalName: member.globalName || session.discord_user?.global_name || "",
        accessUntil,
        checkedAt: this.now(),
      },
    };
  }

  /** The end of this session's admin access, or null when it is over (or the session has no usable age). */
  private accessUntil(session: Session): number | null {
    const now = this.now();
    const issuedAt = Number(session.issued_at);
    if (!Number.isFinite(issuedAt) || issuedAt <= 0 || issuedAt > now + MAX_CLOCK_SKEW_MS) return null;
    const until = Math.min(
      issuedAt + this.access.settings.sessionMaxAgeMs,
      Number(session.expires_at) || Number.POSITIVE_INFINITY,
    );
    return now < until ? until : null;
  }
}

/** The guard of a data source, or null when the admin page or the login is off (then nobody is an admin). */
export function createAdminGuard(data: {
  readonly admin: AdminAccess | null;
  readonly login: { readonly sessions: SessionManager } | null;
  now(): number;
}): AdminGuard | null {
  return data.admin && data.login ? new AdminGuard(data.admin, data.login.sessions, () => data.now()) : null;
}
