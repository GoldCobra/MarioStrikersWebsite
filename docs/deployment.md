# Deployment and rollback

Production runs Caddy for HTTPS, Nginx for the frontend and Express for the API
using `docker-compose.prod.yml`. FlareSolverr is an additional service. Database
and Discord credentials, along with runtime cache volumes, remain on the server.

**GoldCobra releases an explicitly selected commit.** Pull requests, CI and
merges never deploy automatically. Use the commands below on the production
server from the repository root; they require Python 3.12+, Git and Docker Compose v2.

## First-time adoption

After the collaboration setup is merged, update the existing server checkout on
`gc-updates` with `git pull --ff-only origin gc-updates`. The working tree must
be clean. Keep the existing `backend/.env`, Caddy configuration and Docker
volumes; do not copy secrets into Git.

Confirm the existing Compose project name using `docker compose ls`.
The script defaults to `mario-strikers-website`. If the existing project name
differs, use `--project EXISTING_PROJECT` before the subcommand on **every**
invocation. The script validates container project labels.

Record the currently running application images before the first release:

```sh
python3 scripts/deploy.py bootstrap
python3 scripts/deploy.py list
```

Bootstrap tags the running backend/frontend images and saves the current
repository's production Compose configuration without restarting containers. It records a
`bootstrap-YYYYMMDDTHHMMSSZ` release for rollback. It refuses to replace an
existing release record.

The ignored `.deploy/` directory stores release manifests, Compose snapshots
and the current-release pointer. Preserve it and the retained image tags.
Do not prune these images while they are needed for rollback.

## Release a reviewed commit

1. Review and squash merge the PR into `gc-updates`.
2. Wait for the **push CI run on the resulting commit** to pass. PR checks alone
   do not certify the final squash commit.
3. Copy its full 40-character SHA and run:

```sh
python3 scripts/deploy.py deploy FULL_40_CHARACTER_COMMIT_SHA
```

The script fetches `origin/gc-updates` and requires the requested SHA to be
that branch's current head. The local checkout must be clean, on `gc-updates`
and an ancestor of the requested commit. It builds from `git archive` of the
requested SHA, verifies the source again, then fast-forwards the clean checkout
to that commit before activation.

CI verification uses GitHub's API and requires successful jobs named
`backend (ubuntu-latest)`, `backend (windows-latest)`, `frontend`,
`containers` and `deployment` in the latest matching push run of `ci.yml`.
An optional server environment `GITHUB_TOKEN` can avoid anonymous API limits;
the public repository does not otherwise require it for verification.

Application images are tagged by commit and carry the revision label. Activation
updates only backend and frontend with the saved image tags; it does not restart
Caddy/FlareSolverr, migrate the database or remove volumes.

Health checks cover Nginx configuration, internal application responses and
public `/` plus `/api/health`. The health response must confirm the live MSSQL
source. A failed activation attempts to restore the previous recorded release;
inspect the output and server logs if either activation or recovery fails.

## Roll back

List retained releases, then select a recorded SHA or bootstrap release ID:

```sh
python3 scripts/deploy.py list
python3 scripts/deploy.py rollback RECORDED_RELEASE_ID
```

Rollback reuses recorded images and Compose configuration without rebuilding,
fetching Git or contacting GitHub. It reruns health checks. It restores the
application version only; database contents, credentials and sidecar
configuration are managed separately. The checkout stays at the latest source
commit; `.deploy/current` records the application release actually running.

The health-check origin defaults to `https://mariostrikers.gg`; override it with
`--public-url` only when intentionally testing a different deployment. Global options precede
the command, for example `python3 scripts/deploy.py --project EXISTING_PROJECT list`.

Changes to Caddy, FlareSolverr, credentials or database schema need a separate
owner-reviewed operations change. Keep this procedure, the CI job names and
the [GitHub rulesets](github-maintenance.md) aligned.
