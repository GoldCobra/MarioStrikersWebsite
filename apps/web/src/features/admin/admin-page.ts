// The admin page (docs/adr/0011): loads GET /api/admin/overview and shows it, then the club moderation (club
// management plan B2, admin-clubs.ts: GET /api/admin/clubs and its actions). The page itself is only ever served to
// an admin, but the access can end while it is open (role removed, admin session over): the API then answers 404
// like for any unknown path, and the page offers a fresh login that returns here.

import { escapeHtml } from "@ms/shared/html";
import { loginPath } from "@ms/shared/site/navigation";
import { adminClubListHtml, adminClubsHtml, type AdminClubsResponse, type AdminClubsView } from "./admin-clubs.ts";
import { adminOverviewHtml, type AdminOverviewResponse } from "./admin-overview.ts";

const OVERVIEW_URL = "/api/admin/overview";
const CLUBS_URL = "/api/admin/clubs";

function statePanel(title: string, message: string, action: string): string {
  return [
    '<section class="profile-state-panel">',
    `<h2 class="profile-state-title">${escapeHtml(title)}</h2>`,
    `<p class="profile-state-message">${escapeHtml(message)}</p>`,
    `<p class="profile-state-actions">${action}</p>`,
    "</section>",
  ].join("");
}

function accessEndedHtml(): string {
  const here = window.location.pathname;
  return statePanel(
    "Admin access ended",
    "Your admin access has ended: the admin role was removed or this login is too old for the admin page.",
    `<a class="profile-action-button" href="${escapeHtml(loginPath(here))}">Log in again</a>`,
  );
}

async function adminRequest(
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

/** The club moderation under the overview: the list, its search, one open form and the actions. */
function initClubs(root: HTMLElement, mount: HTMLElement): void {
  let response: AdminClubsResponse | null = null;
  let view: AdminClubsView = { query: "", form: null };
  let busy = false;

  const status = (text: string): void => {
    const line = mount.querySelector<HTMLElement>("[data-admin-club-status]");
    if (line) line.textContent = text;
  };
  const drawList = (): void => {
    const list = mount.querySelector<HTMLElement>("[data-admin-club-list]");
    if (list && response) list.innerHTML = adminClubListHtml(response, view);
  };

  async function load(): Promise<void> {
    const answer = await adminRequest("GET", CLUBS_URL).catch(() => null);
    if (answer?.status === 404) {
      root.querySelector<HTMLElement>("[data-admin-content]")?.replaceChildren();
      root.querySelector<HTMLElement>("[data-admin-content]")?.insertAdjacentHTML("beforeend", accessEndedHtml());
      return;
    }
    if (answer?.status !== 200 || !answer.body) {
      mount.innerHTML = "<h3>Clubs</h3><p>The clubs could not be loaded.</p>";
      return;
    }
    response = answer.body as unknown as AdminClubsResponse;
    mount.innerHTML = adminClubsHtml(response, view);
  }

  async function act(method: "POST" | "DELETE", clubId: number, path: string, body?: unknown): Promise<void> {
    if (busy) return;
    busy = true;
    status("Working…");
    try {
      const answer = await adminRequest(method, `${CLUBS_URL}/${String(clubId)}/${path}`, body);
      if (answer.status === 200 && answer.body) {
        response = answer.body as unknown as AdminClubsResponse;
        view = { ...view, form: null };
        drawList();
        status("Done. The action is in the admin log.");
        return;
      }
      if (answer.status === 404) {
        await load();
        return;
      }
      const text = (value: unknown): string => (typeof value === "string" ? value : "");
      const fields = Array.isArray(answer.body?.fields) ? (answer.body.fields as { message?: unknown }[]) : [];
      const message = fields
        .map((field) => text(field.message))
        .filter(Boolean)
        .join(" ");
      status(message || text(answer.body?.error) || "This did not work. Please try again.");
    } catch {
      status("The website could not be reached. Please try again.");
    } finally {
      busy = false;
    }
  }

  mount.addEventListener("input", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (input?.dataset.adminField === "search") {
      view = { ...view, query: input.value };
      drawList();
    } else if (input?.dataset.adminField === "confirm") {
      const row = input.closest<HTMLElement>("[data-club-row]");
      const club = response?.clubs.find((entry) => String(entry.club_id) === row?.dataset.clubRow);
      const button = row?.querySelector<HTMLButtonElement>('[data-admin-club="delete-confirm"]');
      if (button && club) button.disabled = input.value.trim() !== club.tag;
    }
  });
  mount.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-admin-club]") : null;
    if (!button || button.disabled) return;
    const clubId = Number(button.dataset.clubId);
    const row = button.closest<HTMLElement>("[data-club-row]");
    const field = (name: string): string =>
      row?.querySelector<HTMLInputElement>(`[data-admin-field="${name}"]`)?.value.trim() ?? "";
    switch (button.dataset.adminClub) {
      case "rename":
      case "delete":
        view = { ...view, form: { clubId, kind: button.dataset.adminClub } };
        status("");
        drawList();
        mount.querySelector<HTMLInputElement>("[data-club-row] input")?.focus();
        break;
      case "cancel":
        view = { ...view, form: null };
        drawList();
        break;
      case "rename-save":
        void act("POST", clubId, "rename", { name: field("name"), tag: field("tag") });
        break;
      case "logo":
        void act("DELETE", clubId, "logo");
        break;
      case "delete-confirm":
        void act("POST", clubId, "delete", { confirm_tag: field("confirm") });
        break;
    }
  });
  void load();
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
      content.innerHTML = accessEndedHtml();
      return;
    }
    if (!response.ok) throw new Error(`Admin overview failed with HTTP ${String(response.status)}.`);
    content.innerHTML = `${adminOverviewHtml((await response.json()) as AdminOverviewResponse)}<div data-admin-clubs></div>`;
    const clubs = content.querySelector<HTMLElement>("[data-admin-clubs]");
    if (clubs) initClubs(root, clubs);
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
