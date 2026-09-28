// Leaderboard rows: loaded for the active tab, kept five minutes in sessionStorage so tab switches and
// returns show rows at once (refreshed in the background), and a message when the API is unreachable.

import { escapeHtml } from "@ms/shared/html";
import { COMPETITIVE_RANK_ICON_BY_NUMBER, RANK_ICON_ASSET_VERSION } from "@ms/shared/ranks";
import { fetchJson } from "../../lib/api.ts";
import { initTabsGroup } from "../tabs/tabs-engine.ts";
import { ASSET_PREFIX, LEADERBOARD_TABS } from "./tabs.ts";

const SESSION_CACHE_PREFIX = "leaderboardRows:v4::";
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
const ROW_ASSET_FILES = ["normal-rank.png", "rank1.png", "rank2.png", "rank3.png"];

/** Rank names as the API may spell them, without punctuation. */
const RANK_ICON_BY_NAME: Readonly<Record<string, string>> = {
  bronzei: "1-bronze-I.png",
  bronze1: "1-bronze-I.png",
  bronzeii: "1-bronze-II.png",
  bronze2: "1-bronze-II.png",
  bronzeiii: "1-bronze-III.png",
  bronze3: "1-bronze-III.png",
  silveri: "2-silver-I.png",
  silver1: "2-silver-I.png",
  silverii: "2-silver-II.png",
  silver2: "2-silver-II.png",
  silveriii: "2-silver-III.png",
  silver3: "2-silver-III.png",
  goldi: "3-gold-I.png",
  gold1: "3-gold-I.png",
  goldii: "3-gold-II.png",
  gold2: "3-gold-II.png",
  goldiii: "3-gold-III.png",
  gold3: "3-gold-III.png",
  platinumi: "4-platinum-I.png",
  platinum1: "4-platinum-I.png",
  platinumii: "4-platinum-II.png",
  platinum2: "4-platinum-II.png",
  platinumiii: "4-platinum-III.png",
  platinum3: "4-platinum-III.png",
  diamondi: "5-diamond-I.png",
  diamond1: "5-diamond-I.png",
  diamondii: "5-diamond-II.png",
  diamond2: "5-diamond-II.png",
  diamondiii: "5-diamond-III.png",
  diamond3: "5-diamond-III.png",
  masteri: "6-master-I.png",
  master1: "6-master-I.png",
  masterii: "6-master-II.png",
  master2: "6-master-II.png",
  masteriii: "6-master-III.png",
  master3: "6-master-III.png",
  strikerstitan: "7-strikerstitan-b.png",
  titan: "7-strikerstitan-b.png",
};

interface Row {
  readonly rank: number;
  readonly player_id: number | null;
  readonly display_name: string;
  readonly rating: number;
  readonly rank_number: number;
  readonly competitive_rank: string;
}

type RowSource = "cache" | "network";

let activeRender = 0;
let rowAssetsPreload: Promise<unknown> | null = null;

function text(value: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- API strings and numbers
  return value ? String(value) : "";
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRows(rows: unknown): Row[] {
  if (!Array.isArray(rows)) return [];
  return (rows as (Record<string, unknown> | null)[])
    .map((row, index): Row | null => {
      const rank = Number(row?.rank);
      const rating = Number(row?.rating);
      const rankNumber = Number(row?.rank_number);
      const displayName = text(row?.display_name || row?.player || row?.name).trim();
      const competitiveRank = text(
        row?.competitive_rank || row?.competitiveRank || row?.rank_name || row?.rankName,
      ).trim();
      if (!displayName || !Number.isFinite(rating)) return null;
      return {
        rank: Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : index + 1,
        player_id: positiveInt(row?.player_id),
        display_name: displayName,
        rating,
        rank_number: Number.isFinite(rankNumber) && rankNumber > 0 ? Math.floor(rankNumber) : 0,
        competitive_rank: competitiveRank,
      };
    })
    .filter((row): row is Row => row !== null);
}

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      resolve();
    };
    image.src = src;
    if (image.complete) resolve();
  });
}

