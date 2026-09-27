// Shared Discord REST helpers (bot-token JSON GET with timeout + single 429
// retry). Leaf module: no imports from services/db/config — callers pass an
// already-resolved config object { apiBase, botToken, fetchTimeoutMs, fetchFn }.

function getDiscordApiUrl(pathname, apiBase) {
  return String(apiBase || "https://discord.com/api/v10").replace(/\/+$/, "") + pathname;
}

async function fetchDiscordJson(pathname, cfg, attempt) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller && cfg.fetchTimeoutMs > 0
    ? setTimeout(function () { controller.abort(); }, cfg.fetchTimeoutMs)
    : null;

  try {
    const response = await cfg.fetchFn(
      getDiscordApiUrl(pathname, cfg.apiBase),
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bot " + cfg.botToken
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
      await new Promise(function (resolve) { setTimeout(resolve, retryAfterMs); });
      return fetchDiscordJson(pathname, cfg, 1);
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

module.exports = { getDiscordApiUrl, fetchDiscordJson };
