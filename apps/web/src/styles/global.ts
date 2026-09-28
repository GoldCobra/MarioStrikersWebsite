// The global stylesheet: the partials in this folder, concatenated in the order below. The order is the
// cascade: later rules win over earlier ones of the same specificity, so keep a new rule in the partial
// of its component and never move rules between partials without checking the pages it touches.
// The media blocks in tablet.css and mobile.css override the components before them.
//
// It is delivered as one file named by its content hash, so browsers may cache it forever.

import { createHash } from "node:crypto";
import { transform } from "lightningcss";
import base from "./base.css?raw";
import clubPopup from "./club-popup.css?raw";
import clubs from "./clubs.css?raw";
import competitiveRules from "./competitive-rules.css?raw";
import contentBox from "./content-box.css?raw";
import events from "./events.css?raw";
import footer from "./footer.css?raw";
import landing from "./landing.css?raw";
import leaderboards from "./leaderboards.css?raw";
import mobile from "./mobile.css?raw";
import msl from "./msl.css?raw";
import navigation from "./navigation.css?raw";
import partners from "./partners.css?raw";
import playerPopup from "./player-popup.css?raw";
import players from "./players.css?raw";
import popups from "./popups.css?raw";
import profile from "./profile.css?raw";
import ratingCards from "./rating-cards.css?raw";
import saveEditorControls from "./save-editor-controls.css?raw";
import saveEditors from "./save-editors.css?raw";
import setupGuides from "./setup-guides.css?raw";
import tabPlaceholder from "./tab-placeholder.css?raw";
import tablet from "./tablet.css?raw";
import tabs from "./tabs.css?raw";
import tierLists from "./tier-lists.css?raw";
import typography from "./typography.css?raw";
import wiimmfi from "./wiimmfi.css?raw";

export const GLOBAL_CSS = [
  base,
  navigation,
  tabs,
  landing,
  leaderboards,
  events,
  competitiveRules,
  contentBox,
  partners,
  setupGuides,
  msl,
  saveEditors,
  clubs,
  players,
  profile,
  tierLists,
  popups,
  playerPopup,
  ratingCards,
  clubPopup,
  tabPlaceholder,
  tablet,
  typography,
  saveEditorControls,
  footer,
  mobile,
  wiimmfi,
].join("");

/**
 * What browsers get: the same rules in the same order without comments and whitespace, and with
 * declarations that a later one in the same rule overrides dropped. Invalid CSS fails the build.
 */
export const GLOBAL_CSS_MINIFIED = transform({
  filename: "global.css",
  code: Buffer.from(GLOBAL_CSS),
  minify: true,
}).code.toString();

export const GLOBAL_CSS_HASH = createHash("sha256").update(GLOBAL_CSS_MINIFIED).digest("hex").slice(0, 12);

/** In /css/, so the relative url(../assets/...) references resolve to /assets/. */
export const GLOBAL_CSS_PATH = `/css/global.${GLOBAL_CSS_HASH}.css`;
