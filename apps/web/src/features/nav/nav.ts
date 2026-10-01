// Behaviour of the navigation the layout renders into every page: the account widget, the page tabs,
// centring of overflowing navigation, link prefetching and redirects of old ?tabs= and ?submenu= links.

import { escapeHtml } from "@ms/shared/html";
import { initTabsGroup } from "../tabs/tabs-engine.ts";

interface DiscordUser {
  readonly id?: string;
  readonly username?: string;
  readonly global_name?: string;
  readonly avatar?: string;
}

const LEGACY_SUBMENU_ROUTES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  games: { msbl: "msbl", msc: "msc", sms: "sms" },
  competitive: {
    rules: "competitive-rules",
    leaderboards: "competitive-leaderboards",
    "tier-lists": "competitive-tier-lists",
    msl: "msl",
    tournaments: "competitive-tournaments",
  },
};

const prefetched = new Set<string>();

function toPageSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^\/*(?:pages\/)?/, "")
    .replace(/\/+$/, "")
    .replace(/\.html$/, "");
}

function pageSlug(): string {
  const fromBody = document.body.getAttribute("data-page");
  if (fromBody) return toPageSlug(fromBody) || "index";
  const path = window.location.pathname.toLowerCase();
  if (!path || path === "/") return "index";
  return toPageSlug(path.replace(/\/+$/, "").split("/").pop() ?? "") || "index";
}

function pageHref(slug: string): string {
  const page = toPageSlug(slug);
  return !page || page === "index" ? "/" : `/${page}`;
}

/** Old links opened overviews with ?submenu=<section> or hid tabs with ?tabs=none. */
function redirectLegacyUrl(slug: string): boolean {
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) return false;
  const submenu = (params.get("submenu") ?? "").trim().toLowerCase();
  const tabs = (params.get("tabs") ?? "").trim().toLowerCase();
  const routes = Object.hasOwn(LEGACY_SUBMENU_ROUTES, slug) ? LEGACY_SUBMENU_ROUTES[slug] : undefined;
  let target = "";
  if (submenu && routes && Object.hasOwn(routes, submenu)) target = routes[submenu] ?? "";
  else if (submenu || tabs === "none") target = slug;
  if (!target) return false;

  const kept = new URLSearchParams();
  params.forEach((value, key) => {
    if (key !== "submenu" && key !== "tabs") kept.append(key, value);
  });
  const query = kept.toString();
  const next = pageHref(target) + (query ? `?${query}` : "") + window.location.hash;
  if (next === window.location.pathname + window.location.search + window.location.hash) return false;
  window.location.replace(next);
  return true;
}

function prefetch(href: string | null): void {
  if (!href) return;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) return;
  if (url.pathname === window.location.pathname && url.search === window.location.search) return;
  if (prefetched.has(url.href)) return;
  prefetched.add(url.href);
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "document";
  link.href = url.href;
  document.head.appendChild(link);
}

function prefetchLinkOf(target: EventTarget | null): void {
  const anchor = target instanceof Element ? target.closest("a[href]") : null;
  prefetch(anchor?.getAttribute("href") ?? null);
}

/** Prefetches a page when the pointer or focus reaches one of its links. */
function bindLinkPrefetch(root: HTMLElement | null): void {
  if (!root || root.getAttribute("data-prefetch-bound") === "true") return;
  root.setAttribute("data-prefetch-bound", "true");
  root.addEventListener(
    "pointerenter",
    (event) => {
      prefetchLinkOf(event.target);
    },
    true,
  );
  root.addEventListener("focusin", (event) => {
    prefetchLinkOf(event.target);
  });
}

function scheduleInitialPrefetch(): void {
  // Safari has no requestIdleCallback.
  const whenIdle = (callback: () => void): void => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(callback);
    else setTimeout(callback, 900);
  };
  whenIdle(() => {
    const anchors = Array.from(document.querySelectorAll("#global-subnav a[href], #global-content-tabs a[href]"));
    for (const anchor of anchors.slice(0, 8)) prefetch(anchor.getAttribute("href"));
  });
}

