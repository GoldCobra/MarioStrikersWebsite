# 0013: Club logo uploads are decoded and re-encoded with sharp

Status: accepted (2026-11-19)

## Context

Clubs used to give their logo as a link, which the API downloads and caches
(`logo-cache.ts`). My Club replaces the link with an upload (PNG, JPG or WebP,
at most 2 MB, 256–2048 px per side), stored at the highest sensible quality:
the largest display is 330 px, the club list shows 100 px. An upload is
untrusted input. Its declared type can be wrong, a small file can decode into a
huge image, it can be animated, and it can carry metadata such as a camera's
GPS position. Node has no image decoder of its own, and the API container runs
on Alpine (musl).

## Decision

- **sharp** (libvips) is a runtime dependency of the API. Its prebuilt binaries
  for every platform the project runs on (Windows, the Ubuntu CI runners, the
  Alpine container) are optional packages pinned in `package-lock.json`; the
  image needs no compiler and no install script.
- **Nothing of the upload is passed through** (`modules/clubs/logo-upload.ts`).
  The byte limit comes first, then the type from the file's first bytes (GIF,
  SVG and anything else are refused, whatever the request says), which must be
  what the decoder reads. The header gives the dimensions and the frames
  (animations are refused) before a pixel is decoded, and decoding runs under a
  pixel limit of 2048 × 2048.
- The image is turned by its EXIF orientation, fitted into 512 × 512 (aspect
  ratio kept, never enlarged) and encoded as WebP with the site's own image
  settings: quality 98, the alpha channel lossless, every piece of metadata
  dropped.
- The result goes into `dbo.ClubLogo` with its SHA-256 (ADR 0012). The public
  logo route serves an uploaded logo before a link logo, under a URL with the
  hash (`?v=`) and immutable caching (a URL naming another version
  revalidates). Which clubs have one comes from a small index, read once a
  minute and after every change (`uploaded-logos.ts`), so link logos never wait
  for the database. `dbo.Club.Logo` gets the logo's URL, so the bot shows the
  same logo.
- `PUT /api/my-club/logo` takes the raw image as the request body
  (`image/png`, `image/jpeg` or `image/webp`) with a 2 MB limit on this route
  only; every other route keeps its 16 KB limit.

## Consequences

- A native dependency: sharp's updates carry libvips's security fixes, so they
  are taken like the base images' (Dependabot proposes them). An update that
  changes the decoder options needs the upload tests to pass unchanged.
- The API image grows by the musl binaries of sharp and libvips.
- Uploaded logos are part of the nightly database backup; nothing is written
  to disk. Link logos keep coming from `logo-cache.ts` until a club uploads one.
