// Serves a built site exactly as production nginx routes it and forwards /api to the API, including the
// admin page's gate (/_/, docs/adr/0011). Used for local previews and by the comparison checks; never exposed
// publicly.

import { createReadStream, readFileSync, statSync } from "node:fs";
import {
  createServer,
  get as httpGet,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join } from "node:path";
import { REPO_ROOT } from "./processes.ts";
import { createStaticFiles } from "@ms/shared/site/node-static-files";
import { resolveRoute } from "@ms/shared/site/routes";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};

const NOT_FOUND_FILE = "/404.html";

/** Where nginx keeps the admin page (infra/nginx/frontend.conf): asked of the API's gate, never public. */
const ADMIN_PAGE_PREFIX = "/_/";
const ADMIN_GATE_PATH = "/internal/admin-gate";

/** The private file nginx's rewrites map an admin page path to: /_/<token>/<rest> → admin/<rest>. */
export function privatePageFile(pathname: string): string | null {
  const match = /^\/_\/[^/]+\/(.*)$/.exec(pathname);
  if (!match) return null;
  const rest = match[1] ?? "";
  if (rest.split("/").some((part) => part === ".." || part === ".")) return null;
  return `admin/${rest || "index.html"}`;
}

/** The security headers production nginx sends with every document (infra/nginx/snippets). */
export function documentHeaders(): Record<string, string> {
  const snippet = readFileSync(join(REPO_ROOT, "infra/nginx/snippets/document-headers.conf"), "utf8");
  const headers: Record<string, string> = {};
  for (const [, name, value] of snippet.matchAll(/^add_header ([\w-]+) "([^"]*)" always;$/gm)) {
    if (name && value !== undefined) headers[name] = value;
  }
  return headers;
}

export interface SiteServerOptions {
  /** Directory of the built site. */
  readonly root: string;
  /** Origin of the API that /api requests are forwarded to, e.g. "http://127.0.0.1:8788". */
  readonly apiOrigin: string;
  /** The private pages (default: dist-private next to the site), served only when the API's gate allows. */
  readonly privateRoot?: string;
}

/** The API's admin gate answer for this request (nginx's auth_request): true only for a 2xx. */
function askAdminGate(request: IncomingMessage, apiOrigin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const gate = httpGet(
      new URL(ADMIN_GATE_PATH, apiOrigin),
      { headers: { cookie: request.headers.cookie ?? "", "x-original-uri": request.url ?? "" } },
      (answer) => {
        answer.resume();
        resolve((answer.statusCode ?? 500) >= 200 && (answer.statusCode ?? 500) < 300);
      },
    );
    gate.on("error", () => {
      resolve(false);
    });
  });
}

function sendStatus(response: ServerResponse, status: number): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end(status === 404 ? "Not found." : status === 403 ? "Forbidden." : "Method not allowed.");
}

function forwardToApi(request: IncomingMessage, response: ServerResponse, apiOrigin: string): void {
  const target = new URL(request.url ?? "/", apiOrigin);
  const upstream = httpRequest(
    target,
    // Like nginx, the API sees the site's host, which its same-site checks compare with the Origin.
    { method: request.method, headers: request.headers },
    (apiResponse) => {
      response.writeHead(apiResponse.statusCode ?? 502, apiResponse.headers);
      apiResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) sendStatus(response, 502);
    response.end();
  });
  request.pipe(upstream);
}

export function createSiteServer(options: SiteServerOptions): Server {
  const files = createStaticFiles(options.root);
  const privateRoot = options.privateRoot ?? join(dirname(options.root), "dist-private");
  const security = documentHeaders();

  function sendNotFoundPage(request: IncomingMessage, response: ServerResponse): void {
    // Like nginx's error_page: the site's own not-found page, when the build has one.
    if (files.isFile(NOT_FOUND_FILE)) {
      response.writeHead(404, { "Content-Type": CONTENT_TYPES[".html"], "Cache-Control": "no-store", ...security });
      if (request.method === "HEAD") response.end();
      else createReadStream(join(options.root, NOT_FOUND_FILE)).pipe(response);
      return;
    }
    sendStatus(response, 404);
  }

  /** nginx's location /_/: anything but a yes from the gate, or a missing file, is the ordinary not-found page. */
  async function servePrivatePage(request: IncomingMessage, response: ServerResponse, pathname: string) {
    const file = privatePageFile(pathname);
    const allowed = await askAdminGate(request, options.apiOrigin);
    const full = file ? join(privateRoot, file) : "";
    if (!allowed || !full || !statSync(full, { throwIfNoEntry: false })?.isFile()) {
      sendNotFoundPage(request, response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendStatus(response, 405);
      return;
    }
    const extension = extname(full).toLowerCase();
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...security,
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(full).pipe(response);
  }

  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      forwardToApi(request, response, options.apiOrigin);
      return;
    }
    if (url.pathname.startsWith(ADMIN_PAGE_PREFIX)) {
      void servePrivatePage(request, response, url.pathname);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendStatus(response, 405);
      return;
    }
    const route = resolveRoute(url.pathname, url.search, files);
    switch (route.kind) {
      case "redirect":
        response.writeHead(301, { Location: route.location, "Cache-Control": "no-store" });
        response.end();
        return;
      case "forbidden":
        sendStatus(response, 403);
        return;
      case "not-found":
        sendNotFoundPage(request, response);
        return;
      case "file": {
        const extension = extname(route.path).toLowerCase();
        const type = CONTENT_TYPES[extension] ?? "application/octet-stream";
        response.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "no-store",
          ...(extension === ".html" ? security : {}),
        });
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(join(options.root, decodeURIComponent(route.path))).pipe(response);
      }
    }
  });
}
