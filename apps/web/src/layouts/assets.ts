// The legacy browser scripts and stylesheets pages load, each with its cache tag in one place. Bump a tag
// when the file's content changes; every page that loads the file picks the new URL up.

export const SCRIPTS = {
  gearBuilderHost: "/js/msbl-gear-builder-host.js?v=20260508-lazy-v1",
  msblSaveEditorContract: "/js/msbl-save-editor-contract.js?v=20260501-msbl-gear-preset-v1",
  msblSaveEditor: "/js/msbl-save-editor.js?v=20260501-msbl-gear-preset-v1",
  mscOnlineEditor: "/js/msc-online-editor.js?v=20260429-delete-codes-v1",
  mscSaveEditor: "/js/msc-save-editor.js?v=20260501-export-applies-v1",
  mscSaveEditorContract: "/js/msc-save-editor-contract.js?v=20260428-cleanup-v1",
} as const;

export type ScriptName = keyof typeof SCRIPTS;

/** Stylesheets some pages load after the global one (src/styles). */
export const STYLESHEETS = {
  gearBuilder: "/assets/gear-builder/styles.css?v=20260428-cleanup-v1",
  gearBuilderHost: "/assets/gear-builder/host.css?v=20260527-shadow-layer-v1",
} as const;

export type StylesheetName = keyof typeof STYLESHEETS;
