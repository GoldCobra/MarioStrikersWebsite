// The admin page (docs/adr/0011): loads GET /api/admin/overview and shows it. The page itself is only ever
// served to an admin, but the access can end while it is open (role removed, admin session over): the API
// then answers 404 like for any unknown path, and the page offers a fresh login that returns here.

import { escapeHtml } from "@ms/shared/html";
import { loginPath } from "@ms/shared/site/navigation";
import { adminOverviewHtml, type AdminOverviewResponse } from "./admin-overview.ts";

const OVERVIEW_URL = "/api/admin/overview";

function statePanel(title: string, message: string, action: string): string {
  return [
    '<section class="profile-state-panel">',
    `<h2 class="profile-state-title">${escapeHtml(title)}</h2>`,
    `<p class="profile-state-message">${escapeHtml(message)}</p>`,
    `<p class="profile-state-actions">${action}</p>`,
    "</section>",
  ].join("");
}

async function load(root: HTMLElement, content: HTMLElement): Promise<void> {
  root.setAttribute("aria-busy", "true");
  content.innerHTML = '<p class="profile-loading">Loading the admin overview...</p>';
  try {
    const response = await fetch(OVERVIEW_URL, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) {
      const here = window.location.pathname;
      content.innerHTML = statePanel(
        "Admin access ended",
        "Your admin access has ended: the admin role was removed or this login is too old for the admin page.",
        `<a class="profile-action-button" href="${escapeHtml(loginPath(here))}">Log in again</a>`,
      );
      return;
    }
    if (!response.ok) throw new Error(`Admin overview failed with HTTP ${String(response.status)}.`);
    content.innerHTML = adminOverviewHtml((await response.json()) as AdminOverviewResponse);
  } catch {
    content.innerHTML = statePanel(
      "Admin overview unavailable",
      "The admin overview could not be loaded.",
      '<button class="profile-action-button" type="button" data-admin-action="retry">Try again</button>',
    );
  } finally {
    root.setAttribute("aria-busy", "false");
  }
}

export function initAdminPage(root: HTMLElement): void {
  const content = root.querySelector<HTMLElement>("[data-admin-content]") ?? root;
  root.addEventListener("click", (event) => {
    const retry = event.target instanceof Element ? event.target.closest("[data-admin-action='retry']") : null;
    if (retry) void load(root, content);
  });
  void load(root, content);
}
