# 0011: A hidden admin page behind the Discord admin role

Status: accepted (2026-10-06)

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

- **Roles.** The login already asks for `guilds.members.read`; it now keeps the
  member's role ids and marks the session (`adm: true`, signed) when one of
  `ADMIN_ROLE_IDS` was among them. Only those sessions are ever checked further:
  the API asks Discord with the bot token (`GET /guilds/{guild}/members/{user}`,
  cached `ADMIN_ROLE_CACHE_TTL_MS`, default 60 s; changes skip the cache) and
  allows only a member who holds the role now. A session older than
  `ADMIN_SESSION_MAX_AGE_MS` (default 12 h) or an unanswered Discord request
  means no. Everything is off unless `ADMIN_ENABLED` is set and complete.
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
- **Audit**: `dbo.WebsiteAdminAudit` (`npm run ops:admin-audit`) records the
  page's opening once per session and day and, later, every admin action, with
  the address, kept 180 days; never a token, cookie or the page's path.

## Consequences

- A role removed on Discord closes the page within the cache time (60 s), a
  change at once. A member who gets the role must log in once more.
- Members without the claim never cause a Discord request, so the site's
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
