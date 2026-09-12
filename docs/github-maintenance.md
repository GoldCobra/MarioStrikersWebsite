# GitHub maintenance

Owner: **GoldCobra**. Canonical repository:
[GoldCobra/MarioStrikersWebsite](https://github.com/GoldCobra/MarioStrikersWebsite).

These are repository settings to apply on GitHub; committing configuration
files alone does not activate rules or send invitations.

## One-time setup

1. Set the default branch to `gc-updates`. Retain `main` and `master` as
   historical references; their histories must not be merged into this branch.
2. Set the About description to:
   "Community website for Mario Strikers: guides, live rankings, clubs,
   profiles, events and browser-based save tools."
   Set the website link to `https://mariostrikers.gg`.
3. Enable squash merging and automatic deletion of merged feature branches.
   Disable merge commits and rebase merging for pull requests.
4. After the CI workflow has run successfully, import the three repository
   rulesets from [`.github/rulesets/`](../.github/rulesets):
   `quality.json`, `owner-integration.json` and `historical-branches.json`.
5. Invite the colleague as a collaborator who can push feature branches.
   Keep administration and production hosting access with GoldCobra.
6. Send the colleague the [README](../README.md) and
   [contribution workflow](../CONTRIBUTING.md). Start with a small UI or docs PR.

## How the rules work

The quality rules require a pull request, resolved review threads, an up-to-date
branch and successful CI. They have no bypass actor. The owner integration
rules restrict `gc-updates` updates and request the code owner's review;
the repository admin can bypass these integration rules only through a PR.

GoldCobra therefore uses the owner integration bypass when merging reviewed
PRs. Owner-authored PRs use the same path without requiring self-approval.
The separate quality rules still enforce CI. Historical branches reject
updates, deletion and force pushes.

`CODEOWNERS` requests GoldCobra's review. It does not grant permissions or
enforce branch protection by itself. Keep the admin role restricted to the
owner because the integration bypass is assigned to that role.

## Confirm the setup

Use a small feature branch to verify that CI starts on a PR to `gc-updates`,
the owner is requested for review, the colleague cannot update the integration
branch directly, and GoldCobra can squash merge only after required checks
succeed. Confirm that a merge does not trigger deployment.

If workflow job names change, update the required checks in the quality
ruleset and deployment verifier together. Release operations are described
in [deployment](deployment.md).
