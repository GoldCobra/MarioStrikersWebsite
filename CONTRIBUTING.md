# Contributing

Use [GoldCobra/MarioStrikersWebsite](https://github.com/GoldCobra/MarioStrikersWebsite).
The shared development branch is `gc-updates`; older `main` and `master`
branches are not contribution targets.

## Start a change

Follow the [README quick start](README.md#quick-start). Use local sample data
for everyday development; access to production systems is unnecessary.

From a clean working tree at the repository root:

```sh
git switch gc-updates
git pull --ff-only origin gc-updates
git switch -c feature/short-description
```

Use `fix/short-description` for a bug fix and `docs/short-description` for
documentation. In GitHub Desktop, choose `gc-updates`, pull, then create a branch.
Agree on the task before editing shared navigation, global CSS or the same PSD.

## Make the change

- Keep one purpose per pull request and preserve the surrounding code style.
- Fit the change into the existing structure: put it where things of its kind
  already live ([where things live](README.md#where-things-live)) and reuse the
  layout, page families, feature modules, the template popup
  (`apps/web/src/lib/popup.ts`) and the shared helpers instead of copying them.
  Something without a place yet gets one deliberately, named like its
  neighbours and noted in [architecture](docs/architecture.md); the
  [architecture decisions](docs/adr/README.md) explain the current shape.
- Keep browser links canonical, for example `/msc-save-editor`.
- Global styles live in `apps/web/src/styles/`, one partial per component;
  their order in `global.ts` is the cascade. Stylesheet and module URLs change
  by themselves.
- Add meaningful coverage for changed behavior. Fixtures belong in
  `apps/api/src/fixtures/data-source.ts`; use invented data, never production exports.
- Update the relevant short document when setup, behavior or operations change.
- Give every page image its real `width` and `height` and a descriptive `alt`
  (`alt=""` for decoration); `npm run check:frontend` enforces both.
- Keep design sources in `docs/source-assets/` and exported runtime files in
  `assets/`. Coordinate binary edits; avoid unrelated asset conversions.
- A changed image, font or Gear Builder file keeps its URL, and browsers cache it:
  bump its `?v=` cache tag where it is referenced (Gear Builder files in
  `apps/web/src/layouts/assets.ts` and `gear-builder-host.ts`) or give it a new name, then
  renew `apps/web/assets.lock.json` with `node tools/src/assets-lock.ts --write`.
  `npm run check` fails until then.
- Keep credentials, personal saves, database exports and local caches out of Git.

## Common changes

**A new page**

1. Add it to `packages/shared/src/site/pages.ts`: title (the full game name
   and at most 60 characters), description (120 to 160 characters), hidden
   heading and robots.
2. Place it in `navigation.ts` if it needs a menu entry or tab.
3. Create `apps/web/src/pages/pages/<slug>.astro` with `SiteLayout` or a page
   family from `src/components/pages/`.
4. Record its markup golden: `node tests/e2e/run.ts dom --update`.

Renaming or removing a page keeps its old URL working: add it to
`packages/shared/src/site/legacy-routes.ts` and run `npm run generate:nginx`.

**Page text**

- Competitive rules: `apps/web/src/content/competitive-rules/rules.ts`.
- Tier lists: `apps/web/src/content/tier-lists.ts` holds the tiers as text next
  to the image; update both, and bump the image's cache tag as described above.
- Other pages: their file in `apps/web/src/pages/pages/`.

**Behavior in the browser**

- Put the code in `apps/web/src/features/<name>/` and load it from the page's
  entry in `src/entries/` through the layout's `scripts` slot.
- Keep data logic free of DOM code, so a Node test can cover it.
- Write no inline `on...=` handlers or `<script>` blocks: the Content Security
  Policy blocks them. Declare image fallbacks with `data-fallback-src` or
  `data-on-error`.

**An API response**

- Use snake_case keys; convert from the service's camelCase at the route.
- Cover the change in the module's tests. When the shape changes on purpose,
  record it in `tests/e2e/specs/contract.deltas.ts` and update the browser
  code in the same pull request.

**A player title**

- A title of a known kind is data: add it to `apps/api/src/modules/titles/catalog.ts`
  (a stable code, the name in FULL CAPS, its rule) and run
  `npm run ops:player-titles --workspace=@ms/api`, or insert the row into
  `dbo.PlayerTitle` directly. A new Free Title is at once available to every player.
- A new kind of rule goes into `modules/titles/rules.ts` with its tests. See what
  it would award with `npm run ops:title-sync --workspace=@ms/api` before
  writing it with `-- --apply` ([ADR 0008](docs/adr/0008-player-titles.md)).

**An intended visual change**

- List the affected screenshots with the reason in
  `tests/e2e/approved-changes.json` against the current
  `visual-reference.sha` (see [testing](docs/testing.md)).

## Check and submit

Run from the repository root:

```sh
npm run check
npm run build
npm run check:frontend   # checks the built site
npm test
npm run test:smoke
git diff --check
```

For UI work, check desktop and mobile layouts, affected navigation and browser
console errors. Refactoring must keep the [comparison checks](docs/testing.md)
green; an intended visual or markup change updates the goldens in the same PR.
For editor work, also verify file length, validation and export behavior
described in [save tools](docs/save-tools.md).

Review `git diff`, stage only intended files, commit and publish your branch:

```sh
git add <changed-files>
git commit -m "Describe the resulting behavior"
git push -u origin feature/short-description
```

Open a pull request with **base repository `GoldCobra/MarioStrikersWebsite`**
and **base branch `gc-updates`**, including when contributing from a fork.
Explain the change, list checks
run and attach screenshots for visible changes. GitHub Desktop's Publish Branch
and Create Pull Request buttons provide the same workflow.

If the base branch advances, update your feature branch without rewriting its
published history:

```sh
git fetch origin
git merge origin/gc-updates
```

Resolve conflicts in the feature branch, rerun relevant checks and push.
Ask GoldCobra to help with conflicts involving shared assets or unfamiliar code.

## Review and release

GoldCobra owns review, **squash merging** and production releases. Contributors
push feature branches and respond to feedback; they do not push directly to
`gc-updates`, merge pull requests or deploy.

A pull request is ready when its checks pass and feedback is resolved. Once it
is merged, delete the feature branch and start the next change from updated
`gc-updates`. Each release deploys an explicitly chosen commit through the
[owner's deployment procedure](docs/deployment.md); a merge alone does not
change the live website.

GoldCobra uses the owner integration ruleset's PR-only bypass when merging.
This also permits owner-authored PRs without self-approval; the separate quality
rules still require passing CI. See [GitHub maintenance](docs/github-maintenance.md)
for the owner setup.

Production credentials and hosting access stay with the owner. If a task needs
a live integration, agree on access and test data separately using the
[development guide](docs/development.md#live-integrations).