function discordAvatarUrl(user: DiscordUser): string {
  const id = (user.id ?? "").trim();
  const avatar = (user.avatar ?? "").trim();
  if (!id || !avatar) return "";
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(id)}/${encodeURIComponent(avatar)}.png?size=64`;
}

/** Every login ends on the profile page, which also explains a failed one. */
const LOGIN_URL = "/api/auth/discord/start?returnTo=%2Fprofile";
// A person in the icon circle the signed-in button shows its avatar in; phones show the icon alone.
const LOGIN_ICON =
  '<svg class="global-account-login-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
  '<circle cx="8" cy="5" r="3" fill="currentColor"/><path d="M2.5 14.5c0-3.2 2.4-5.4 5.5-5.4s5.5 2.2 5.5 5.4z" fill="currentColor"/></svg>';

function renderLoggedOut(root: HTMLElement, loginAvailable: boolean): void {
  root.setAttribute("data-auth-state", "logged-out");
  root.innerHTML = loginAvailable
    ? [
        `<a class="global-account-button global-account-login" href="${LOGIN_URL}" aria-label="Login with Discord">`,
        `<span class="global-account-icon" aria-hidden="true">${LOGIN_ICON}</span>`,
        '<span class="global-account-name" aria-hidden="true">Login</span>',
        "</a>",
      ].join("")
    : "";
}

function renderLoggedIn(root: HTMLElement, user: DiscordUser): void {
  const name = (user.global_name || user.username || user.id || "Account").trim();
  const avatarUrl = discordAvatarUrl(user);
  const avatar = avatarUrl
    ? `<img class="global-account-avatar" src="${escapeHtml(avatarUrl)}" alt="" aria-hidden="true" referrerpolicy="no-referrer" data-on-error="hide">`
    : '<span class="global-account-icon" aria-hidden="true">D</span>';
  root.setAttribute("data-auth-state", "logged-in");
  root.innerHTML = [
    '<button class="global-account-button global-account-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-account-action="toggle">',
    avatar,
    `<span class="global-account-name">${escapeHtml(name)}</span>`,
    "</button>",
    '<div class="global-account-menu" role="menu" hidden>',
    '<a class="global-account-menu-item" role="menuitem" href="/profile">My Profile</a>',
    '<button class="global-account-menu-item" role="menuitem" type="button" disabled>Modify Profile</button>',
    '<button class="global-account-menu-item" role="menuitem" type="button" data-account-action="logout">Logout</button>',
    "</div>",
  ].join("");
}

function closeAccountMenu(root: HTMLElement): void {
  const menu = root.querySelector<HTMLElement>(".global-account-menu");
  if (menu) menu.hidden = true;
  root.querySelector(".global-account-trigger")?.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu(root: HTMLElement): void {
  const menu = root.querySelector<HTMLElement>(".global-account-menu");
  const trigger = root.querySelector(".global-account-trigger");
  if (!menu || !trigger) return;
  const open = menu.hidden;
  menu.hidden = !open;
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
}

function bindAccountInteractions(root: HTMLElement): void {
  if (root.getAttribute("data-account-bound") === "true") return;
  root.setAttribute("data-account-bound", "true");

  root.addEventListener("click", (event) => {
    const actionNode = event.target instanceof Element ? event.target.closest("[data-account-action]") : null;
    if (!actionNode || !root.contains(actionNode)) return;
    const action = actionNode.getAttribute("data-account-action");
    if (action === "toggle") {
      event.preventDefault();
      toggleAccountMenu(root);
    } else if (action === "logout") {
      event.preventDefault();
      void fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then((response) => {
          if (!response.ok) throw new Error("Logout failed.");
          if (pageSlug() === "profile") window.location.reload();
          else renderLoggedOut(root, true);
        })
        .catch(() => {
          // The session may still exist: stay signed in and let the user try again.
          actionNode.textContent = "Logout failed, try again";
        });
    }
  });
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) closeAccountMenu(root);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAccountMenu(root);
  });
}

/** Local development marks the sample data so nobody mistakes it for the live site. */
function showFixtureNotice(): void {
  let notice = document.getElementById("dev-data-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "dev-data-notice";
    document.body.appendChild(notice);
  }
  notice.setAttribute("role", "status");
  notice.style.cssText =
    "position:fixed;bottom:12px;left:12px;right:12px;z-index:2147483647;padding:8px 36px 8px 12px;background:#fff2bd;color:#252015;font:14px system-ui;border:1px solid #796421;border-radius:6px;text-align:center";
  notice.textContent = "Local development: synthetic sample data. Discord login is simulated.";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss local development notice");
  close.style.cssText =
    "position:absolute;right:8px;top:4px;background:transparent;color:inherit;border:0;font:24px system-ui;cursor:pointer";
  const shown = notice;
  close.addEventListener("click", () => {
    shown.remove();
  });
  notice.appendChild(close);
}

function initAccount(root: HTMLElement | null): void {
  if (!root) return;
  bindAccountInteractions(root);
  fetch("/api/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error("Auth status failed.");
      if (response.headers.get("X-Data-Source") === "fixtures") showFixtureNotice();
      return response.json() as Promise<{
        authenticated?: boolean;
        user?: DiscordUser;
        login_available?: boolean;
      } | null>;
    })
    .then((payload) => {
      if (payload?.authenticated) renderLoggedIn(root, payload.user ?? {});
      else renderLoggedOut(root, payload?.login_available === true);
    })
    .catch(() => {
      renderLoggedOut(root, false);
    });
}

function initContentTabs(root: HTMLElement | null): void {
  if (!root) return;
  const shell = root.querySelector<HTMLElement>(".global-tabs-shell");
  const list = root.querySelector<HTMLElement>(".global-tabs-list");
  if (!shell || !list) return;
  initTabsGroup({ shell, tabsRoot: list, tabSelector: ".global-tab", activeSelector: ".global-tab.is-active" });
}

/** Centres the active second-level link when the strip overflows on narrow screens. */
function syncSubNav(): void {
  const container = document.querySelector<HTMLElement>(".sub-nav");
  if (!container) return;
  const hasOverflow = container.scrollWidth > container.clientWidth + 2;
  container.classList.toggle("is-overflowing", hasOverflow);
  if (!hasOverflow) {
    container.scrollLeft = 0;
    return;
  }
  const narrow =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 760px)").matches
      : window.innerWidth <= 760;
  if (!narrow) return;
  const active = container.querySelector('.sub-link.is-active, .sub-link[aria-current="page"]');
  if (!active) return;
  window.requestAnimationFrame(() => {
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const left =
      container.scrollLeft + (activeRect.left - containerRect.left) - (container.clientWidth - activeRect.width) / 2;
    container.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  });
}

export function initNavigation(): void {
  let resizeTimer: number | undefined;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      syncSubNav();
    }, 100);
  });

  if (redirectLegacyUrl(pageSlug())) return;

  const navRoot = document.getElementById("global-nav");
  const subNavRoot = document.getElementById("global-subnav");
  const contentTabsRoot = document.getElementById("global-content-tabs");
  initContentTabs(contentTabsRoot);
  initAccount(document.getElementById("global-account"));
  syncSubNav();
  bindLinkPrefetch(navRoot);
  bindLinkPrefetch(subNavRoot);
  bindLinkPrefetch(contentTabsRoot);
  scheduleInitialPrefetch();
}
