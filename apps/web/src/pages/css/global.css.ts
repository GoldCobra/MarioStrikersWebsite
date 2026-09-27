// Transition: the former unhashed stylesheet URL, for HTML cached before the hashed name was introduced.
// Remove it one release after the release that introduced global.<hash>.css.

import type { APIRoute } from "astro";
import { GLOBAL_CSS } from "../../styles/global.ts";

export const GET: APIRoute = () => new Response(GLOBAL_CSS, { headers: { "Content-Type": "text/css; charset=utf-8" } });
