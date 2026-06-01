const { config } = require("../config");

const userCache = new Map();

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDiscordId(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  const mentionMatch = text.match(/<@!?(\d+)>/);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  return /^\d+$/.test(text) ? text : "";
}

function getDiscordApiUrl(pathname, apiBase) {
  return String(apiBase || config.discordApiBase || "https://discord.com/api/v10").replace(/\/+$/, "") + pathname;
}

function readLookupConfig(opts) {
  const options = opts || {};
  return {
    apiBase: options.apiBase || config.discordApiBase,
    botToken: options.botToken || config.discordBotToken,
    guildId: options.guildId || config.discordGuildId,
    cacheTtlMs: Number.isFinite(Number(options.cacheTtlMs)) ? Number(options.cacheTtlMs) : config.discordMemberCacheTtlMs,
    failureCacheTtlMs: Number.isFinite(Number(options.failureCacheTtlMs)) ? Number(options.failureCacheTtlMs) : config.discordMemberFailureCacheTtlMs,
    fetchTimeoutMs: Number.isFinite(Number(options.fetchTimeoutMs)) ? Number(options.fetchTimeoutMs) : config.discordMemberFetchTimeoutMs,
    parallelism: Number.isFinite(Number(options.parallelism)) ? Number(options.parallelism) : config.discordMemberFetchParallelism,
    fetchFn: options.fetchFn || fetch
  };
}

function toDiscordUsername(member) {
  const user = member && member.user ? member.user : member;
  return normalizeText(user && user.username)
    || normalizeText(member && member.nick)
    || normalizeText(user && user.global_name);
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function fetchDiscordJson(pathname, lookup, attempt) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller && lookup.fetchTimeoutMs > 0
    ? setTimeout(function () { controller.abort(); }, lookup.fetchTimeoutMs)
    : null;

  try {
    const response = await lookup.fetchFn(
      getDiscordApiUrl(pathname, lookup.apiBase),
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bot " + lookup.botToken
        },
        signal: controller ? controller.signal : undefined
      }
    );
    let payload = null;
    if (response && typeof response.json === "function") {
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }
    }

    if (response && response.status === 429 && !attempt) {
      const retryAfterMs = Math.min(Math.max(Number(payload && payload.retry_after || 0) * 1000, 250), 2000);
      await delay(retryAfterMs);
      return fetchDiscordJson(pathname, lookup, 1);
    }

    return {
      ok: !!(response && response.ok),
      status: response ? response.status : 0,
      payload: payload
    };
  } catch (_error) {
    return { ok: false, status: 0, payload: null };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function fetchDiscordGuildMember(discordId, opts) {
  const lookup = readLookupConfig(opts);
  if (!discordId || !lookup.botToken || typeof lookup.fetchFn !== "function") {
    return "";
  }

  const userResponse = await fetchDiscordJson("/users/" + encodeURIComponent(discordId), lookup, 0);
  if (userResponse.ok) {
    const username = toDiscordUsername(userResponse.payload);
    if (username) {
      return username;
    }
  }

  if (!lookup.guildId) {
    return "";
  }

  const memberResponse = await fetchDiscordJson(
    "/guilds/" + encodeURIComponent(lookup.guildId) + "/members/" + encodeURIComponent(discordId),
    lookup,
    0
  );

  if (memberResponse.status === 403 || memberResponse.status === 404 || !memberResponse.ok) {
      return "";
  }
  return toDiscordUsername(memberResponse.payload);
}

async function getDiscordUsernameById(discordIdRaw, opts) {
  const discordId = normalizeDiscordId(discordIdRaw);
  const lookup = readLookupConfig(opts);
  if (!discordId || !lookup.botToken) {
    return "";
  }

  const cacheKey = [lookup.apiBase, lookup.guildId || "-", discordId].join(":");
  const now = Date.now();
  const cached = userCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    if (cached.pending) {
      return cached.pending;
    }
    return cached.value || "";
  }

  const ttl = Math.max(0, lookup.cacheTtlMs);
  const pending = fetchDiscordGuildMember(discordId, lookup).then(function (value) {
    const username = normalizeText(value);
    const cacheTtl = username ? ttl : Math.max(0, Math.min(ttl, Number(lookup.failureCacheTtlMs) || 0));
    userCache.set(cacheKey, {
      value: username,
      expiresAt: Date.now() + cacheTtl
    });
    return username;
  });

  userCache.set(cacheKey, {
    pending: pending,
    expiresAt: now + ttl
  });

  return pending;
}

async function resolveDiscordNamesForRoster(rosterRows, opts) {
  const rows = Array.isArray(rosterRows) ? rosterRows : [];
  const lookup = readLookupConfig(opts);
  if (!lookup.botToken) {
    return rows;
  }

  const ids = Array.from(new Set(rows.map(function (row) {
    return row && !normalizeText(row.discord_name) ? normalizeDiscordId(row.discord_id) : "";
  }).filter(Boolean)));

  if (!ids.length) {
    return rows;
  }

  const namesById = new Map();
  const queue = ids.slice();
  const workerCount = Math.max(1, Math.min(Math.floor(lookup.parallelism) || 1, queue.length));

  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const username = await getDiscordUsernameById(id, lookup);
      if (username) {
        namesById.set(id, username);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));

  rows.forEach(function (row) {
    const id = normalizeDiscordId(row && row.discord_id);
    if (row && !normalizeText(row.discord_name) && namesById.has(id)) {
      row.discord_name = namesById.get(id);
    }
  });

  return rows;
}

function clearDiscordUserCache() {
  userCache.clear();
}

module.exports = {
  clearDiscordUserCache,
  fetchDiscordGuildMember,
  getDiscordUsernameById,
  normalizeDiscordId,
  resolveDiscordNamesForRoster,
  toDiscordUsername
};
