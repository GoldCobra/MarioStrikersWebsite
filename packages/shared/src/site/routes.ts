// URL routing of the public site as one pure function. It mirrors infra/nginx/frontend.conf rule by rule
// (nginx checks exact locations, then regex locations in file order, then the "/" prefix), so the
// local servers and the route checks behave exactly like production.

import { LEGACY_REDIRECTS, LEGACY_SUBMENU_ROUTES, RETIRED_PATHS } from "./legacy-routes.ts";

/** Read-only view of the built site, with paths relative to its root ("/assets/x.png"). */
export interface StaticFiles {
  isFile(path: string): boolean;
  isDirectory(path: string): boolean;
}

export type Route =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not-found" };

// Static asset types that nginx serves with long cache lifetimes; never rewritten to pages.
const STATIC_EXTENSION = /\.(?:css|js|mjs|woff|woff2|png|jpg|jpeg|gif|webp|avif|svg|ico|json)$/i;
const LEGACY_PAGE_FILE = /^\/pages\/([a-z0-9-]+)\.html$/;
const PAGE_WITH_TRAILING_SLASH = /^\/([a-z0-9-]+)\/$/;
const CLEAN_PAGE = /^\/([a-z0-9-]+)\/?$/;
const NOT_FOUND: Route = { kind: "not-found" };

/** Where a page's HTML lives in the built site. */
export function pageFile(slug: string): string {
  return slug === "index" ? "/index.html" : `/pages/${slug}.html`;
}

// Own keys only, so paths like "/constructor" never match Object.prototype members.
function lookup<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function fileOrMissing(path: string, files: StaticFiles): Route {
  return files.isFile(path) ? { kind: "file", path } : NOT_FOUND;
}

// nginx's $arg_<name>: the raw (not URL-decoded) value of the first parameter with that name.
function rawQueryParameter(query: string, name: string): string | undefined {
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const key = separator === -1 ? pair : pair.slice(0, separator);
    if (key.toLowerCase() === name) return separator === -1 ? "" : pair.slice(separator + 1);
  }
  return undefined;
}

/**
 * Resolves a request path and raw query string ("" or "?a=b") to what the web server answers.
 * Redirects are permanent (301) and keep the query string, as nginx's `$is_args$args` does.
 */
export function resolveRoute(pathname: string, search: string, files: StaticFiles): Route {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const withQuery = (path: string): Route => ({ kind: "redirect", location: query ? `${path}?${query}` : path });

  // Exact locations.
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return fileOrMissing(pathname, files);
  if (pathname === "/index.html") return withQuery("/");
  if (pathname === "/404.html") return NOT_FOUND;
  if (pathname === "/") return fileOrMissing(pageFile("index"), files);
  const legacyTarget = lookup(LEGACY_REDIRECTS, pathname);
  if (legacyTarget) return withQuery(`/${legacyTarget}`);
  if (RETIRED_PATHS.includes(pathname)) return NOT_FOUND;
  const section = pathname.slice(1);
  const submenuRoutes = lookup(LEGACY_SUBMENU_ROUTES, section);
  if (submenuRoutes) {
    const submenu = rawQueryParameter(query, "submenu");
    const target = submenu === undefined ? undefined : lookup(submenuRoutes, submenu);
    return target ? withQuery(`/${target}`) : fileOrMissing(pageFile(section), files);
  }

  // Regex locations, in configuration order.
  if (STATIC_EXTENSION.test(pathname)) return fileOrMissing(pathname, files);
  const legacyPage = LEGACY_PAGE_FILE.exec(pathname);
  if (legacyPage?.[1]) return withQuery(`/${legacyPage[1]}`);
  const slashed = PAGE_WITH_TRAILING_SLASH.exec(pathname);
  if (slashed?.[1] && files.isFile(pageFile(slashed[1]))) return withQuery(`/${slashed[1]}`);

  // location / { try_files $uri $uri/ @clean_pages; }
  if (files.isFile(pathname)) return { kind: "file", path: pathname };
  if (files.isDirectory(pathname)) {
    const index = `${pathname.replace(/\/$/, "")}/index.html`;
    return files.isFile(index) ? { kind: "file", path: index } : { kind: "forbidden" };
  }
  const clean = CLEAN_PAGE.exec(pathname);
  return clean?.[1] ? fileOrMissing(pageFile(clean[1]), files) : NOT_FOUND;
}
