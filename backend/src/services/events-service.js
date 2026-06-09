const { config } = require("../config");

const TEXT_CHANNEL_TYPES = new Set([0, 5, 15, 16]);
const EXCLUDED_EVENT_KEYS = new Set(["tournaments", "event-voice-channel"]);
const EVENT_GAME_MARKERS = Object.freeze([
  { game: "sms", imageUrl: "/assets/games/smsball.png", symbols: ["🔹", "🔷", "💠"] },
  { game: "msc", imageUrl: "/assets/games/mscball.png", symbols: ["🔸", "🔶", "🟠", "🟧"] },
  { game: "msbl", imageUrl: "/assets/games/msblball.png", symbols: ["🔺", "🔻", "🔴", "🟥"] }
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDiscordId(value) {
  const text = normalizeText(value);
  return /^\d+$/.test(text) ? text : "";
}

function cleanChannelName(value) {
  return normalizeText(value)
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectEventGame(value) {
  const text = normalizeText(value);
  for (const marker of EVENT_GAME_MARKERS) {
    if (marker.symbols.some(function (symbol) { return text.includes(symbol); })) {
      return {
        game: marker.game,
        image_url: marker.imageUrl
      };
    }
  }
  return {
    game: "",
    image_url: ""
  };
}

function formatEventDisplayName(value) {
  const name = cleanChannelName(value);
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function toEventKey(value) {
  return cleanChannelName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toEventSlug(value) {
  return toEventKey(value) || "event";
}

function buildDiscordChannelUrl(guildId, channelId) {
  return "https://discord.com/channels/" + encodeURIComponent(guildId) + "/" + encodeURIComponent(channelId);
}

function isTextLikeChannel(channel) {
  return TEXT_CHANNEL_TYPES.has(Number(channel && channel.type));
}

function toEventRow(channel, guildId) {
  const id = normalizeDiscordId(channel && channel.id);
  const name = cleanChannelName(channel && channel.name);
  const game = detectEventGame(channel && channel.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    display_name: formatEventDisplayName(name),
    game: game.game,
    image_url: game.image_url,
    slug: toEventSlug(name),
    position: Number.isFinite(Number(channel.position)) ? Number(channel.position) : 999999,
    url: buildDiscordChannelUrl(guildId, id)
  };
}

function filterCommunityEventChannels(channels, options) {
  const opts = options || {};
  const categoryId = normalizeDiscordId(opts.categoryId);
  const guildId = normalizeDiscordId(opts.guildId);
  if (!categoryId || !guildId || !Array.isArray(channels)) {
    return [];
  }

  return channels
    .filter(function (channel) {
      return normalizeDiscordId(channel && channel.parent_id) === categoryId
        && isTextLikeChannel(channel)
        && !EXCLUDED_EVENT_KEYS.has(toEventKey(channel && channel.name));
    })
    .map(function (channel) {
      return toEventRow(channel, guildId);
    })
    .filter(Boolean)
    .sort(function (a, b) {
      const byPosition = a.position - b.position;
      if (byPosition !== 0) {
        return byPosition;
      }
      return a.name.localeCompare(b.name);
    });
}

function buildEventsPayload(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    count: safeRows.length,
    rows: safeRows
  };
}

function readEventsConfig(options) {
  const opts = options || {};
  return {
    apiBase: normalizeText(opts.apiBase || config.discordApiBase || "https://discord.com/api/v10").replace(/\/+$/, ""),
    botToken: normalizeText(opts.botToken || config.discordBotToken),
    guildId: normalizeDiscordId(opts.guildId || config.discordGuildId),
    categoryId: normalizeDiscordId(opts.categoryId || config.discordEventsCategoryId),
    fetchTimeoutMs: Number.isFinite(Number(opts.fetchTimeoutMs)) ? Number(opts.fetchTimeoutMs) : config.discordMemberFetchTimeoutMs,
    refreshIntervalMs: Number.isFinite(Number(opts.refreshIntervalMs)) ? Number(opts.refreshIntervalMs) : config.discordEventsRefreshIntervalMs,
    fetchFn: opts.fetchFn || fetch,
    logger: opts.logger || console
  };
}

async function fetchDiscordJson(pathname, eventsConfig, attempt) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller && eventsConfig.fetchTimeoutMs > 0
    ? setTimeout(function () { controller.abort(); }, eventsConfig.fetchTimeoutMs)
    : null;

  try {
    const response = await eventsConfig.fetchFn(eventsConfig.apiBase + pathname, {
      headers: {
        Accept: "application/json",
        Authorization: "Bot " + eventsConfig.botToken
      },
      signal: controller ? controller.signal : undefined
    });
    let payload = null;
    if (response && typeof response.json === "function") {
      payload = await response.json().catch(function () { return null; });
    }

    if (response && response.status === 429 && !attempt) {
      const retryAfterMs = Math.min(Math.max(Number(payload && payload.retry_after || 0) * 1000, 250), 2000);
      await new Promise(function (resolve) { setTimeout(resolve, retryAfterMs); });
      return fetchDiscordJson(pathname, eventsConfig, 1);
    }

    return {
      ok: !!(response && response.ok),
      status: response ? response.status : 0,
      payload
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function fetchCommunityEvents(options) {
  const eventsConfig = readEventsConfig(options);
  if (!eventsConfig.botToken || !eventsConfig.guildId || !eventsConfig.categoryId || typeof eventsConfig.fetchFn !== "function") {
    return buildEventsPayload([]);
  }

  const response = await fetchDiscordJson(
    "/guilds/" + encodeURIComponent(eventsConfig.guildId) + "/channels",
    eventsConfig,
    0
  );
  if (!response.ok || !Array.isArray(response.payload)) {
    throw new Error("Discord events channel request failed (" + response.status + ").");
  }

  return buildEventsPayload(filterCommunityEventChannels(response.payload, {
    guildId: eventsConfig.guildId,
    categoryId: eventsConfig.categoryId
  }));
}

class CommunityEventsCache {
  constructor(options) {
    const opts = options || {};
    this.loader = opts.loader || function () { return fetchCommunityEvents(opts); };
    this.refreshIntervalMs = Number.isFinite(Number(opts.refreshIntervalMs))
      ? Number(opts.refreshIntervalMs)
      : config.discordEventsRefreshIntervalMs;
    this.logger = opts.logger || console;
    this.payload = null;
    this.inFlight = null;
    this.intervalHandle = null;
  }

  log(level) {
    if (!this.logger || typeof this.logger[level] !== "function") {
      return;
    }
    this.logger[level].apply(this.logger, Array.prototype.slice.call(arguments, 1));
  }

  async refresh() {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = Promise.resolve()
      .then(() => this.loader())
      .then((payload) => {
        this.payload = buildEventsPayload(payload && payload.rows);
        return this.payload;
      })
      .catch((error) => {
        this.log("warn", "[events-cache] Refresh failed:", error);
        if (this.payload) {
          return this.payload;
        }
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  async get() {
    if (this.payload) {
      return this.payload;
    }
    return this.refresh();
  }

  start() {
    if (this.intervalHandle) {
      return;
    }

    this.refresh().catch(function () {});
    if (this.refreshIntervalMs > 0) {
      this.intervalHandle = setInterval(() => {
        this.refresh().catch(function () {});
      }, this.refreshIntervalMs);
      if (typeof this.intervalHandle.unref === "function") {
        this.intervalHandle.unref();
      }
    }
  }

  async stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.inFlight) {
      await this.inFlight.catch(function () {});
    }
  }
}

const communityEventsCache = new CommunityEventsCache();

module.exports = {
  CommunityEventsCache,
  buildDiscordChannelUrl,
  cleanChannelName,
  communityEventsCache,
  detectEventGame,
  fetchCommunityEvents,
  filterCommunityEventChannels,
  formatEventDisplayName,
  toEventKey,
  toEventSlug
};
