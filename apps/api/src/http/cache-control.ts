// Cache-Control values of the API. Public lists are shared by all visitors; personal and
// clock-bearing responses are never stored.
export const PUBLIC_DATA_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";
export const NO_STORE = "no-store";
export const IMMUTABLE_ASSET = "public, max-age=2592000, immutable";
