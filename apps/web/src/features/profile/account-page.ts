// What the account's pages (My Profile, My Club) share: whether the visitor is signed in, and the panels they show
// instead of their content (signed out, a login that came back with ?auth=<result>, errors) with their buttons.

import { escapeHtml } from "@ms/shared/html";
import { loginPath } from "@ms/shared/site/navigation";

export const DISCORD_LINK =
  '<a class="profile-action-button" href="https://discord.gg/de2YaWg" target="_blank" rel="noopener noreferrer">Open Discord</a>';
export const RETRY_BUTTON =
  '<button class="profile-action-button" type="button" data-profile-action="retry">Try again</button>';

/** The login, returning to `returnTo` (an account page's path). */
export function loginLink(returnTo: string): string {
  return `<a class="profile-action-button" href="${loginPath(returnTo)}">Login with Discord</a>`;
}

export function stateActions(...buttons: string[]): string {
  return `<p class="profile-state-actions">${buttons.join(" ")}</p>`;
}

export function statePanel(title: string, message: string, actionHtml = ""): string {
  return [
    '<section class="profile-state-panel">',
    `<h2 class="profile-state-title">${escapeHtml(title)}</h2>`,
    `<p class="profile-state-message">${escapeHtml(message)}</p>`,
    actionHtml,
    "</section>",
  ].join("");
}

/** The result of the login flow, which returns with ?auth=<result>. */
export function authResult(): string {
  return new URLSearchParams(window.location.search).get("auth") ?? "";
}

/** Signed out, or what the login that just came back says; `message` names what logging in opens. */
export function loginRequiredHtml(returnTo: string, message: string): string {
  const login = loginLink(returnTo);
  switch (authResult()) {
    case "not_member":
      return statePanel(
        "Discord Server Required",
        "Only members of the Mario Strikers Discord server can log in. Join the server, then log in again.",
        stateActions(DISCORD_LINK, login),
      );
    case "failed":
      return statePanel("Login Failed", "The Discord login did not complete. Please try again.", stateActions(login));
    case "unavailable":
      return statePanel("Login Unavailable", "Login with Discord is not available right now. Please try again later.");
    default:
      return statePanel("Login Required", message, stateActions(login));
  }
}

/**
 * Whether the visitor is signed in (null when that is unknown). Asked first, so a visitor who is not
 * signed in gets no refused requests (each one is an error in the browser's console).
 */
export async function signedIn(): Promise<boolean | null> {
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as { authenticated?: unknown } | null;
    return response.ok ? body?.authenticated === true : null;
  } catch {
    return null;
  }
}

/** The login flow returns with ?auth=<result>; the address bar drops it (and `extra` keys) once the page shows. */
export function removeAuthQuery(extra: readonly string[] = []): void {
  if (!window.location.search) return;
  const params = new URLSearchParams(window.location.search);
  const keys = ["auth", ...extra];
  if (!keys.some((key) => params.has(key))) return;
  for (const key of keys) params.delete(key);
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
}
