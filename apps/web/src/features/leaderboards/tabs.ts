// The leaderboard tab strip: one tab per game and mode. It is rendered into the page at build time; the
// browser module marks the active tab and loads its rows.

import { escapeHtml } from "@ms/shared/html";

export interface LeaderboardTab {
  /** Page slug, e.g. "msbl-elo1v1"; also the game and mode the rows are loaded for. */
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  /** Intrinsic size of the square icon; CSS draws it at 18px. */
  readonly iconSize: number;
}

export const LEADERBOARD_TABS: readonly LeaderboardTab[] = [
  { key: "msbl-elo1v1", label: "ELO 1v1", icon: "msblball.png", iconSize: 128 },
  { key: "msbl-whr", label: "WHR", icon: "msblball.png", iconSize: 128 },
  { key: "msc-elo1v1", label: "ELO 1v1", icon: "mscball.png", iconSize: 64 },
  { key: "msc-whr", label: "WHR", icon: "mscball.png", iconSize: 64 },
  { key: "sms-elo1v1", label: "ELO 1v1", icon: "smsball.png", iconSize: 128 },
  { key: "sms-whr", label: "WHR", icon: "smsball.png", iconSize: 128 },
];

// Asset URLs are relative to the page, as the former engine wrote them; every page URL is one level deep.
export const ASSET_PREFIX = ".";

function tabLabel(label: string): string {
  return label.toUpperCase().replace(/(\d)V(\d)/g, "$1v$2");
}

function tabInner(tab: LeaderboardTab): string {
  const fallback = `${ASSET_PREFIX}/assets/nav-buttons/sub/${tab.icon}`;
  const src = `${ASSET_PREFIX}/assets/nav-buttons/sub/${tab.icon.replace(/\.png$/i, ".webp")}`;
  return [
    '<span class="leaderboard-tab-inner">',
    `<img class="leaderboard-tab-ball" src="${escapeHtml(src)}" width="${tab.iconSize}" height="${tab.iconSize}" alt="" aria-hidden="true" data-fallback-src="${escapeHtml(fallback)}">`,
    `<span class="leaderboard-tab-label">${escapeHtml(tabLabel(tab.label))}</span>`,
    "</span>",
  ].join("");
}

function tabLink(tab: LeaderboardTab, pageKey: string): string {
  const href = escapeHtml(`/${tab.key}`);
  const active = tab.key === pageKey;
  return [
    `<a id="${pageKey}-tab-${tab.key}" class="global-tab leaderboard-ball-tab${active ? " is-active" : ""}" href="${href}" data-lb-tab="${tab.key}" data-lb-href="${href}"`,
    active ? ' aria-current="page"' : "",
    ">",
    tabInner(tab),
    "</a>",
  ].join("");
}

/** Content of #leaderboards-root: the tab strip and the (still empty) rows block. */
export function renderLeaderboardShell(pageKey: string): string {
  return [
    '<section class="global-tabs-shell leaderboard-tabs-shell" aria-label="Leaderboards">',
    '<nav class="global-tabs-list" aria-label="Leaderboard tabs">',
    LEADERBOARD_TABS.map((tab) => tabLink(tab, pageKey)).join(""),
    "</nav>",
    "</section>",
    '<section class="leaderboard-block" aria-label="Leaderboard rows">',
    '<div id="leaderboard-list" class="leaderboard-list" role="list"></div>',
    '<p id="leaderboard-empty" class="leaderboard-empty" hidden>No ratings available.</p>',
    "</section>",
  ].join("");
}
