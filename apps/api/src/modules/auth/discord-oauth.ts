// Discord OAuth2: the authorize URL, the code exchange and the guild membership check.
// Login needs scopes "identify" and "guilds.members.read"; every call is bounded by a timeout.

import type { DiscordConfig } from "../../config.ts";
import { discordApiUrl } from "../../integrations/discord/rest.ts";
import type { DiscordUser } from "./session.ts";

const DISCORD_OAUTH_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_OAUTH_SCOPES = ["identify", "guilds.members.read"];
const DISCORD_TIMEOUT_MS = 10_000;

export class NotGuildMemberError extends Error {
  constructor() {
    super("Discord account is not a server member.");
    this.name = "NotGuildMemberError";
  }
}

export interface DiscordOAuthClient {
  authorizeUrl(state: string): string;
  /** The Discord user of an authorization code; throws NotGuildMemberError outside the server. */
  completeLogin(code: string): Promise<DiscordUser>;
}

export function createDiscordOAuthClient(discord: DiscordConfig, fetchFn: typeof fetch = fetch): DiscordOAuthClient {
  const request = (path: string, init: RequestInit): Promise<Response> =>
    fetchFn(discordApiUrl(path, discord.apiBase), { ...init, signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS) });
  const bearer = (token: string): Record<string, string> => ({
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  });

  return {
    authorizeUrl(state) {
      const url = new URL(DISCORD_OAUTH_AUTHORIZE_URL);
      url.searchParams.set("client_id", discord.clientId);
      url.searchParams.set("redirect_uri", discord.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", DISCORD_OAUTH_SCOPES.join(" "));
      url.searchParams.set("state", state);
      return url.href;
    },

    async completeLogin(code) {
      const body = new URLSearchParams({
        client_id: discord.clientId,
        client_secret: discord.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: discord.redirectUri,
      });
      const tokenResponse = await request("/oauth2/token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!tokenResponse.ok) throw new Error("Discord token exchange failed.");
      const token = (await tokenResponse.json()) as { access_token?: string } | null;
      if (!token?.access_token) throw new Error("Discord token exchange returned no access token.");

      const [userResponse, memberResponse] = await Promise.all([
        request("/users/@me", { headers: bearer(token.access_token) }),
        request(`/users/@me/guilds/${encodeURIComponent(discord.guildId)}/member`, {
          headers: bearer(token.access_token),
        }),
      ]);
      if (!userResponse.ok) throw new Error("Discord user request failed.");
      const user = (await userResponse.json()) as DiscordUser | null;
      if (!user?.id) throw new Error("Discord user request returned no user id.");
      if (memberResponse.status === 403 || memberResponse.status === 404) throw new NotGuildMemberError();
      if (!memberResponse.ok) throw new Error("Discord guild member request failed.");
      return user;
    },
  };
}
