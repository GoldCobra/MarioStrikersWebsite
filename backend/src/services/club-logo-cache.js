const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { config } = require("../config");
const { toPositiveIntOr } = require("../lib/numbers");

const MANIFEST_VERSION = 1;
const ALLOWED_CONTENT_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"]
]);
const DISCORD_ATTACHMENT_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net"
]);
const DISCORD_AUTH_QUERY_PARAMS = new Set(["ex", "is", "hm"]);

function normalizeSourceUrl(value) {
  const text = String(value || "")
    .trim()
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .trim();

  if (!text) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(text);
  } catch (_error) {
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }

  return parsed.href;
}

function getDiscordAttachmentIdentity(parsed) {
  const host = String(parsed.hostname || "").toLowerCase();
  if (!DISCORD_ATTACHMENT_HOSTS.has(host)) {
    return "";
  }

  if (!/^\/attachments\/\d+\/\d+\/.+/.test(parsed.pathname)) {
    return "";
  }

  const meaningfulParams = [];
  parsed.searchParams.forEach(function (value, key) {
    if (!key || DISCORD_AUTH_QUERY_PARAMS.has(key.toLowerCase())) {
      return;
    }
    meaningfulParams.push([key, value]);
  });
  meaningfulParams.sort(function (a, b) {
    return (a[0] + "=" + a[1]).localeCompare(b[0] + "=" + b[1]);
  });

  const query = meaningfulParams
    .map(function (entry) {
      return encodeURIComponent(entry[0]) + "=" + encodeURIComponent(entry[1]);
    })
    .join("&");

  return "discord:" + parsed.pathname + (query ? "?" + query : "");
}

function getSourceIdentity(sourceUrl) {
  const parsed = new URL(sourceUrl);
  const discordIdentity = getDiscordAttachmentIdentity(parsed);
  return discordIdentity || parsed.href;
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function isPrivateIpv4(address) {
  const parts = String(address || "").split(".").map(function (part) {
    return Number(part);
  });
  if (parts.length !== 4 || parts.some(function (part) { return !Number.isInteger(part) || part < 0 || part > 255; })) {
    return true;
  }

  const first = parts[0];
  const second = parts[1];
  return first === 0
    || first === 10
    || first === 127
    || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168
    || first === 100 && second >= 64 && second <= 127
    || first === 198 && (second === 18 || second === 19)
    || first >= 224;
}

function isPrivateIpv6(address) {
  const normalized = String(address || "").toLowerCase();
  if (!normalized || normalized === "::1" || normalized === "::") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) {
      return isPrivateIpv4(mapped);
    }
  }
  return false;
}

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

async function assertPublicUrl(sourceUrl, lookupFn) {
  const parsed = new URL(sourceUrl);
  const hostname = parsed.hostname;
  const lookup = lookupFn || dns.lookup;
  const records = await lookup(hostname, { all: true });
  const addresses = Array.isArray(records) ? records : [records];
  if (!addresses.length) {
    throw new Error("Logo host did not resolve.");
  }

  addresses.forEach(function (record) {
    const address = record && record.address ? record.address : record;
    if (isPrivateAddress(address)) {
      throw new Error("Logo URL resolves to a private address.");
    }
  });
}

function getExtensionForContentType(contentType) {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.get(normalized) || "";
}

class ClubLogoCache {
  constructor(options) {
    const opts = options || {};
    this.cacheDir = path.resolve(opts.cacheDir || config.clubLogoCachePath);
    this.maxBytes = opts.maxBytes || config.clubLogoMaxBytes;
    this.fetchTimeoutMs = opts.fetchTimeoutMs || config.clubLogoFetchTimeoutMs;
    this.failureRetryMs = opts.failureRetryMs || config.clubLogoFailureRetryMs;
    this.publicBasePath = opts.publicBasePath || "/api/clubs/msbl";
    this.fetchFn = opts.fetchFn || fetch;
    this.lookupFn = opts.lookupFn || dns.lookup;
    this.logger = opts.logger || console;
    this.skipNetworkSafetyChecks = opts.skipNetworkSafetyChecks === true;
    this.manifestPath = path.join(this.cacheDir, "manifest.json");
    this.manifest = null;
    this.savePromise = Promise.resolve();
  }

