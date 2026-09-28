# 0004: Comparison checks against a reference commit

Status: accepted (2026-09-27)

## Context

The refactor rewrote every page, script and API route while the site had to
look and behave exactly as before. Unit tests alone could not show that a
page still rendered pixel for pixel or that a save editor still exported the
same bytes.

## Decision

`tests/e2e/` compares the working tree with the commit in
`tests/e2e/visual-reference.sha`, both running the same invented fixtures on
a virtual clock:

- screenshots of all pages at six widths and of interactive states, with no
  pixel allowed to move;
- committed goldens of the rendered markup and head of every page;
- every API response variant;
- the save editors driven through fixed flows, comparing status lines, markup
  and exported bytes;
- every page and flow under the Content Security Policy.

An intended difference is recorded next to the check: goldens are updated in
the same pull request, API differences are normalized in
`contract.deltas.ts`, and visual changes are approved per reference commit in
`approved-changes.json`.

## Consequences

- A change either proves it changes nothing, or states exactly what it
  changes and why.
- The checks need a built site and a browser; they run in the CI `containers`
  job and locally on Windows, macOS and Linux.
