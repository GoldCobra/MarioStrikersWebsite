// JSON requests to the site's own API (same origin). Concurrent requests for the same URL share one
// response, so a page can start loading its data early and its engine picks the result up.

const inFlight = new Map<string, Promise<unknown>>();

export function fetchJson<T = unknown>(url: string): Promise<T> {
  const existing = inFlight.get(url);
  if (existing) return existing as Promise<T>;
  const request = fetch(url, { headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error(`Request failed: ${url}`);
      return response.json() as Promise<T>;
    })
    .finally(() => {
      inFlight.delete(url);
    });
  inFlight.set(url, request);
  return request;
}

/** The public dataset each data page shows first. */
const PAGE_DATA: Readonly<Record<string, string>> = {
  players: "/api/players",
  "msbl-striker-clubs": "/api/clubs/msbl",
  "msbl-elo1v1": "/api/leaderboards/msbl/elo1v1?limit=100&offset=0",
  "msbl-elo2v2": "/api/leaderboards/msbl/elo2v2?limit=100&offset=0",
  "msbl-whr": "/api/leaderboards/msbl/whr?limit=100&offset=0",
  "msc-elo1v1": "/api/leaderboards/msc/elo1v1?limit=100&offset=0",
  "msc-whr": "/api/leaderboards/msc/whr?limit=100&offset=0",
  "sms-elo1v1": "/api/leaderboards/sms/elo1v1?limit=100&offset=0",
  "sms-whr": "/api/leaderboards/sms/whr?limit=100&offset=0",
};

/** Starts loading the current page's dataset before its engine asks for it. */
export function preloadPageData(): void {
  const page = (document.body.getAttribute("data-page") ?? "").trim().toLowerCase();
  const url = Object.hasOwn(PAGE_DATA, page) ? PAGE_DATA[page] : undefined;
  if (url) fetchJson(url).catch(() => null);
}

/** The page's slug from <body data-page>. */
export function currentPage(): string {
  return (document.body.getAttribute("data-page") ?? "").toLowerCase();
}
