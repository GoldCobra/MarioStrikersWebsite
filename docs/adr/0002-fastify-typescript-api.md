# 0002: Fastify API in TypeScript without a build step

Status: accepted (2026-09-27)

## Context

The Express API kept almost everything in one 600-line file. It derived HTTP
status codes from error texts (a database error could reach the client),
had no timeouts on outgoing requests, no rate limits on uncached routes and a
login state that was not bound to the browser.

## Decision

The API is a Fastify 5 application in TypeScript under `apps/api/src/`, one
module per domain (routes, service, repository with the SQL, mappers). Node 24
runs the sources directly (type stripping); `tsc` only checks types. A
`DataSource` interface serves both the live database and the invented
fixtures, so every test and local run uses the production code paths. Errors
are typed and answer `{ error, code }` without internals. Responses use
snake_case keys; code inside the API uses camelCase.

## Consequences

- No build artifacts to deploy or keep in sync; the image runs `src/main.ts`.
- The SQL stayed byte-identical during the move (checked by SQL text
  snapshots), so the data returned did not change.
- Only erasable TypeScript syntax may be used (no enums, parameter properties
  or namespaces), which `erasableSyntaxOnly` enforces.
