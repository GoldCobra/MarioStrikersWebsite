// The legacy browser scripts and stylesheets pages load, each with its cache tag in one place. Bump a tag
// when the file's content changes; every page that loads the file picks the new URL up.

export const SCRIPTS = {
  countryDisplayNames: "/js/country-display-names.js?v=20260601-flag-tooltips-v1",
  competitiveRulesConfig: "/js/competitive-rules-config.js?v=20260428-cleanup-v1",
  competitiveRulesEngine: "/js/competitive-rules-engine.js?v=20260428-cleanup-v1",
  eventsEngine: "/js/events-engine.js?v=20260609-events-list-v17",
  flagUtils: "/js/flag-utils.js?v=20260621-flag-utils-v1",
  gearBuilderHost: "/js/msbl-gear-builder-host.js?v=20260508-lazy-v1",
  landingCountdown: "/js/landing-countdown.js?v=20260902-season-visuals-v1",
  leaderboardsConfig: "/js/leaderboards-config.js?v=20260925-whr-tabs-v1",
  leaderboardsEngine: "/js/leaderboards-engine.js?v=20260609-clickable-lb-profiles-v1",
  msblSaveEditorContract: "/js/msbl-save-editor-contract.js?v=20260501-msbl-gear-preset-v1",
  msblClubsEngine: "/js/msbl-clubs-engine.js?v=20260913-popup-resilience-v1",
  msblSaveEditor: "/js/msbl-save-editor.js?v=20260501-msbl-gear-preset-v1",
  mscOnlineEditor: "/js/msc-online-editor.js?v=20260429-delete-codes-v1",
  mscSaveEditor: "/js/msc-save-editor.js?v=20260501-export-applies-v1",
  mscSaveEditorContract: "/js/msc-save-editor-contract.js?v=20260428-cleanup-v1",
  mscWiimmfi: "/js/msc-wiimmfi.js?v=20260502-wiimmfi-v1",
  playersEngine: "/js/players-engine.js?v=20260925-rating-layout-v1",
  profilePage: "/js/profile-page.js?v=20260925-rating-layout-v1",
  publicDataPreload: "/js/public-data-preload.js?v=20260531-fix-v1",
  ratingCards: "/js/rating-cards.js?v=20260926-rank-name-v1",
  runtimeConfig: "/js/runtime-config.js?v=20260428-cleanup-v1",
  tabPlaceholder: "/js/tab-placeholder.js?v=20260428-cleanup-v1",
} as const;

export type ScriptName = keyof typeof SCRIPTS;

/** Stylesheets some pages load after the global one (src/styles). */
export const STYLESHEETS = {
  gearBuilder: "/assets/gear-builder/styles.css?v=20260428-cleanup-v1",
  gearBuilderHost: "/assets/gear-builder/host.css?v=20260527-shadow-layer-v1",
} as const;

export type StylesheetName = keyof typeof STYLESHEETS;
