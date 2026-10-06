// Behaviour of the navigation the layout renders into every page: the login (the account button once
// signed in), the page tabs, centring of overflowing navigation, link prefetching and redirects of old
// ?tabs= and ?submenu= links.

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

/** The member's Discord avatar; Discord's default one ((id >> 22) % 6) when they have set none. */
function discordAvatarUrl(user: DiscordUser): string {
  const id = (user.id ?? "").trim();
  const avatar = (user.avatar ?? "").trim();
  if (!/^\d{15,20}$/.test(id)) return "";
  if (!avatar) return `https://cdn.discordapp.com/embed/avatars/${String((BigInt(id) >> 22n) % 6n)}.png`;
  return `https://cdn.discordapp.com/avatars/${id}/${encodeURIComponent(avatar)}.png?size=128`;
}

/** A further menu entry the account carries (/api/auth/me account_links), e.g. a page only some members have. */
interface AccountLink {
  readonly label?: string;
  readonly href?: string;
}

/** A path on this site, or "" for anything else (another site, a protocol-relative or a script URL). */
function sameSiteHref(href: unknown): string {
  const value = typeof href === "string" ? href.trim() : "";
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "";
}

interface Account {
  /** The login button as the page has it (a link to the Discord login). */
  readonly link: HTMLAnchorElement;
  readonly button: HTMLButtonElement;
  readonly menu: HTMLElement;
}

// The header clips whatever overflows it, so the open menu is placed in the viewport, under its button.
function placeAccountMenu({ button, menu }: Account): void {
  const box = button.getBoundingClientRect();
  menu.style.top = `${Math.round(box.bottom + 6)}px`;
  menu.style.right = `${Math.max(0, Math.round(document.documentElement.clientWidth - box.right))}px`;
}

function setMenuOpen(account: Account, open: boolean): void {
  if (open) placeAccountMenu(account);
  account.menu.hidden = !open;
  account.button.setAttribute("aria-expanded", open ? "true" : "false");
}

function logout(account: Account, item: Element): void {
  void fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  })
    .then((response) => {
      if (!response.ok) throw new Error("Logout failed.");
      if (pageSlug() === "profile") {
        window.location.reload();
        return;
      }
      account.menu.remove();
      account.button.replaceWith(account.link);
    })
    .catch(() => {
      // The session may still exist: stay signed in and let the user try again.
      item.textContent = "Logout failed, try again";
    });
}

/**
 * Signed in, the login button becomes the account button: the member's avatar covers the login figure,
 * and a click opens the menu (My Profile, the account's own links, Logout). The menu lives in <body>, as
 * the navigation's transform would hold a fixed menu inside the header, which clips it. It is built once,
 * with every entry, before it can be opened, so no entry appears later.
 */
function showSignedIn(link: HTMLAnchorElement, user: DiscordUser, links: readonly AccountLink[]): void {
  const name = (user.global_name || user.username || "your account").trim();
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${link.className} is-signed-in`;
  button.dataset.topKey = "login";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", `Account of ${name}`);
  const art = document.createElement("span");
  art.className = "nav-top-art";
  const icon = link.querySelector(".nav-top-icon");
  if (icon) art.append(icon.cloneNode(true));
  const avatarUrl = discordAvatarUrl(user);
  if (avatarUrl) {
    art.insertAdjacentHTML(
      "beforeend",
      `<img class="nav-top-avatar" src="${escapeHtml(avatarUrl)}" alt="" referrerpolicy="no-referrer" data-on-error="hide">`,
    );
  }
  button.append(art);

  const menu = document.createElement("div");
  menu.className = "global-account-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = [
    '<a class="global-account-menu-item" role="menuitem" href="/profile">My Profile</a>',
    ...links.flatMap(({ label, href }) => {
      const path = sameSiteHref(href);
      const text = typeof label === "string" ? label.trim() : "";
      return path && text
        ? [`<a class="global-account-menu-item" role="menuitem" href="${escapeHtml(path)}">${escapeHtml(text)}</a>`]
        : [];
    }),
    '<button class="global-account-menu-item" role="menuitem" type="button" data-account-action="logout">Logout</button>',
  ].join("");
  link.replaceWith(button);
  document.body.append(menu);

  const account: Account = { link, button, menu };
  button.addEventListener("click", () => {
    setMenuOpen(account, menu.hidden !== false);
  });
  menu.addEventListener("click", (event) => {
    const item = event.target instanceof Element ? event.target.closest("[data-account-action='logout']") : null;
    if (item) logout(account, item);
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Node ? event.target : null;
    if (!menu.hidden && target && !button.contains(target) && !menu.contains(target)) setMenuOpen(account, false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.hidden) return;
    setMenuOpen(account, false);
    button.focus();
  });
  // The placed menu would stay behind while the page moves.
  window.addEventListener(
    "scroll",
    () => {
      if (!menu.hidden) setMenuOpen(account, false);
    },
    { passive: true },
  );
  window.addEventListener("resize", () => {
    if (!menu.hidden) placeAccountMenu(account);
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

/** The login button (site-shell.ts) stays a link to the Discord login unless the visitor is signed in. */
function initAccount(link: HTMLAnchorElement | null): void {
  if (!link) return;
  fetch("/api/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error("Auth status failed.");
      if (response.headers.get("X-Data-Source") === "fixtures") showFixtureNotice();
      return response.json() as Promise<{
        authenticated?: boolean;
        user?: DiscordUser;
        account_links?: unknown;
      } | null>;
    })
    .then((payload) => {
      if (!payload?.authenticated) return;
      const links: AccountLink[] = Array.isArray(payload.account_links)
        ? payload.account_links.filter(
            (entry: unknown): entry is AccountLink => typeof entry === "object" && entry !== null,
          )
        : [];
      showSignedIn(link, payload.user ?? {}, links);
    })
    .catch(() => {
      // The login link stays.
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
  initAccount(document.querySelector<HTMLAnchorElement>("a.nav-top-login"));
  syncSubNav();
  bindLinkPrefetch(navRoot);
  bindLinkPrefetch(subNavRoot);
  bindLinkPrefetch(contentTabsRoot);
  scheduleInitialPrefetch();
}
