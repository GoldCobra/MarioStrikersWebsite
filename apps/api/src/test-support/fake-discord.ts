// A stand-in for Discord's OAuth endpoints, injected as the fetch of the OAuth client.

import assert from "node:assert/strict";

export const DISCORD_TEST_ENV = {
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_REDIRECT_URI: "http://localhost:8787/api/auth/discord/callback",
  DISCORD_GUILD_ID: "987654321",
  DISCORD_API_BASE: "https://discord.test/api",
  SESSION_SECRET: "route-test-session-secret-with-length",
  SESSION_COOKIE_SECURE: "false",
} as const;

export const DISCORD_TEST_USER = {
  id: "709777875686916210",
  username: "goldcobra",
  global_name: "GoldCobra",
  avatar: "avatarhash",
};

/** Discord's three OAuth endpoints; member=false answers the membership check with 404 Unknown Member. */
export function createFakeDiscordFetch({ member = true } = {}): { fetch: typeof fetch; requests: string[] } {
  const requests: string[] = [];
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const respond = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    assert.ok(init?.signal, "every Discord call has a timeout");
    const authorized = new Headers(init.headers).get("authorization") === "Bearer discord-access-token";
    if (method === "POST" && url.pathname === "/api/oauth2/token") {
      const body = typeof init.body === "string" ? init.body : "";
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code=abc/);
      return json({ access_token: "discord-access-token", token_type: "Bearer" });
    }
    if (url.pathname === "/api/users/@me" && authorized) return json(DISCORD_TEST_USER);
    if (url.pathname === "/api/users/@me/guilds/987654321/member" && authorized) {
      return member
        ? json({ user: { id: DISCORD_TEST_USER.id }, roles: [] })
        : json({ message: "Unknown Member" }, 404);
    }
    return json({ message: "Not found" }, 404);
  };
  // A failed assertion inside respond() rejects the request, like a network error would.
  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise((resolve) => {
      resolve(respond(input, init));
    });
  return { fetch: fakeFetch, requests };
}
