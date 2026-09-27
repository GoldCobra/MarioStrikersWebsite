// Downloads a file from a URL that users control (club logos) without letting it reach the server's
// own network: HTTPS on port 443 only, every resolved address must be public and the socket connects
// to exactly the checked address (no DNS rebinding), redirects are followed by hand and re-checked,
// and the body is capped while it streams.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export interface DownloadResult {
  readonly buffer: Buffer;
  readonly contentType: string;
}

export interface SafeDownloadOptions {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects?: number;
  readonly userAgent?: string;
  /** Test seams: name resolution and the address policy. */
  readonly lookup?: (hostname: string) => Promise<readonly dns.LookupAddress[]>;
  readonly isAllowedAddress?: (address: string) => boolean;
  /** Test seam: plain HTTP to a local stub server. */
  readonly allowInsecureHttp?: boolean;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first = 0, second = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (!normalized || normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) return isPrivateIpv4(mapped);
  }
  return false;
}

/** True for addresses on the public internet; loopback, private, link-local and reserved ranges are not. */
export function isPublicAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return !isPrivateIpv4(address);
  if (version === 6) return !isPrivateIpv6(address);
  return false;
}

const defaultLookup = (hostname: string): Promise<readonly dns.LookupAddress[]> =>
  dns.promises.lookup(hostname, { all: true });

async function resolveAllowedAddress(url: URL, options: SafeDownloadOptions): Promise<dns.LookupAddress> {
  const lookup = options.lookup ?? defaultLookup;
  const isAllowed = options.isAllowedAddress ?? isPublicAddress;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const records = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await lookup(hostname);
  if (!records.length) throw new Error("Logo host did not resolve.");
  for (const record of records) {
    if (!isAllowed(record.address)) throw new Error("Logo URL resolves to a private address.");
  }
  const [first] = records;
  if (!first) throw new Error("Logo host did not resolve.");
  return first;
}

function assertAllowedUrl(url: URL, options: SafeDownloadOptions): void {
  const httpsOnDefaultPort = url.protocol === "https:" && (url.port === "" || url.port === "443");
  const testHttp = options.allowInsecureHttp === true && url.protocol === "http:";
  if (!httpsOnDefaultPort && !testHttp) throw new Error("Logo URL must use HTTPS on port 443.");
}

function requestOnce(
  url: URL,
  address: dns.LookupAddress,
  options: SafeDownloadOptions,
  signal: AbortSignal,
): Promise<{ status: number; location: string; contentType: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      {
        signal,
        headers: { "User-Agent": options.userAgent ?? "mariostrikers.gg club-logo-cache" },
        // Connect to the address that was checked, never to a second resolution.
        lookup: (_hostname, lookupOptions, callback) => {
          if ((lookupOptions as { all?: boolean }).all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const contentType = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location: response.headers.location ?? "", contentType, buffer: Buffer.alloc(0) });
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > options.maxBytes) {
          response.destroy();
          reject(new Error("Logo is larger than the configured maximum."));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > options.maxBytes) {
            response.destroy();
            reject(new Error("Logo is larger than the configured maximum."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({ status, location: "", contentType, buffer: Buffer.concat(chunks) });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}

export async function safeDownload(sourceUrl: string, options: SafeDownloadOptions): Promise<DownloadResult> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = new URL(sourceUrl);
  for (let redirects = 0; ; redirects += 1) {
    assertAllowedUrl(url, options);
    const address = await resolveAllowedAddress(url, options);
    const response = await requestOnce(url, address, options, signal);
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= (options.maxRedirects ?? 3)) throw new Error("Logo download redirected too often.");
      if (!response.location) throw new Error("Logo redirect has no location.");
      url = new URL(response.location, url);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Logo download returned HTTP ${response.status}.`);
    }
    if (!response.buffer.length) throw new Error("Logo download returned an empty body.");
    return { buffer: response.buffer, contentType: response.contentType };
  }
}
