// The signed-in member's club (/my-club, docs/adr/0012), from /api/my-club, or the reason it cannot be shown. In a
// club it is the club popup's card with My Club's sections (club-view.ts; club-edit.ts edits the settings);
// without one, the member's invitations, creating a club and the open clubs (no-club-view.ts). Every change
// answers with the whole state, which the page shows at once.

import { loginPath } from "@ms/shared/site/navigation";
import {
  DISCORD_LINK,
  RETRY_BUTTON,
  loginRequiredHtml,
  removeAuthQuery,
  signedIn,
  stateActions,
  statePanel,
} from "../profile/account-page.ts";
import { showToast } from "../profile/profile-toasts.ts";
import { createClubView } from "./club-view.ts";
import { MY_CLUB_URL, clubRequest, type ClubResponse, type MyClubState } from "./my-club-data.ts";
import { createNoClubView } from "./no-club-view.ts";

const RETURN_TO = "/my-club";

export interface MyClubContext {
  /**
   * Sends a change. An answer with the state is shown at once (with `success` as a message); an error whose code
   * is in `own` is only returned, any other one is told in a message.
   */
  act(
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    options?: { readonly success?: string; readonly own?: readonly string[] },
  ): Promise<ClubResponse<MyClubState>>;
}

/** What the page shows: the club (its id) or no club (null). */
export interface MyClubView {
  readonly root: HTMLElement;
  readonly clubId: number | null;
  update(state: MyClubState): void;
}

function errorHtml(response: ClubResponse<MyClubState>): string {
  if (response.status === 401) return loginRequiredHtml(RETURN_TO, "Login with Discord to manage your club.");
  switch (response.error.code) {
    case "CLUB_MANAGEMENT_CLOSED":
      return statePanel(
        "My Club Is Not Open Yet",
        "Clubs are managed with the /club commands in Discord until My Club opens here.",
        stateActions(DISCORD_LINK),
      );
    case "NOT_GUILD_MEMBER":
      return statePanel(
        "Discord Server Required",
        "Only members of the Mario Strikers Discord server can manage clubs.",
        stateActions(DISCORD_LINK),
      );
    case "DISCORD_UNAVAILABLE":
      return statePanel(
        "Discord Unavailable",
        "Discord could not be reached right now. Please try again in a moment.",
        stateActions(RETRY_BUTTON),
      );
    default:
      return statePanel(
        "My Club Unavailable",
        "My Club could not be loaded right now. Please try again later.",
        stateActions(RETRY_BUTTON),
      );
  }
}

export async function initMyClubPage(mount: HTMLElement): Promise<void> {
  let view: MyClubView | null = null;

  function show(state: MyClubState): void {
    const clubId = state.club?.club_id ?? null;
    if (view?.root.isConnected && view.clubId === clubId) {
      view.update(state);
      return;
    }
    view = state.club ? createClubView(context, { ...state, club: state.club }) : createNoClubView(context, state);
    mount.replaceChildren(view.root);
  }

  async function load(): Promise<void> {
    view = null;
    mount.innerHTML = '<p class="profile-loading loading-note">Loading...</p>';
    if ((await signedIn()) === false) {
      mount.innerHTML = loginRequiredHtml(RETURN_TO, "Login with Discord to manage your club.");
      return;
    }
    const response = await clubRequest<MyClubState>("GET", MY_CLUB_URL);
    if (!response.ok || !response.body) {
      mount.innerHTML = errorHtml(response);
      return;
    }
    show(response.body);
    removeAuthQuery();
  }

  const context: MyClubContext = {
    async act(method, path, body, options = {}) {
      const response = await clubRequest<MyClubState>(method, path, body);
      if (response.ok && response.body) {
        show(response.body);
        if (options.success) showToast({ text: options.success, level: "success" });
        return response;
      }
      const code = response.error.code ?? "";
      if (options.own?.includes(code)) return response;
      if (response.status === 401) {
        showToast({
          text: "Your login has expired.",
          level: "error",
          link: { href: loginPath(RETURN_TO), label: "Log in again" },
        });
      } else if (code === "CLUB_MANAGEMENT_CLOSED") {
        await load();
      } else if (response.status === 429) {
        showToast({ text: "Too many requests. Please try again in a minute.", level: "error" });
      } else if (response.status === 0) {
        showToast({ text: "The website could not be reached. Please try again.", level: "error" });
      } else {
        showToast({ text: response.error.error || "This did not work right now. Please try again.", level: "error" });
      }
      return response;
    },
  };

  mount.addEventListener("click", (event) => {
    const action = event.target instanceof Element ? event.target.closest("[data-profile-action]") : null;
    if (action && mount.contains(action) && action.getAttribute("data-profile-action") === "retry") void load();
  });
  await load();
}
