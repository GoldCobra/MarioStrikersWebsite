// Club logos are user-supplied URLs (often expiring Discord attachment links). The API downloads each
// once, stores it on the cache volume and serves it itself; a failed download keeps the last good file
// and is retried only after failureRetryMs.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { toText } from "@ms/shared/text";
import type { Logger } from "../../lib/logger.ts";
import { toPositiveIntOr } from "../../lib/numbers.ts";
import { safeDownload, type DownloadResult } from "../../lib/safe-download.ts";

const MANIFEST_VERSION = 1;
const ALLOWED_CONTENT_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);
const DISCORD_ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
// Discord signs attachment URLs with these expiring parameters; they do not identify the file.
const DISCORD_AUTH_QUERY_PARAMS = new Set(["ex", "is", "hm"]);

interface ManifestEntry {
  sourceUrl?: string;
  sourceIdentity?: string;
  hash?: string;
  fileName?: string;
  contentType?: string;
  byteLength?: number;
  cachedAt?: string;
  failedSourceUrl?: string;
  failedSourceIdentity?: string;
  failedAt?: string;
  failureMessage?: string;
}

interface Manifest {
  version: number;
  clubs: Record<string, ManifestEntry>;
}

export interface LogoFile {
  readonly absolutePath: string;
  readonly contentType: string;
  readonly hash: string;
  readonly byteLength: number;
}

export type LogoDownloader = (url: string, limits: { maxBytes: number; timeoutMs: number }) => Promise<DownloadResult>;

export interface ClubLogoCacheOptions {
  readonly cacheDir: string;
  readonly maxBytes: number;
  readonly fetchTimeoutMs: number;
  readonly failureRetryMs: number;
  readonly log: Logger;
  readonly publicBasePath?: string;
  readonly download?: LogoDownloader;
}

