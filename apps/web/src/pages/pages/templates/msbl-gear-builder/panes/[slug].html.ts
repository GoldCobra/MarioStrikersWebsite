// The Gear Builder's character panes, rendered from src/content/gear-builder/ at build time and loaded by
// the host when a character tab is first chosen.

import type { APIRoute, GetStaticPaths } from "astro";
import { GEAR_CHARACTERS, type GearCharacter } from "../../../../../content/gear-builder/characters.ts";
import { renderPane } from "../../../../../content/gear-builder/pane.ts";

export const getStaticPaths = (() =>
  GEAR_CHARACTERS.map((character) => ({
    params: { slug: character.slug },
    props: { character },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ character: GearCharacter }> = ({ props }) =>
  new Response(renderPane(props.character), { headers: { "Content-Type": "text/html; charset=utf-8" } });
