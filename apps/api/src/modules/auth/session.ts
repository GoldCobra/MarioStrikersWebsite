// Login sessions and OAuth state. Sessions are stateless signed cookies. The OAuth state is also signed
// and additionally bound to the browser by a nonce cookie, so a login link cannot be replayed from
// another browser (login CSRF).

import crypto from "node:crypto";
import { toText } from "@ms/shared/text";
import { createSignedToken, normalizeReturnTo, parseCookies, serializeCookie, verifySignedToken } from "./tokens.ts";

export const OAUTH_STATE_COOKIE = "msc_oauth_state";
const OAUTH_STATE_COOKIE_PATH = "/api/auth";

export interface SessionSettings {
  readonly secret: string;
  readonly cookieName: string;
  readonly cookieSecure: boolean;
  readonly ttlMs: number;
  readonly authStateTtlMs: number;
  /** Clock for issuing and checking expiry; fixtures pin it. */
  readonly now: () => number;
}

export interface DiscordUser {
  readonly id?: unknown;
  readonly username?: unknown;
  readonly global_name?: unknown;
  readonly avatar?: unknown;
}

export interface PublicDiscordUser {
  id: string;
  username: string;
  global_name: string;
  avatar: string;
}

export interface Session {
  discord_user?: PublicDiscordUser;
  discord_user_id: string;
  /** The server nickname at login; sessions from before it was stored have none. */
  guild_nick?: string;
  issued_at?: number;
  expires_at?: number;
}

export type AuthMeResponse =
  { authenticated: false } | { authenticated: true; user: PublicDiscordUser | { id: string }; expires_at: string };

export function toPublicDiscordUser(user: DiscordUser): PublicDiscordUser {
  return {
    id: toText(user.id),
    username: toText(user.username),
    global_name: toText(user.global_name),
    avatar: toText(user.avatar),
  };
}

export class SessionManager {
  private readonly settings: SessionSettings;

  constructor(settings: SessionSettings) {
    this.settings = settings;
  }

  /** A signed state for the authorize URL and the nonce cookie that binds it to this browser. */
  createOAuthState(returnTo: unknown): { state: string; cookie: string } {
    const now = this.settings.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const state = createSignedToken(
      { nonce, return_to: normalizeReturnTo(returnTo), issued_at: now, expires_at: now + this.settings.authStateTtlMs },
      this.settings.secret,
    );
    const cookie = serializeCookie(OAUTH_STATE_COOKIE, nonce, {
      maxAgeSeconds: Math.ceil(this.settings.authStateTtlMs / 1000),
      path: OAUTH_STATE_COOKIE_PATH,
      secure: this.settings.cookieSecure,
    });
    return { state, cookie };
  }

  /** The return path of a valid state whose nonce matches this browser's cookie; null otherwise. */
  verifyOAuthState(state: unknown, cookieHeader: unknown): { returnTo: string } | null {
    const payload = verifySignedToken(state, this.settings.secret, this.settings.now());
    const nonce = typeof payload?.nonce === "string" ? payload.nonce : "";
    const cookieNonce = parseCookies(cookieHeader)[OAUTH_STATE_COOKIE] ?? "";
    if (nonce === "" || nonce.length !== cookieNonce.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(nonce), Buffer.from(cookieNonce))) return null;
    return { returnTo: normalizeReturnTo(payload?.return_to) };
  }

  clearOAuthStateCookie(): string {
    return serializeCookie(OAUTH_STATE_COOKIE, "", {
      maxAgeSeconds: 0,
      expires: new Date(0),
      path: OAUTH_STATE_COOKIE_PATH,
      secure: this.settings.cookieSecure,
    });
  }

  createSessionCookie(user: DiscordUser, guildNick = ""): string {
    const now = this.settings.now();
    const publicUser = toPublicDiscordUser(user);
    const token = createSignedToken(
      {
        discord_user: publicUser,
        discord_user_id: publicUser.id,
        guild_nick: toText(guildNick).trim(),
        issued_at: now,
        expires_at: now + this.settings.ttlMs,
      },
      this.settings.secret,
    );
    return serializeCookie(this.settings.cookieName, token, {
      maxAgeSeconds: Math.ceil(this.settings.ttlMs / 1000),
      path: "/",
      secure: this.settings.cookieSecure,
    });
  }

  clearSessionCookie(): string {
    return serializeCookie(this.settings.cookieName, "", {
      maxAgeSeconds: 0,
      expires: new Date(0),
      path: "/",
      secure: this.settings.cookieSecure,
    });
  }

  readSession(cookieHeader: unknown): Session | null {
    if (!this.settings.secret) return null;
    const token = parseCookies(cookieHeader)[this.settings.cookieName];
    if (!token) return null;
    const session = verifySignedToken(token, this.settings.secret, this.settings.now());
    return session?.discord_user_id ? (session as unknown as Session) : null;
  }

  static toAuthMeResponse(session: Session | null): AuthMeResponse {
    if (!session) return { authenticated: false };
    return {
      authenticated: true,
      user: session.discord_user ?? { id: session.discord_user_id },
      expires_at: new Date(session.expires_at ?? 0).toISOString(),
    };
  }
}
