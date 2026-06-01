const crypto = require("node:crypto");
const { config, assertDiscordAuthConfigured } = require("../config");

const DISCORD_OAUTH_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_OAUTH_SCOPES = ["identify", "guilds.members.read"];
const DEFAULT_RETURN_TO = "/profile";

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function hmac(value, secret) {
  return crypto
    .createHmac("sha256", String(secret || ""))
    .update(String(value || ""))
    .digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function createSignedToken(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload || {}));
  return body + "." + hmac(body, secret);
}

function verifySignedToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  const expected = hmac(parts[0], secret);
  if (!safeEqual(parts[1], expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(parts[0]));
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const expiresAt = Number(payload.expires_at || 0);
    if (expiresAt && Date.now() > expiresAt) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  String(cookieHeader || "").split(";").forEach(function (entry) {
    const index = entry.indexOf("=");
    if (index === -1) {
      return;
    }
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (!key) {
      return;
    }
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function serializeCookie(name, value, options) {
  const opts = options || {};
  const parts = [
    encodeURIComponent(String(name || "")) + "=" + encodeURIComponent(String(value || ""))
  ];

  if (opts.maxAge !== undefined) {
    parts.push("Max-Age=" + Math.max(0, Math.floor(Number(opts.maxAge) || 0)));
  }
  if (opts.expires) {
    parts.push("Expires=" + opts.expires.toUTCString());
  }
  parts.push("Path=" + (opts.path || "/"));
  if (opts.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  if (opts.secure) {
    parts.push("Secure");
  }
  parts.push("SameSite=" + (opts.sameSite || "Lax"));
  return parts.join("; ");
}

function normalizeReturnTo(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 512 || /[\r\n]/.test(raw)) {
    return DEFAULT_RETURN_TO;
  }

  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return DEFAULT_RETURN_TO;
  }

  let parsed;
  try {
    parsed = new URL(raw, "https://mariostrikers.local");
  } catch (_error) {
    return DEFAULT_RETURN_TO;
  }

  if (parsed.origin !== "https://mariostrikers.local" || parsed.pathname.startsWith("/api/")) {
    return DEFAULT_RETURN_TO;
  }

  return parsed.pathname + parsed.search + parsed.hash;
}

function appendQuery(url, params) {
  const parsed = new URL(url, "https://mariostrikers.local");
  Object.keys(params || {}).forEach(function (key) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "") {
      parsed.searchParams.set(key, String(value));
    }
  });
  return parsed.pathname + parsed.search + parsed.hash;
}

function createOAuthState(returnTo) {
  assertDiscordAuthConfigured();
  const now = Date.now();
  return createSignedToken({
    nonce: crypto.randomBytes(16).toString("hex"),
    return_to: normalizeReturnTo(returnTo),
    issued_at: now,
    expires_at: now + config.authStateTtlMs
  }, config.sessionSecret);
}

function verifyOAuthState(state) {
  assertDiscordAuthConfigured();
  const payload = verifySignedToken(state, config.sessionSecret);
  if (!payload || !payload.nonce) {
    throw new Error("Invalid OAuth state.");
  }
  return {
    returnTo: normalizeReturnTo(payload.return_to)
  };
}

function buildDiscordAuthorizeUrl(returnTo) {
  assertDiscordAuthConfigured();
  const url = new URL(DISCORD_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.discordClientId);
  url.searchParams.set("redirect_uri", config.discordRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DISCORD_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", createOAuthState(returnTo));
  return url.href;
}

function getDiscordApiUrl(pathname) {
  return String(config.discordApiBase || "https://discord.com/api/v10").replace(/\/+$/, "") + pathname;
}

async function exchangeDiscordCode(code, fetchFn) {
  assertDiscordAuthConfigured();
  const runFetch = fetchFn || fetch;
  const body = new URLSearchParams();
  body.set("client_id", config.discordClientId);
  body.set("client_secret", config.discordClientSecret);
  body.set("grant_type", "authorization_code");
  body.set("code", String(code || ""));
  body.set("redirect_uri", config.discordRedirectUri);

  const response = await runFetch(getDiscordApiUrl("/oauth2/token"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error("Discord token exchange failed.");
  }

  const payload = await response.json();
  if (!payload || !payload.access_token) {
    throw new Error("Discord token exchange returned no access token.");
  }
  return payload;
}

async function fetchDiscordCurrentUser(accessToken, fetchFn) {
  const runFetch = fetchFn || fetch;
  const response = await runFetch(getDiscordApiUrl("/users/@me"), {
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + accessToken
    }
  });

  if (!response.ok) {
    throw new Error("Discord user request failed.");
  }

  const user = await response.json();
  if (!user || !user.id) {
    throw new Error("Discord user request returned no user id.");
  }
  return user;
}

async function fetchDiscordGuildMember(accessToken, fetchFn) {
  assertDiscordAuthConfigured();
  const runFetch = fetchFn || fetch;
  const response = await runFetch(getDiscordApiUrl("/users/@me/guilds/" + encodeURIComponent(config.discordGuildId) + "/member"), {
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + accessToken
    }
  });

  if (response.status === 404 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Discord guild member request failed.");
  }
  return response.json();
}

function toPublicDiscordUser(user) {
  return {
    id: String(user && user.id || ""),
    username: String(user && user.username || ""),
    global_name: String(user && user.global_name || ""),
    avatar: user && user.avatar ? String(user.avatar) : ""
  };
}

function createSessionPayload(user) {
  const now = Date.now();
  const publicUser = toPublicDiscordUser(user);
  return {
    discord_user: publicUser,
    discord_user_id: publicUser.id,
    issued_at: now,
    expires_at: now + config.sessionTtlMs
  };
}

function createSessionCookie(user) {
  assertDiscordAuthConfigured();
  const payload = createSessionPayload(user);
  const token = createSignedToken(payload, config.sessionSecret);
  return serializeCookie(config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: "Lax",
    maxAge: Math.ceil(config.sessionTtlMs / 1000),
    path: "/"
  });
}

function createClearSessionCookie() {
  return serializeCookie(config.sessionCookieName, "", {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: "Lax",
    maxAge: 0,
    expires: new Date(0),
    path: "/"
  });
}

function readSessionFromRequest(req) {
  if (!config.sessionSecret) {
    return null;
  }
  const cookies = parseCookies(req && req.headers && req.headers.cookie);
  const token = cookies[config.sessionCookieName];
  if (!token) {
    return null;
  }
  const session = verifySignedToken(token, config.sessionSecret);
  if (!session || !session.discord_user_id) {
    return null;
  }
  return session;
}

async function completeDiscordLogin(code, fetchFn) {
  const token = await exchangeDiscordCode(code, fetchFn);
  const [user, guildMember] = await Promise.all([
    fetchDiscordCurrentUser(token.access_token, fetchFn),
    fetchDiscordGuildMember(token.access_token, fetchFn)
  ]);

  if (!guildMember) {
    const error = new Error("Discord account is not a server member.");
    error.statusCode = 403;
    throw error;
  }

  return {
    user: user,
    guildMember: guildMember
  };
}

function toAuthMeResponse(session) {
  if (!session) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    user: session.discord_user || {
      id: String(session.discord_user_id || "")
    },
    expires_at: new Date(Number(session.expires_at || 0)).toISOString()
  };
}

module.exports = {
  appendQuery,
  buildDiscordAuthorizeUrl,
  completeDiscordLogin,
  createClearSessionCookie,
  createOAuthState,
  createSessionCookie,
  createSignedToken,
  normalizeReturnTo,
  readSessionFromRequest,
  toAuthMeResponse,
  verifyOAuthState,
  verifySignedToken
};
