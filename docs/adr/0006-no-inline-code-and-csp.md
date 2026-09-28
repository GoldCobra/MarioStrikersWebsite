# 0006: No inline code; an enforced Content Security Policy

Status: accepted (2026-09-28)

## Context

Pages and scripts used inline `onerror`/`onclick` handlers, which make a
Content Security Policy impossible. The site sent no CSP, Permissions-Policy
or Cross-Origin-Opener-Policy.

## Decision

Markup carries no inline scripts or event handlers. An image declares its
fallback (`data-fallback-src`, `data-on-error`) and one listener in
`apps/web/src/lib/image-fallbacks.ts` handles it; the Gear Builder host turns
the snapshot's `onclick` attributes into listeners. nginx sends the CSP,
Permissions-Policy and COOP with every document from
`infra/nginx/snippets/document-headers.conf`; Caddy keeps HSTS and the other
transport headers. The policy was first sent report-only and enforced after
a crawl of the live site found no violation.

## Consequences

- An injected script cannot run, even if some text were ever rendered
  unescaped.
- `npm run check:frontend` rejects inline handlers and scripts, and the CSP
  check opens every page and flow under the policy.
- A new third-party embed needs a policy change, checked the same way.