  async ensureLoaded() {
    if (this.manifest) {
      return;
    }

    try {
      const raw = await fs.readFile(this.manifestPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === MANIFEST_VERSION && parsed.clubs) {
        this.manifest = parsed;
        return;
      }
    } catch (_error) {
      // Missing or invalid manifests are rebuilt lazily.
    }

    this.manifest = {
      version: MANIFEST_VERSION,
      clubs: {}
    };
  }

  async fileExists(fileName) {
    if (!fileName) {
      return false;
    }
    try {
      await fs.access(path.join(this.cacheDir, fileName));
      return true;
    } catch (_error) {
      return false;
    }
  }

  buildPublicUrl(clubId, hash) {
    return this.publicBasePath + "/" + encodeURIComponent(String(clubId)) + "/logo?v=" + encodeURIComponent(hash);
  }

  async getExistingPublicUrl(clubId) {
    await this.ensureLoaded();
    const entry = this.manifest.clubs[String(clubId)];
    if (!entry || !entry.hash || !entry.fileName) {
      return "";
    }
    if (!(await this.fileExists(entry.fileName))) {
      return "";
    }
    return this.buildPublicUrl(clubId, entry.hash);
  }

  async ensureClubLogo(club) {
    const clubId = toPositiveIntOr(club && club.club_id, 0);
    const sourceUrl = normalizeSourceUrl(club && club.logo_source);
    if (!clubId || !sourceUrl) {
      return "";
    }

    await this.ensureLoaded();
    const sourceIdentity = getSourceIdentity(sourceUrl);
    const hash = hashText(sourceIdentity);
    const current = this.manifest.clubs[String(clubId)];
    if (current && current.sourceIdentity === sourceIdentity && await this.fileExists(current.fileName)) {
      return this.buildPublicUrl(clubId, current.hash);
    }
    if (this.isRecentFailure(current, sourceIdentity, sourceUrl)) {
      return this.getExistingPublicUrl(clubId);
    }

    try {
      const downloaded = await this.downloadLogo(sourceUrl);
      const fileName = String(clubId) + "-" + hash + downloaded.extension;
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(path.join(this.cacheDir, fileName), downloaded.buffer);

      this.manifest.clubs[String(clubId)] = {
        sourceUrl: sourceUrl,
        sourceIdentity: sourceIdentity,
        hash: hash,
        fileName: fileName,
        contentType: downloaded.contentType,
        byteLength: downloaded.buffer.length,
        cachedAt: new Date().toISOString()
      };
      await this.saveManifest();
      await this.removeOldClubFiles(clubId, fileName);
      return this.buildPublicUrl(clubId, hash);
    } catch (error) {
      this.log("warn", "[club-logo-cache] Failed to cache logo for club " + clubId + ":", error.message || error);
      await this.recordFailure(clubId, sourceUrl, sourceIdentity, hash, error);
      return this.getExistingPublicUrl(clubId);
    }
  }

  isRecentFailure(entry, sourceIdentity, sourceUrl) {
    if (!entry || !entry.failedAt || !entry.failedSourceIdentity || !entry.failedSourceUrl) {
      return false;
    }
    if (entry.failedSourceIdentity !== sourceIdentity || entry.failedSourceUrl !== sourceUrl) {
      return false;
    }
    const failedAtMs = new Date(entry.failedAt).getTime();
    return Number.isFinite(failedAtMs) && Date.now() - failedAtMs < this.failureRetryMs;
  }

