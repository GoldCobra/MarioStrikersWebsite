# 0011: A hidden admin page behind the Discord admin role

Status: accepted (2026-10-06), amended 2026-11-23 (no time limit, no marked login)

## Context

The site needs a page for administrators of the community Discord server. It
must open only for signed-in members who hold a configured admin role on the
server at that moment, and for everyone else it must not exist: no menu entry,
no link, no index entry, no answer that differs from an unknown URL. The
repository is public, so hiding the code is not possible; the protection has to
lie in the server. Sessions are stateless signed cookies valid for 7 days, and
the login keeps no Discord access token, so the login alone cannot tell
whether a role was taken away since.

## Decision

- **Roles.** Who holds one of `ADMIN_ROLE_IDS` at all comes from the server's
  member list, which the API reads in the background every five minutes
  (`integrations/discord/guild-members.ts`). Only those members are checked
  further: the API asks Discord with the bot token
  (`GET /guilds/{guild}/members/{user}`, cached `ADMIN_ROLE_CACHE_TTL_MS`,
  default 60 s; changes skip the cache) and allows only a member who holds the
  role now. Access lasts as long as the login; an unanswered Discord request
  means no. Everything is off unless `ADMIN_ENABLED` is set and complete.
  (Until 2026-11-23 the login marked the session and access ended 12 hours
  after it, so admins had to log in again; both are gone.)
- **One guard** (`apps/api/src/modules/admin/guard.ts`) answers for the page,
  its API and the account menu. Its API routes sit in one Fastify plugin under
  `/api/admin` whose first hook is the guard; a refusal is the API's standard
  404, byte for byte, and no rate limit header shows before it.
- **The page** is an Astro page built like the others, then moved with the
  modules only it uses from `dist/` to `dist-private/admin/`
  (`apps/web/integrations/private-pages.ts`), outside nginx's web root. nginx
  serves it under `/_/<ADMIN_PATH_TOKEN>/` only after `auth_request` to the API's
  internal gate (`/internal/admin-gate`, not reachable from outside); every other
  answer, an unreachable API included, is the ordinary not-found page.
- **The menu** renders whatever links `/api/auth/me` carries (`account_links`);
  only a confirmed admin's answer has one. The public bundle holds no admin
  text, path or code.
- **Audit**: `dbo.WebsiteAdminAudit` (created once by `ops:admin-audit`, since removed) records the
  page's opening once per session and day and, later, every admin action, with
  the address, kept 180 days; never a token, cookie or the page's path.

## Consequences

- A role removed on Discord closes the page within the cache time (60 s), a
  change at once; a role given opens it with the member list's next read
  (within five minutes), without logging in again.
- Members the member list shows without an admin role never cause a Discord
  request, so the site's
  behaviour and timing for them stay as they were; requests below `/_/` take
  one extra hop to the API, which only shows that `/_/` is guarded (as the
  public code does anyway).
- The secret path keeps noise away but protects nothing by itself; a leaked
  link still shows strangers the not-found page. Rotating it means a new
  `ADMIN_PATH_TOKEN` and a recreated backend; `ADMIN_ENABLED=false` switches
  everything off.
- The 404 page is no longer cached (`no-store`), so a member who opened the
  address before signing in is not shown the stored not-found page afterwards.
- A new admin route is a route in `modules/admin/routes.ts`; a change there
  asks Discord without the cache and must write an audit row.
