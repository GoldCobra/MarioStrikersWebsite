// Markup of the site shell: main navigation, second-level navigation, content tabs, footer and the
// head links every page shares. It is rendered at build time and must equal, character for character,
// what the former runtime navigation script built, including attribute order and the absence of
// whitespace between elements (both reach the rendered layout).

import { escapeHtml } from "@ms/shared/html";
import {
  EXTERNAL_LINKS,
  loginPath,
  TOP_NAV_ITEMS,
  type NavLeaf,
  type NavSecond,
  type TopNavItem,
} from "@ms/shared/site/navigation";
import { childMatchesPage, sectionFor, type PageState } from "@ms/shared/site/page-state";
import { pagePath } from "@ms/shared/site/pages";

// Asset URLs are relative to the page, as the runtime script wrote them; every page URL is one level deep.
const ASSET_PREFIX = ".";

function topNavIcon(key: string, active: boolean, extension: "png" | "webp"): string {
  const state = active ? "active" : "default";
  return `${ASSET_PREFIX}/assets/nav-buttons/${state}/nav-${key}${active ? "-active" : ""}.${extension}`;
}

function topNavLink(item: TopNavItem, state: PageState): string {
  const active = state.topKey === item.key;
  const current = state.pageSlug === item.slug && (item.key === "home" || item.key === "partners");
  const label = escapeHtml(item.label);
  return [
    `<a class="nav-top-link${active ? " is-active" : ""}" href="${pagePath(item.slug)}" data-top-key="${item.key}" aria-label="${label}"`,
    current ? ' aria-current="page"' : "",
    ">",
    `<img class="nav-top-icon" src="${topNavIcon(item.key, active, "webp")}" width="733" height="198" alt="${label}"`,
    ` data-fallback-src="${topNavIcon(item.key, active, "png")}">`,
    "</a>",
  ].join("");
}

/** Content of #global-nav: logo, the five top-level buttons and the account widget. */
export function renderMainNav(state: PageState): string {
  return [
    '<header id="2">',
    `<a class="nav-brand" href="/" aria-label="Mario Strikers Community home">`,
    `<img class="nav-brand-logo" src="${ASSET_PREFIX}/assets/logo/logo.webp" width="2172" height="1454" alt="Mario Strikers Community"`,
    ` data-fallback-src="${ASSET_PREFIX}/assets/logo/logo.png">`,
    '<span class="nav-brand-est">EST. 2017</span>',
    "</a>",
    '<nav class="main-nav main-nav-text" aria-label="Main navigation">',
    TOP_NAV_ITEMS.map((item) => topNavLink(item, state)).join(""),
    "</nav>",
    '<div id="global-account" class="global-account" data-auth-state="loading"></div>',
    "</header>",
  ].join("");
}

function subNavLink(item: NavSecond, state: PageState): string {
  const current = state.pageSlug === item.slug;
  const active = state.secondItem?.key === item.key || current;
  const label = escapeHtml(item.subnavLabel ?? item.label);
  return [
    `<a class="sub-link sub-link-text${active ? " is-active" : ""}" href="${pagePath(item.slug)}" aria-label="${label}"`,
    current ? ' aria-current="page"' : "",
    `><span class="sub-link-label">${label}</span></a>`,
  ].join("");
}

/** Content of #global-subnav: the second-level links of the page's section, or "" for none. */
export function renderSubNav(state: PageState): string {
  const section = state.section ?? sectionFor(state.topKey);
  if (!section || section.items.length === 0) return "";
  const links = section.items.map((item) => subNavLink(item, state)).join("");
  return `<nav class="sub-nav sub-nav-level2" aria-label="${escapeHtml(section.label)} navigation">${links}</nav>`;
}

function tabLabel(label: string): string {
  return label.toUpperCase().replace(/(\d)V(\d)/g, "$1v$2");
}

function contentTab(child: NavLeaf, state: PageState): string {
  const current = childMatchesPage(child, state.pageSlug);
  return [
    `<a class="global-tab${current ? " is-active" : ""}" href="${pagePath(child.slug)}" aria-label="${escapeHtml(child.label)}"`,
    current ? ' aria-current="page"' : "",
    `>${escapeHtml(tabLabel(child.label))}</a>`,
  ].join("");
}

/** Content of #global-content-tabs: the tabs of the page's second-level item, or "" for none. */
export function renderContentTabs(state: PageState): string {
  const parent = state.secondItem;
  if (!parent?.children?.length) return "";
  // Leaderboard pages draw their own game and mode tabs.
  if (state.topKey === "competitive" && parent.key === "leaderboards") return "";
  const tabs = parent.children
    .filter((child) => !child.hidden)
    .map((child) => contentTab(child, state))
    .join("");
  return [
    `<section class="global-tabs-shell" aria-label="${escapeHtml(parent.label)} tabs">`,
    `<div class="global-tabs-list">${tabs}</div>`,
    "</section>",
  ].join("");
}

/** The footer at the end of <body>, in the attribute order the runtime script's DOM calls produced. */
export function renderFooter(): string {
  const external = ' target="_blank" rel="noopener noreferrer"';
  const links = [
    // The login is no page for search engines: they are kept off its redirect to Discord.
    { label: "LOGIN", href: loginPath(), attributes: ' rel="nofollow"' },
    ...EXTERNAL_LINKS.map((link) => ({ label: link.label.toUpperCase(), href: link.href, attributes: external })),
    { label: "ABOUT US", href: pagePath("about-us"), attributes: "" },
    { label: "PRIVACY POLICY", href: pagePath("privacy-policy"), attributes: "" },
  ]
    .map(
      (link) =>
        `<a href="${escapeHtml(link.href)}" class="global-footer-link"${link.attributes}>${escapeHtml(link.label)}</a>`,
    )
    .join('<span class="global-footer-sep">–</span>');
  return [
    '<footer id="global-footer">',
    '<p class="global-footer-disclaimer">This website is not affiliated with Nintendo. All product names, logos, and brands are property of their respective owners.</p>',
    `<p class="global-footer-links">${links}</p>`,
    "</footer>",
  ].join("");
}

/** Favicon links in the attribute order the runtime script's DOM calls produced. */
export function renderFaviconLinks(): string[] {
  const png = `${ASSET_PREFIX}/assets/favicon/blball.png`;
  const ico = `${ASSET_PREFIX}/assets/favicon/favicon.ico`;
  return [
    `<link rel="icon" href="${png}" type="image/png" sizes="32x32">`,
    `<link rel="icon" href="${ico}" type="image/x-icon">`,
    `<link rel="shortcut icon" href="${ico}" type="image/x-icon">`,
    `<link rel="apple-touch-icon" href="${png}" type="image/png">`,
  ];
}
