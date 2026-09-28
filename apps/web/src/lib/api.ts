// JSON requests to the site's own API (same origin). Concurrent requests for the same URL share one
// response.

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
