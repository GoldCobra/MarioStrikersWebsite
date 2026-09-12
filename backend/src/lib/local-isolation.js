// Development fixtures and automated tests must never contact configured live services.
const net = require("node:net");
const dns = require("node:dns");

function clearServiceEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (/^(MSSQL_|DISCORD_|SESSION_|PUBLIC_DATA_CACHE_|CLUB_LOGO_|FLARESOLVERR_|AUTH_STATE_)/.test(key)
      || key === "BOT_TOKEN") delete process.env[key];
  }
}

function blockExternalConnections(options) {
  const allowLoopback = Boolean(options && options.allowLoopback);
  function assertHost(host) {
    if (allowLoopback && ["127.0.0.1", "::1", "localhost", "[::1]"].includes(String(host).toLowerCase())) return;
    throw new Error("External connections are disabled in isolated development/tests.");
  }
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // Node's HTTP client can pass its pre-normalized [options, callback] tuple.
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host = first && typeof first === "object" ? first.host || first.hostname
      : typeof args[1] === "string" ? args[1] : "localhost";
    assertHost(host || "localhost");
    return connect.apply(this, args);
  };
  const fetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    assertHost(url.hostname);
    return fetch(input, init);
  };
  const lookup = dns.lookup;
  dns.lookup = function (host, ...args) {
    // net.Server.listen also uses lookup; numeric bind addresses never need DNS.
    if (!net.isIP(host)) assertHost(host);
    return lookup.call(this, host, ...args);
  };
  const lookupPromise = dns.promises.lookup;
  dns.promises.lookup = function (host, ...args) {
    if (!net.isIP(host)) assertHost(host);
    return lookupPromise.call(this, host, ...args);
  };
}

module.exports = { clearServiceEnvironment, blockExternalConnections };