  async recordFailure(clubId, sourceUrl, sourceIdentity, hash, error) {
    const key = String(clubId);
    const current = this.manifest.clubs[key] || {};
    this.manifest.clubs[key] = Object.assign({}, current, {
      sourceUrl: current.fileName ? current.sourceUrl : sourceUrl,
      sourceIdentity: current.fileName ? current.sourceIdentity : sourceIdentity,
      hash: current.fileName ? current.hash : hash,
      failedSourceUrl: sourceUrl,
      failedSourceIdentity: sourceIdentity,
      failedAt: new Date().toISOString(),
      failureMessage: error && error.message ? error.message : String(error || "Unknown failure")
    });
    await this.saveManifest();
  }

  async downloadLogo(sourceUrl) {
    if (!this.skipNetworkSafetyChecks) {
      await assertPublicUrl(sourceUrl, this.lookupFn);
    }

    const controller = new AbortController();
    const timeout = setTimeout(function () {
      controller.abort();
    }, this.fetchTimeoutMs);

    try {
      const response = await this.fetchFn(sourceUrl, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "mariostrikers.gg club-logo-cache"
        }
      });
      if (!response || !response.ok) {
        throw new Error("Logo download returned HTTP " + (response ? response.status : "unknown") + ".");
      }

      const contentType = String(response.headers && response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const extension = getExtensionForContentType(contentType);
      if (!extension) {
        throw new Error("Unsupported logo content type: " + (contentType || "unknown") + ".");
      }

      const contentLength = Number(response.headers && response.headers.get("content-length") || 0);
      if (contentLength && contentLength > this.maxBytes) {
        throw new Error("Logo is larger than the configured maximum.");
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > this.maxBytes) {
        throw new Error("Logo is larger than the configured maximum.");
      }
      if (!buffer.length) {
        throw new Error("Logo download returned an empty body.");
      }

      return {
        buffer: buffer,
        contentType: contentType,
        extension: extension
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async saveManifest() {
    this.savePromise = this.savePromise.catch(function () {}).then(async () => {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const tempPath = this.manifestPath + ".tmp";
      await fs.writeFile(tempPath, JSON.stringify(this.manifest, null, 2), "utf8");
      await fs.rename(tempPath, this.manifestPath);
    });
    return this.savePromise;
  }

  async removeOldClubFiles(clubId, keepFileName) {
    let entries;
    try {
      entries = await fs.readdir(this.cacheDir);
    } catch (_error) {
      return;
    }

    await Promise.all(entries
      .filter(function (fileName) {
        return fileName !== keepFileName && fileName.startsWith(String(clubId) + "-");
      })
      .map(async (fileName) => {
        try {
          await fs.unlink(path.join(this.cacheDir, fileName));
        } catch (_error) {
          // Ignore best-effort cleanup failures.
        }
      }));
  }

  async getLogoFile(clubId) {
    const normalizedClubId = toPositiveIntOr(clubId, 0);
    if (!normalizedClubId) {
      return null;
    }

    await this.ensureLoaded();
    const entry = this.manifest.clubs[String(normalizedClubId)];
    if (!entry || !entry.fileName || !entry.contentType) {
      return null;
    }

    const absolutePath = path.join(this.cacheDir, entry.fileName);
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) {
        return null;
      }
      return {
        absolutePath: absolutePath,
        contentType: entry.contentType,
        hash: entry.hash,
        byteLength: stat.size
      };
    } catch (_error) {
      return null;
    }
  }

  log(level) {
    if (!this.logger || typeof this.logger[level] !== "function") {
      return;
    }
    this.logger[level].apply(this.logger, Array.prototype.slice.call(arguments, 1));
  }
}

function createClubLogoCache(options) {
  return new ClubLogoCache(options);
}

const defaultClubLogoCache = createClubLogoCache();

module.exports = {
  ClubLogoCache,
  createClubLogoCache,
  defaultClubLogoCache,
  getSourceIdentity,
  normalizeSourceUrl
};
