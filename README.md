# Mario Strikers Community Website

Community guides, rankings and tools for Mario Strikers Battle League (MSBL),
Mario Strikers Charged (MSC) and Super Mario Strikers (SMS).

**Website:** [mariostrikers.gg](https://mariostrikers.gg)

**Repository:** [GoldCobra/MarioStrikersWebsite](https://github.com/GoldCobra/MarioStrikersWebsite)

**Development branch:** `gc-updates`

## What is here

- Setup guides, competitive rules, tier lists and community events.
- Live rankings, players, Striker Clubs and Discord-backed profiles.
- MSBL Gear Builder and save editor.
- MSC save and online friendlist editors.

Save tools read and export files locally in the browser. They do not upload saves.

## Quick start

Install **Node.js 24 LTS**, including npm, and Git. The same commands work in
PowerShell, macOS and Linux terminals:

```sh
git clone --branch gc-updates https://github.com/GoldCobra/MarioStrikersWebsite.git
cd MarioStrikersWebsite/backend
npm ci
npm run dev
```

Open **http://localhost:8787**. This serves the website and API with synthetic
sample data; no database, Discord account, Docker or `.env` file is required.
The local login flow is simulated and does not authenticate with Discord.
Stop the server with Ctrl+C. Backend changes restart it; reload the browser
after frontend changes.

Optional Docker development, from the repository root:

```sh
docker compose up --build
```

Open **http://localhost:8080**. Docker also uses sample data. Stop it with
`docker compose down`. See [development details](docs/development.md) for
live service configuration and troubleshooting.

## Checks

Run these commands from `backend/` before opening a pull request:

```sh
npm run check
npm run check:frontend
npm test
npm run test:smoke
git diff --check
```

The checks and smoke tests use local fixtures and require no production secrets.
For visual changes, also check the affected page on desktop and mobile.

## Project layout

| Location | Purpose |
| --- | --- |
| `index.html`, `pages/` | Page shells and shared HTML fragments |
| `css/`, `js/` | Shared styles and browser behavior |
| `assets/` | Runtime images, fonts and embedded Gear Builder |
| `backend/` | Express API, service integrations, fixtures and tests |
| `docs/` | Development notes, tool formats and design sources |

The frontend uses plain HTML, CSS and JavaScript. Express serves clean page
URLs during local development. Production uses Caddy, Nginx and Express;
MSSQL provides community data, with local caches for public data and club logos.

## Contributing and releases

Create a short feature branch from `gc-updates` and open a pull request back
to it. **GoldCobra reviews and merges changes.** Merging does not deploy the site.

- [Contribution workflow](CONTRIBUTING.md)
- [Architecture and API](docs/architecture.md)
- [Save tools and formats](docs/save-tools.md)
- [Deployment and rollback](docs/deployment.md)
- [Gear Builder maintenance](docs/msbl-gear-builder-snapshot.md)

## Credits

- MSC Setup Guide: `@ImSpiker` ([source guide](https://docs.google.com/document/d/1a49tGOAVqi5mW9RqfZF3QanELxw8Ogsq4NQ068B8Zco/edit?tab=t.0)).
- SMS Setup Guide: `@Randomepicdude`.
- MSBL Gear Builder: `@wo0k`.
