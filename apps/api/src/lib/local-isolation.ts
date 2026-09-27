// Development fixtures and automated tests must never contact configured live services.

import dns from "node:dns";
import net from "node:net";

const SERVICE_VARIABLE = /^(MSSQL_|DISCORD_|SESSION_|PUBLIC_DATA_CACHE_|CLUB_LOGO_|FLARESOLVERR_|AUTH_STATE_)/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

/** Removes every credential or service address from the environment. */
export function clearServiceEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of Object.keys(env)) {
    if (SERVICE_VARIABLE.test(key) || key === "BOT_TOKEN") Reflect.deleteProperty(env, key);
  }
}

/** Makes every outgoing connection, fetch and DNS lookup throw, optionally except loopback. */
export function blockExternalConnections(options: { allowLoopback?: boolean } = {}): void {
  const assertHost = (host: unknown): void => {
    if (options.allowLoopback && LOOPBACK_HOSTS.has(String(host).toLowerCase())) return;
    throw new Error("External connections are disabled in isolated development/tests.");
  };

  // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound through apply below
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    // Node's HTTP client can pass its pre-normalized [options, callback] tuple.
    const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    const host =
      first && typeof first === "object"
        ? ((first as { host?: string; hostname?: string }).host ?? (first as { hostname?: string }).hostname)
        : typeof args[1] === "string"
          ? args[1]
          : "localhost";
    assertHost(host ?? "localhost");
    return Reflect.apply(connect, this, args) as net.Socket;
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    assertHost(url.hostname);
    return originalFetch(input, init);
  };

  const lookup = dns.lookup;
  dns.lookup = function (hostname: string, ...args: unknown[]) {
    // net.Server.listen also uses lookup; numeric bind addresses never need DNS.
    if (!net.isIP(hostname)) assertHost(hostname);
    Reflect.apply(lookup, dns, [hostname, ...args]);
  } as typeof dns.lookup;

  const lookupPromise = dns.promises.lookup;
  dns.promises.lookup = function (hostname: string, ...args: unknown[]) {
    if (!net.isIP(hostname)) assertHost(hostname);
    return Reflect.apply(lookupPromise, dns.promises, [hostname, ...args]) as Promise<dns.LookupAddress>;
  } as typeof dns.promises.lookup;
}
