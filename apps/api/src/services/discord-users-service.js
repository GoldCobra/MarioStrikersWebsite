const { config } = require("../config");
const { normalizeText } = require("../lib/text");
const { normalizeDiscordId } = require("../lib/discord-id");
const { fetchDiscordJson } = require("../lib/discord-rest");

const userCache = new Map();

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
