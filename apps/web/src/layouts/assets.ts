// Stylesheets some pages load after the global one, each with its cache tag in one place. Bump a tag when
// the file's content changes; every page that loads the file picks the new URL up.

export const STYLESHEETS = {
  gearBuilder: "/assets/gear-builder/styles.css?v=20260428-cleanup-v1",
  gearBuilderHost: "/assets/gear-builder/host.css?v=20260527-shadow-layer-v1",
} as const;

export type StylesheetName = keyof typeof STYLESHEETS;
