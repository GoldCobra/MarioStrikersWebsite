# 0005: Browser code as bundled TypeScript modules

Status: accepted (2026-09-28)

## Context

The browser code was 24 separate scripts sharing functions through `window`,
with helpers such as HTML escaping copied up to nine times. Every change
needed a hand-edited `?v=` cache tag in several files; a forgotten tag once
broke the navigation.

## Decision

Browser code lives in `apps/web/src/features/<name>/` and `src/lib/`, with one
entry per page type in `src/entries/`. Vite bundles it with content-hashed
file names. Logic that works on data (the save editor cores, the season clock,
the rating cards) is kept free of DOM code so Node tests run it directly.
Modules set no globals. The third-party Gear Builder snapshot stays
byte-identical under `public/assets/gear-builder/`; a module hosts it, and its
character panes are rendered from typed data.

## Consequences

- Nothing to bump: a changed file gets a new URL, an unchanged one stays
  cached for a year.
- Shared helpers exist once (`@ms/shared/html`, `src/lib/popup.ts`, ...).
- Only the Gear Builder snapshot keeps `?v=` tags; the popup templates are
  bundled with their code.
