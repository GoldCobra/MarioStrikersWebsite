# MSBL Gear Builder Snapshot

Source: `https://msbl.pages.dev/`

## Runtime location
- Assets: `assets/gear-builder/`
- Template: `pages/templates/msbl-gear-builder.html`
- Host page: `pages/msbl.html`
- Host bootstrap: `js/msbl-gear-builder-host.js`
- Original full-page snapshot archive: `docs/archive/gear-builder/index-original.html`

## Manual re-import steps
1. Download latest `https://msbl.pages.dev/` snapshot into `assets/gear-builder/`:
   - `styles.css`
   - `scripts/*`
   - `images/*`
   - `fonts/*`
   - `builds.json`
2. Regenerate `pages/templates/msbl-gear-builder.html` from the source HTML section:
   - keep only the `<section class="section">...</section>` block
   - rewrite `src="images/..."` and `href="images/..."` to `../assets/gear-builder/images/...`
3. Re-apply local safe patches in scripts:
   - explicit event params instead of implicit global `event`
   - checklist assignment bug fix (`===`)
   - remove debug-only logs
   - `builder.js` loads builds via `new URL("../builds.json", import.meta.url)`
4. Run syntax checks:
   - `node --check` for all `assets/gear-builder/scripts/*.js`
   - `node --check js/msbl-gear-builder-host.js`

## Notes
- This integration is a local snapshot (no auto-sync).
- Route remains `pages/msbl.html` via existing `global-nav` slug `msbl`.