/** The URL as stored in the Club table, trimmed of quotes; "" unless it is http(s). */
export function normalizeSourceUrl(value: unknown): string {
  const text = toText(value)
    .trim()
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function getDiscordAttachmentIdentity(parsed: URL): string {
  if (!DISCORD_ATTACHMENT_HOSTS.has(parsed.hostname.toLowerCase())) return "";
  if (!/^\/attachments\/\d+\/\d+\/.+/.test(parsed.pathname)) return "";
  const meaningful: [string, string][] = [];
  parsed.searchParams.forEach((value, key) => {
    if (key && !DISCORD_AUTH_QUERY_PARAMS.has(key.toLowerCase())) meaningful.push([key, value]);
  });
  meaningful.sort((a, b) => `${a[0]}=${a[1]}`.localeCompare(`${b[0]}=${b[1]}`));
  const query = meaningful.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  return `discord:${parsed.pathname}${query ? `?${query}` : ""}`;
}

/** Stable identity of a logo source: Discord attachments ignore their expiring signature. */
export function getSourceIdentity(sourceUrl: string): string {
  const parsed = new URL(sourceUrl);
  return getDiscordAttachmentIdentity(parsed) || parsed.href;
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export class ClubLogoCache {
  private readonly options: ClubLogoCacheOptions;
  private readonly cacheDir: string;
  private readonly manifestPath: string;
  private readonly download: LogoDownloader;
  private manifest: Manifest | null = null;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(options: ClubLogoCacheOptions) {
    this.options = options;
    this.cacheDir = path.resolve(options.cacheDir);
    this.manifestPath = path.join(this.cacheDir, "manifest.json");
    this.download = options.download ?? ((url, limits) => safeDownload(url, limits));
  }

  private async loadManifest(): Promise<Manifest> {
    if (this.manifest) return this.manifest;
    try {
      const parsed = JSON.parse(await fs.readFile(this.manifestPath, "utf8")) as Partial<Manifest> | null;
      if (parsed?.version === MANIFEST_VERSION && parsed.clubs) {
        this.manifest = { version: MANIFEST_VERSION, clubs: parsed.clubs };
        return this.manifest;
      }
    } catch {
      // Missing or invalid manifests are rebuilt lazily.
    }
    this.manifest = { version: MANIFEST_VERSION, clubs: {} };
    return this.manifest;
  }

  private async fileExists(fileName: string | undefined): Promise<boolean> {
    if (!fileName) return false;
    try {
      await fs.access(path.join(this.cacheDir, fileName));
      return true;
    } catch {
      return false;
    }
  }

  private buildPublicUrl(clubId: number, hash: string): string {
    const base = this.options.publicBasePath ?? "/api/clubs/msbl";
    return `${base}/${encodeURIComponent(String(clubId))}/logo?v=${encodeURIComponent(hash)}`;
  }

  private async getExistingPublicUrl(clubId: number): Promise<string> {
    const entry = (await this.loadManifest()).clubs[String(clubId)];
    if (!entry?.hash || !entry.fileName || !(await this.fileExists(entry.fileName))) return "";
    return this.buildPublicUrl(clubId, entry.hash);
  }

  private isRecentFailure(entry: ManifestEntry | undefined, sourceIdentity: string, sourceUrl: string): boolean {
    if (!entry?.failedAt || entry.failedSourceIdentity !== sourceIdentity || entry.failedSourceUrl !== sourceUrl) {
      return false;
    }
    const failedAtMs = new Date(entry.failedAt).getTime();
    return Number.isFinite(failedAtMs) && Date.now() - failedAtMs < this.options.failureRetryMs;
  }

  /** Public URL of the club's cached logo, downloading it first when the source changed. */
  async ensureClubLogo(club: { club_id?: unknown; logo_source?: unknown }): Promise<string> {
    const clubId = toPositiveIntOr(club.club_id, 0);
    const sourceUrl = normalizeSourceUrl(club.logo_source);
    if (!clubId || !sourceUrl) return "";

    const manifest = await this.loadManifest();
    const sourceIdentity = getSourceIdentity(sourceUrl);
    const hash = hashText(sourceIdentity);
    const current = manifest.clubs[String(clubId)];
    if (current?.sourceIdentity === sourceIdentity && current.hash && (await this.fileExists(current.fileName))) {
      return this.buildPublicUrl(clubId, current.hash);
    }
    if (this.isRecentFailure(current, sourceIdentity, sourceUrl)) return this.getExistingPublicUrl(clubId);

    try {
      const downloaded = await this.download(sourceUrl, {
        maxBytes: this.options.maxBytes,
        timeoutMs: this.options.fetchTimeoutMs,
      });
      const extension = ALLOWED_CONTENT_TYPES.get(downloaded.contentType);
      if (!extension) throw new Error(`Unsupported logo content type: ${downloaded.contentType || "unknown"}.`);
      if (downloaded.buffer.length > this.options.maxBytes)
        throw new Error("Logo is larger than the configured maximum.");
      const fileName = `${clubId}-${hash}${extension}`;
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(path.join(this.cacheDir, fileName), downloaded.buffer);
      manifest.clubs[String(clubId)] = {
        sourceUrl,
        sourceIdentity,
        hash,
        fileName,
        contentType: downloaded.contentType,
        byteLength: downloaded.buffer.length,
        cachedAt: new Date().toISOString(),
      };
      await this.saveManifest();
      await this.removeOldClubFiles(clubId, fileName);
      return this.buildPublicUrl(clubId, hash);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.log.warn({ clubId, reason: message }, "[club-logo-cache] Failed to cache logo");
      await this.recordFailure(clubId, sourceUrl, sourceIdentity, hash, message);
      return this.getExistingPublicUrl(clubId);
    }
  }

  private async recordFailure(
    clubId: number,
    sourceUrl: string,
    sourceIdentity: string,
    hash: string,
    message: string,
  ): Promise<void> {
    const manifest = await this.loadManifest();
    const current = manifest.clubs[String(clubId)] ?? {};
    manifest.clubs[String(clubId)] = {
      ...current,
      sourceUrl: current.fileName ? current.sourceUrl : sourceUrl,
      sourceIdentity: current.fileName ? current.sourceIdentity : sourceIdentity,
      hash: current.fileName ? current.hash : hash,
      failedSourceUrl: sourceUrl,
      failedSourceIdentity: sourceIdentity,
      failedAt: new Date().toISOString(),
      failureMessage: message || "Unknown failure",
    };
    await this.saveManifest();
  }

  private saveManifest(): Promise<void> {
    this.savePromise = this.savePromise
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.cacheDir, { recursive: true });
        const tempPath = `${this.manifestPath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(this.manifest, null, 2), "utf8");
        await fs.rename(tempPath, this.manifestPath);
      });
    return this.savePromise;
  }

  private async removeOldClubFiles(clubId: number, keepFileName: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.cacheDir);
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter((fileName) => fileName !== keepFileName && fileName.startsWith(`${clubId}-`))
        .map((fileName) => fs.unlink(path.join(this.cacheDir, fileName)).catch(() => undefined)),
    );
  }

  /** The cached file for a club id from the URL; null when there is none. */
  async getLogoFile(clubIdRaw: unknown): Promise<LogoFile | null> {
    const clubId = toPositiveIntOr(clubIdRaw, 0);
    if (!clubId) return null;
    const entry = (await this.loadManifest()).clubs[String(clubId)];
    if (!entry?.fileName || !entry.contentType || !entry.hash) return null;
    const absolutePath = path.join(this.cacheDir, entry.fileName);
    try {
      const stat = await fs.stat(absolutePath);
      return stat.isFile()
        ? { absolutePath, contentType: entry.contentType, hash: entry.hash, byteLength: stat.size }
        : null;
    } catch {
      return null;
    }
  }
}
