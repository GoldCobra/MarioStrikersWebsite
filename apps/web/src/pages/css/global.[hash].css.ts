// The global stylesheet under its content-hashed name (see src/styles/global.ts).

import type { APIRoute, GetStaticPaths } from "astro";
import { GLOBAL_CSS_HASH, GLOBAL_CSS_MINIFIED } from "../../styles/global.ts";

export const getStaticPaths = (() => [{ params: { hash: GLOBAL_CSS_HASH } }]) satisfies GetStaticPaths;

export const GET: APIRoute = () =>
  new Response(GLOBAL_CSS_MINIFIED, { headers: { "Content-Type": "text/css; charset=utf-8" } });
