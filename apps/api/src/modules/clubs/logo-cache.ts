// Club logos given as a link (often expiring Discord attachment links): the API downloads each once, re-encodes it
// into the site's logo rendition (logo-image.ts, a 512 px WebP), stores that on the cache volume and serves it
// itself. A failed download keeps the last good file and is retried only after failureRetryMs.

import fs from "node:fs/promises";
import path from "node:path";
import { toText } from "@ms/shared/text";
import type { Logger } from "../../lib/logger.ts";
import { toPositiveIntOr } from "../../lib/numbers.ts";
import { safeDownload, type DownloadResult } from "../../lib/safe-download.ts";
import { renderLogo } from "./logo-image.ts";

const MANIFEST_VERSION = 1;
/** Raised when logo-image.ts's output changes: a file cached earlier is then re-encoded from itself. */
const RENDITION = 1;
/** Linked images may be larger than uploads may be (2048 px per side); nothing beyond this is decoded. */
const MAX_INPUT_PIXELS = 8192 * 8192;
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
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
  rendition?: number;
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
    const current = manifest.clubs[String(clubId)];
    const cachedFile =
      current?.sourceIdentity === sourceIdentity && current.fileName && (await this.fileExists(current.fileName))
        ? path.join(this.cacheDir, current.fileName)
        : "";
    if (cachedFile && current?.hash && current.rendition === RENDITION)
      return this.buildPublicUrl(clubId, current.hash);
    if (this.isRecentFailure(current, sourceIdentity, sourceUrl)) return this.getExistingPublicUrl(clubId);

    try {
      // A file cached before the current rendition is re-encoded from itself: its link may long have expired.
      const bytes = cachedFile ? await fs.readFile(cachedFile) : await this.downloadLogo(sourceUrl);
      return await this.store(clubId, sourceUrl, sourceIdentity, bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.log.warn({ clubId, reason: message }, "[club-logo-cache] Failed to cache logo");
      await this.recordFailure(clubId, sourceUrl, sourceIdentity, message);
      return this.getExistingPublicUrl(clubId);
    }
  }

  private async downloadLogo(sourceUrl: string): Promise<Buffer> {
    const { maxBytes, fetchTimeoutMs } = this.options;
    const downloaded = await this.download(sourceUrl, { maxBytes, timeoutMs: fetchTimeoutMs });
    if (!ALLOWED_CONTENT_TYPES.has(downloaded.contentType)) {
      throw new Error(`Unsupported logo content type: ${downloaded.contentType || "unknown"}.`);
    }
    if (downloaded.buffer.length > maxBytes) throw new Error("Logo is larger than the configured maximum.");
    return downloaded.buffer;
  }

  /** Encodes the rendition of `bytes`, stores it as the club's logo and returns its public URL (its hash in ?v=). */
  private async store(clubId: number, sourceUrl: string, sourceIdentity: string, bytes: Buffer): Promise<string> {
    const logo = await renderLogo(bytes, MAX_INPUT_PIXELS);
    const hash = logo.hash.slice(0, 16);
    const fileName = `${clubId}-${hash}.webp`;
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(path.join(this.cacheDir, fileName), logo.data);
    const manifest = await this.loadManifest();
    manifest.clubs[String(clubId)] = {
      sourceUrl,
      sourceIdentity,
      hash,
      fileName,
      contentType: logo.contentType,
      byteLength: logo.data.length,
      rendition: RENDITION,
      cachedAt: new Date().toISOString(),
    };
    await this.saveManifest();
    await this.removeOldClubFiles(clubId, fileName);
    return this.buildPublicUrl(clubId, hash);
  }

  /** Notes the failed source; the club's last good file (if any) stays its logo. */
  private async recordFailure(
    clubId: number,
    sourceUrl: string,
    sourceIdentity: string,
    message: string,
  ): Promise<void> {
    const manifest = await this.loadManifest();
    manifest.clubs[String(clubId)] = {
      ...manifest.clubs[String(clubId)],
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
