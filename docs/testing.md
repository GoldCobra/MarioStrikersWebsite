# Testing

## Unit and smoke tests

Run the [README checks](../README.md#checks) from `backend/`. They use fixtures
and need no production secrets.

## Comparison checks

`tests/e2e/` holds checks that compare the site with a reference commit, so
refactoring can prove that pages look and behave exactly as before. They run in
the CI `containers` job and locally on Windows, macOS and Linux:

```sh
cd tests/e2e
npm ci
npx playwright install chromium
npm run visual      # screenshots: reference commit vs working tree
npm run dom         # rendered markup and head vs committed goldens
npm run contract    # every API response: reference commit vs working tree
npm run routes      # status and Location of all URL shapes vs golden (needs ROUTES_URL)
```

- **Reference commit.** `tests/e2e/visual-reference.sha` holds a full commit
  SHA, or `self` to compare the working tree with itself (proves the checks are
  deterministic). `run.ts` exports the reference into `tests/e2e/.cache/` and
  starts it the way that commit describes in its own `tests/e2e/stack.json`.
- **Deterministic data.** Both stacks run the invented fixtures with
  `MSC_FIXTURE_NOW` pinned; the browser clock is frozen to the same moment and
  all third-party requests are blocked.
- **Visual.** 42 pages at 320, 390, 768, 1024, 1280 and 1440 px (first screen
  and full length), plus popups, login, error and Gear Builder states. No pixel
  may move; colour deltas up to 2/255 are software raster noise and ignored.
- **Goldens.** `tests/e2e/golden/` is committed: `dom/` and `head/` per page,
  `routes.json` recorded against production nginx. Update them only for an
  intended change (`npm run dom:update`, `npm run routes:update`) and review the
  diff in the pull request.
- **Intended API changes** are listed in `tests/e2e/specs/contract.deltas.ts`.

Screenshots and reports stay in the ignored `tests/e2e/.cache/`; CI uploads the
report when a check fails.
