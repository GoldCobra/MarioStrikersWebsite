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

async function fetchDiscordGuildMember(discordId, opts) {
  const lookup = readLookupConfig(opts);
  if (!discordId || !lookup.botToken || !lookup.guildId || typeof lookup.fetchFn !== "function") {
    return "";
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller && lookup.fetchTimeoutMs > 0
    ? setTimeout(function () { controller.abort(); }, lookup.fetchTimeoutMs)
    : null;

  try {
    const response = await lookup.fetchFn(
      getDiscordApiUrl(
        "/guilds/" + encodeURIComponent(lookup.guildId) + "/members/" + encodeURIComponent(discordId),
        lookup.apiBase
      ),
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bot " + lookup.botToken
        },
        signal: controller ? controller.signal : undefined
      }
    );

    if (!response || response.status === 403 || response.status === 404) {
      return "";
    }
    if (!response.ok || typeof response.json !== "function") {
      return "";
    }

    return toDiscordUsername(await response.json());
  } catch (_error) {
    return "";
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function getDiscordUsernameById(discordIdRaw, opts) {
  const discordId = normalizeDiscordId(discordIdRaw);
  const lookup = readLookupConfig(opts);
  if (!discordId || !lookup.botToken || !lookup.guildId) {
    return "";
  }

  const cacheKey = [lookup.apiBase, lookup.guildId, discordId].join(":");
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
    userCache.set(cacheKey, {
      value: username,
      expiresAt: Date.now() + ttl
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
  if (!lookup.botToken || !lookup.guildId) {
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
