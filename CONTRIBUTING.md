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
- Use existing navigation, tabs, popup styles and config/engine patterns.
- Keep browser links canonical, for example `/msc-save-editor`.
- Bump relevant `?v=...` tags wherever changed browser scripts or styles
  are loaded, including dynamically loaded scripts.
- Add meaningful coverage for changed behavior. Fixtures belong in
  `backend/src/dev/fixtures.js`; use invented data, never production exports.
- Update the relevant short document when setup, behavior or operations change.
- Keep design sources in `docs/source-assets/` and exported runtime files in
  `assets/`. Coordinate binary edits; avoid unrelated asset conversions.
- Keep credentials, personal saves, database exports and local caches out of Git.

## Check and submit

Run from `backend/`:

```sh
npm run check
npm run check:frontend
npm test
npm run test:smoke
git diff --check
```

For UI work, check desktop and mobile layouts, affected navigation and browser
console errors. For editor work, also verify file length, validation and export
behavior described in [save tools](docs/save-tools.md).

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