/** The row backgrounds are loaded before the first rows show, so rows never appear without them. */
function preloadRowAssets(): Promise<unknown> {
  rowAssetsPreload ??= Promise.all(
    ROW_ASSET_FILES.map((file) => preloadImage(`${ASSET_PREFIX}/assets/leaderboards/${file}`)),
  ).catch(() => undefined);
  return rowAssetsPreload;
}

function cacheKey(tabKey: string): string {
  return SESSION_CACHE_PREFIX + tabKey;
}

function readCachedRows(tabKey: string): Row[] | null {
  try {
    const raw = window.sessionStorage.getItem(cacheKey(tabKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows?: unknown; timestamp?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    const timestamp = Number(parsed.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || Date.now() - timestamp > SESSION_CACHE_TTL_MS) return null;
    const rows = normalizeRows(parsed.rows);
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

function writeCachedRows(tabKey: string, rows: readonly Row[]): void {
  try {
    if (!rows.length) return;
    window.sessionStorage.setItem(cacheKey(tabKey), JSON.stringify({ timestamp: Date.now(), rows }));
  } catch {
    // The cache is optional.
  }
}

function formatRating(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.floor(value) === value) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function rowClass(rank: number, hasRankIcon: boolean): string {
  let className = "lb-row";
  if (rank === 1) className += " lb-row-rank-1";
  else if (rank === 2) className += " lb-row-rank-2";
  else if (rank === 3) className += " lb-row-rank-3";
  return hasRankIcon ? `${className} lb-row-has-rank-icon` : className;
}

function rankIconFile(row: Row): string {
  const byNumber = COMPETITIVE_RANK_ICON_BY_NUMBER[Math.floor(row.rank_number)];
  if (byNumber) return byNumber;
  const key = row.competitive_rank.toLowerCase().replace(/[^a-z0-9]/g, "");
  return key && Object.hasOwn(RANK_ICON_BY_NAME, key) ? (RANK_ICON_BY_NAME[key] ?? "") : "";
}

function rankIcon(row: Row): string {
  const file = rankIconFile(row);
  if (!file) return "";
  const src = `${ASSET_PREFIX}/assets/leaderboards/rankicons/${file}?v=${RANK_ICON_ASSET_VERSION}`;
  return `<img class="lb-rank-icon" src="${escapeHtml(src)}" alt="" aria-hidden="true" loading="lazy">`;
}

function rankMarkup(rank: number): string {
  if (rank !== 1) return `<span class="lb-rank">${escapeHtml(rank)}</span>`;
  return [
    '<span class="lb-rank-1">',
    '<svg class="lb-rank-1-svg" viewBox="0 0 100 120" aria-hidden="true" focusable="false">',
    '<defs><linearGradient id="lb-rank1-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="120">',
    '<stop offset="0%" stop-color="#fff45a"></stop>',
    '<stop offset="52%" stop-color="#ffc800"></stop>',
    '<stop offset="100%" stop-color="#9a5b00"></stop>',
    "</linearGradient></defs>",
    '<text class="lb-rank-1-svg-stroke" x="50" y="50%" text-anchor="middle">1</text>',
    '<text class="lb-rank-1-svg-fill" x="50" y="50%" text-anchor="middle" fill="url(#lb-rank1-grad)">1</text>',
    "</svg>",
    "</span>",
  ].join("");
}

function rowsHtml(rows: readonly Row[]): string {
  return rows
    .map((row) => {
      const icon = rankIcon(row);
      const name = row.player_id
        ? `<button type="button" class="lb-player-trigger" data-player-id="${row.player_id}" aria-haspopup="dialog" aria-controls="player-profile-popup" aria-label="Open profile for ${escapeHtml(row.display_name)}">${escapeHtml(row.display_name)}</button>`
        : `<span class="lb-player-static">${escapeHtml(row.display_name)}</span>`;
      return [
        `<article class="${rowClass(row.rank, Boolean(icon))}" role="listitem">`,
        icon,
        '<div class="lb-inner-frame">',
        `<div class="lb-rank-cell">${rankMarkup(row.rank)}</div>`,
        `<div class="lb-player">${name}</div>`,
        `<div class="lb-points">${escapeHtml(formatRating(row.rating))}</div>`,
        "</div>",
        "</article>",
      ].join("");
    })
    .join("");
}

/** The rows of a tab, from this tab session's cache or the API; null when neither has them. */
async function fetchRows(tabKey: string, allowCache: boolean): Promise<{ rows: Row[]; source: RowSource } | null> {
  const cached = allowCache ? readCachedRows(tabKey) : null;
  if (cached) return { rows: cached, source: "cache" };

  const dash = tabKey.indexOf("-");
  if (dash <= 0 || dash >= tabKey.length - 1) return null;
  const url = `/api/leaderboards/${tabKey.slice(0, dash)}/${tabKey.slice(dash + 1)}?limit=100&offset=0`;
  try {
    const payload = await fetchJson<{ rows?: unknown } | null>(url);
    const rows = normalizeRows(payload?.rows);
    writeCachedRows(tabKey, rows);
    return { rows, source: "network" };
  } catch {
    return null;
  }
}

async function renderRows(tabKey: string): Promise<void> {
  const request = ++activeRender;
  const list = document.getElementById("leaderboard-list");
  const empty = document.getElementById("leaderboard-empty");
  if (!list || !empty) return;
  list.innerHTML = "";
  empty.textContent = "Loading...";
  empty.hidden = false;

  const primary = await fetchRows(tabKey, true);
  await (rowAssetsPreload ?? Promise.resolve());
  if (request !== activeRender) return;
  if (!primary) {
    list.innerHTML = "";
    empty.textContent = "Ratings could not be loaded.";
    empty.hidden = false;
    return;
  }
  if (!primary.rows.length) {
    list.innerHTML = "";
    empty.textContent = "No ratings available.";
    empty.hidden = false;
    return;
  }
  list.innerHTML = rowsHtml(primary.rows);
  empty.hidden = true;

  if (primary.source === "cache") {
    // Cached rows show at once; fresh rows replace them when they arrive.
    fetchRows(tabKey, false)
      .then((refreshed) => {
        if (refreshed?.source !== "network" || request !== activeRender) return;
        list.innerHTML = rowsHtml(refreshed.rows);
        empty.hidden = refreshed.rows.length > 0;
      })
      .catch(() => undefined);
  }
}

function pageKey(): string {
  return (document.body.getAttribute("data-page") ?? "").toLowerCase();
}

/** Binds the tab strip rendered into #leaderboards-root and loads the rows of the page's tab. */
export function initLeaderboard(): void {
  const mount = document.getElementById("leaderboards-root");
  const shell = mount?.querySelector<HTMLElement>(".global-tabs-shell");
  const tabsRoot = mount?.querySelector<HTMLElement>(".global-tabs-list");
  const tabs = Array.from(mount?.querySelectorAll<HTMLAnchorElement>("[data-lb-tab]") ?? []);
  if (!shell || !tabsRoot || !tabs.length) return;

  const current = pageKey();
  void preloadRowAssets();
  const strip = initTabsGroup({ shell, tabsRoot, tabSelector: ".global-tab", activeSelector: ".global-tab.is-active" });

  const setActiveTab = (tabKey: string): void => {
    for (const tab of tabs) {
      const active = tab.getAttribute("data-lb-tab") === tabKey;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
      tab.tabIndex = active ? 0 : -1;
    }
    if (strip) {
      strip.sync();
      strip.revealActiveTab();
    }
    void renderRows(tabKey);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", (event) => {
      const tabKey = tab.getAttribute("data-lb-tab");
      if (tabKey !== current) return;
      event.preventDefault();
      setActiveTab(tabKey);
    });
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next]?.focus();
    });
  });

  if (LEADERBOARD_TABS.some((tab) => tab.key === current)) setActiveTab(current);
}
