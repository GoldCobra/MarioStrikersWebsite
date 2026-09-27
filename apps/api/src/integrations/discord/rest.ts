// Discord REST GET with the bot token: bounded by a timeout, retried once on 429. Never throws;
// failures come back as { ok: false, status: 0 }.

export interface DiscordRestOptions {
  readonly apiBase: string;
  readonly botToken: string;
  readonly fetchTimeoutMs: number;
  readonly fetchFn?: typeof fetch;
}

export interface DiscordResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly payload: unknown;
}

export function discordApiUrl(pathname: string, apiBase: string): string {
  return (apiBase || "https://discord.com/api/v10").replace(/\/+$/, "") + pathname;
}

export async function fetchDiscordJson(
  pathname: string,
  options: DiscordRestOptions,
  attempt = 0,
): Promise<DiscordResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeout =
    options.fetchTimeoutMs > 0
      ? setTimeout(() => {
          controller.abort();
        }, options.fetchTimeoutMs)
      : null;
  try {
    const response = await fetchFn(discordApiUrl(pathname, options.apiBase), {
      headers: { Accept: "application/json", Authorization: `Bot ${options.botToken}` },
      signal: controller.signal,
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 429 && !attempt) {
      const retryAfter = Number((payload as { retry_after?: unknown } | null)?.retry_after ?? 0) * 1000;
      await new Promise((done) => setTimeout(done, Math.min(Math.max(retryAfter, 250), 2000)));
      return await fetchDiscordJson(pathname, options, 1);
    }
    return { ok: response.ok, status: response.status, payload };
  } catch {
    return { ok: false, status: 0, payload: null };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
