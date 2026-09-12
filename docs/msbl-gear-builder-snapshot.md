# MSBL Gear Builder Snapshot

Source: `https://msbl.pages.dev/`

## Runtime location

- Assets: `assets/gear-builder/`
- Template: `pages/templates/msbl-gear-builder.html`
- Host page: `pages/msbl-gear-builder.html`
- Host bootstrap: `js/msbl-gear-builder-host.js`
- Original full-page snapshot archive: `docs/archive/gear-builder/index-original.html`

## Manual re-import steps

1. Download the `https://msbl.pages.dev/` snapshot into a temporary comparison
   directory first. Review the difference before updating `assets/gear-builder/`:
   - `styles.css`
   - `scripts/*`
   - `images/*`
   - `fonts/*`
   - `builds.json` (temporary source only; do not keep the monolith file in the repo after splitting)
2. Regenerate `pages/templates/msbl-gear-builder.html` from the source HTML section:
   - keep only the `<section class="section">...</section>` block
   - rewrite `src="images/..."` and `href="images/..."` to `../assets/gear-builder/images/...`
3. Preserve and review local changes when integrating upstream files:
   - explicit event params instead of implicit global `event`
   - checklist assignment bug fix (`===`)
   - remove debug-only logs
   - split `builds.json` into per-character chunk files under `assets/gear-builder/builds/`
   - `builder.js` lazy-loads character chunks via `new URL("../builds/<character>.json", import.meta.url)`
   - preset drafts in `sessionStorage` and XML exports used by the MSBL Save Editor
   - host navigation/tab integration, lazy screenshot loading and PNG/WebP fallbacks
4. Remove the temporary monolith artifact after chunk generation:
   - delete `assets/gear-builder/builds.json`
5. Run syntax checks:
   - `npm --prefix backend run check:frontend`
   - verify character selection, presets, screenshots and XML import into the Save Editor in a browser
6. Bump changed browser asset cache tags, including dynamically loaded scripts.

## Notes

- This integration is a local snapshot (no auto-sync).
- Public route: `/msbl-gear-builder`; implementation file: `pages/msbl-gear-builder.html`.
- Record the imported source/date and retain attribution when updating the snapshot.
