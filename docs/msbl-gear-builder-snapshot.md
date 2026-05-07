# MSBL Gear Builder Snapshot

Source: `https://msbl.pages.dev/`

## Runtime location
- Assets: `assets/gear-builder/`
- Template: `pages/templates/msbl-gear-builder.html`
- Host page: `pages/msbl-gear-builder.html`
- Host bootstrap: `js/msbl-gear-builder-host.js`
- Original full-page snapshot archive: `docs/archive/gear-builder/index-original.html`

## Manual re-import steps
1. Download latest `https://msbl.pages.dev/` snapshot into `assets/gear-builder/`:
   - `styles.css`
   - `scripts/*`
   - `images/*`
   - `fonts/*`
   - `builds.json` (temporary source only; do not keep the monolith file in the repo after splitting)
2. Regenerate `pages/templates/msbl-gear-builder.html` from the source HTML section:
   - keep only the `<section class="section">...</section>` block
   - rewrite `src="images/..."` and `href="images/..."` to `../assets/gear-builder/images/...`
3. Re-apply local safe patches in scripts:
   - explicit event params instead of implicit global `event`
   - checklist assignment bug fix (`===`)
   - remove debug-only logs
   - split `builds.json` into per-character chunk files under `assets/gear-builder/builds/`
   - `builder.js` lazy-loads character chunks via `new URL("../builds/<character>.json", import.meta.url)`
4. Remove the temporary monolith artifact after chunk generation:
   - delete `assets/gear-builder/builds.json`
5. Run syntax checks:
   - `node --check` for all `assets/gear-builder/scripts/*.js`
   - `node --check js/msbl-gear-builder-host.js`

## Notes
- This integration is a local snapshot (no auto-sync).
- Route remains `pages/msbl-gear-builder.html` via existing `global-nav` slug `msbl-gear-builder`.
