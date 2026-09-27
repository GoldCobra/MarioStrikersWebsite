# Testing

## Unit and smoke tests

Run the [README checks](../README.md#checks) from the repository root. They use
fixtures and need no production secrets. `npm run check` also type-checks,
lints and format-checks the TypeScript code.

## Comparison checks

`tests/e2e/` holds checks that compare the site with a reference commit, so
refactoring can prove that pages look and behave exactly as before. They run in
the CI `containers` job and locally on Windows, macOS and Linux:

```sh
npm ci
npx playwright install chromium
npm run test:visual     # screenshots: reference commit vs working tree
npm run test:dom        # rendered markup and head vs committed goldens
npm run test:contract   # every API response: reference commit vs working tree
node tests/e2e/run.ts routes   # status and Location of all URL shapes (needs ROUTES_URL)
```

- **Reference commit.** `tests/e2e/visual-reference.sha` holds a full commit
  SHA, or `self` to compare the working tree with itself (proves the checks are
  deterministic). `run.ts` exports the reference into `tests/e2e/.cache/` and
  starts it the way that commit describes in its own `tests/e2e/stack.json`.
  The working tree runs as the production build (`npm run build`) behind
  `tools/src/fixture-stack.ts`, which routes exactly like nginx.
- **Deterministic data.** Both stacks run the invented fixtures with
  `MSC_FIXTURE_NOW` pinned. Pages run on a virtual clock: timers and animation
  frames fire only when a check advances time in fixed steps, so countdowns and
  debounced layout code render the same moment every run. Third-party requests
  are blocked.
- **Visual.** 42 pages at 320, 390, 768, 1024, 1280 and 1440 px (first screen
  and full length), plus popups, login, error and Gear Builder states. No pixel
  may move; colour deltas up to 2/255 are software raster noise and ignored.
- **Goldens.** `tests/e2e/golden/` is committed: `dom/` and `head/` per page,
  `routes.json` recorded against production nginx. Update them only for an
  intended change (`node tests/e2e/run.ts dom --update`, `... routes --update`)
  and review the diff in the pull request.
- **Intended API changes** are listed in `tests/e2e/specs/contract.deltas.ts`.

Screenshots and reports stay in the ignored `tests/e2e/.cache/`; CI uploads the
report when a check fails.

## Live API comparison

Fixtures cannot show whether an API rewrite reads the real database the same
way. The database only accepts the production server, so the comparison uses
the public API: record production just before the release, then compare the
released API with that recording:

```sh
node tools/src/api-diff.ts record https://mariostrikers.gg before.json --pace=700
# release
node tools/src/api-diff.ts compare before.json https://mariostrikers.gg --pace=700
```

It requests every endpoint variant, every player profile and every club profile
and logo, and prints the JSON paths that differ. `--pace` sends one request at
a time and keeps production below its rate limits. Two running APIs can also be
compared directly (`compare <origin> <origin>`); differences are then retried
once, because live data may change in between.
