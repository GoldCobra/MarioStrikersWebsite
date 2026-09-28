# MSBL Gear Builder Snapshot

Source: `https://msbl.pages.dev/`

## Runtime location

Paths are relative to the web root `apps/web/public/` unless they start with `docs/`.

- Assets: `assets/gear-builder/`
- Template: `pages/templates/msbl-gear-builder.html`
- Character panes: generated at build time from `apps/web/src/content/gear-builder/`
  (`characters.ts` holds the base stats and speed with the ball, `pane.ts` the markup)
  and served at `/pages/templates/msbl-gear-builder/panes/<character>.html`
- Host page: `apps/web/src/pages/pages/msbl-gear-builder.astro`
- Host bootstrap: `apps/web/src/features/gear-builder/gear-builder-host.ts`
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
   - move the 16 character panes out of it: update `characters.ts` when stats changed and
     `pane.ts` when the pane markup changed (its ids and classes are what the scripts use);
     `pane.test.ts` pins the current output, so update `pane.golden.json` with the change
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
   - `npm run check:frontend`
   - verify character selection, presets, screenshots and XML import into the Save Editor in a browser
6. Bump changed browser asset cache tags, including dynamically loaded scripts.

## Notes

- This integration is a local snapshot (no auto-sync).
- Public route: `/msbl-gear-builder`; implementation file: `apps/web/src/pages/pages/msbl-gear-builder.astro`.
- `scripts/sliders.js` paints its sliders from `window.onload`; the host runs that handler once
  after loading the scripts, because the page has already loaded by then.
- Record the imported source/date and retain attribution when updating the snapshot.
