// The save bar of an editor on a page card (My Profile, My Club): at the end of the card; while there are unsaved
// changes and the end is out of sight, it floats at the bottom of the screen (the page's layout keeps
// position: sticky from working here). Its buttons carry data-edit-action ("save", "discard", "keep",
// "discard-confirm"); the editor handles their clicks.

import { escapeHtml } from "@ms/shared/html";
import { setToastLift } from "./profile-toasts.ts";

export interface EditBarState {
  /** No bar at all (the member cannot edit). */
  readonly hidden: boolean;
  readonly dirty: boolean;
  readonly saving: boolean;
  /** DISCARD was pressed and waits for "Yes, discard" or "Keep editing". */
  readonly confirming: boolean;
}

export interface EditBarTexts {
  /** The group's accessible name ("Profile changes"). */
  readonly label: string;
  readonly unsaved: string;
  readonly saving: string;
  readonly confirmDiscard: string;
}

export interface EditBar {
  readonly render: (state: EditBarState) => void;
  /** Places it again (after a resize). */
  readonly place: () => void;
  readonly button: (action: string) => HTMLButtonElement | null;
}

/** The bar at the end of `root`'s card (.popup-card), created on its first render. */
export function createEditBar(root: HTMLElement, texts: EditBarTexts): EditBar {
  let slot: HTMLElement | null = null;
  let bar: HTMLElement | null = null;
  let slotBelowView = false;
  let state: EditBarState = { hidden: true, dirty: false, saving: false, confirming: false };

  const button = (action: string): HTMLButtonElement | null =>
    bar?.querySelector<HTMLButtonElement>(`[data-edit-action="${action}"]`) ?? null;

  function place(): void {
    if (!slot || !bar) return;
    const floating = !state.hidden && state.dirty && slotBelowView;
    bar.classList.toggle("is-floating", floating);
    if (floating) {
      // As wide as the card, frame included.
      const box = (root.querySelector(".popup-card") ?? slot).getBoundingClientRect();
      bar.style.left = `${String(box.left)}px`;
      bar.style.width = `${String(box.width)}px`;
      setToastLift(bar.getBoundingClientRect().height);
    } else {
      bar.style.removeProperty("left");
      bar.style.removeProperty("width");
      setToastLift(0);
    }
  }

  function ensure(): void {
    if (slot?.isConnected) return;
    const card = root.querySelector<HTMLElement>(".popup-card");
    if (!card) return;
    slot = document.createElement("div");
    slot.className = "profile-edit-bar-slot";
    // The buttons stay the same elements in every state, so the focus stays on them.
    slot.innerHTML = [
      `<div class="profile-edit-bar" role="group" aria-label="${escapeHtml(texts.label)}">`,
      '<p class="profile-edit-bar-text"></p>',
      '<button class="profile-action-button" type="button" data-edit-action="discard">Discard</button>',
      '<button class="profile-action-button is-primary" type="button" data-edit-action="save">Save</button>',
      '<button class="profile-action-button" type="button" data-edit-action="keep" hidden>Keep editing</button>',
      '<button class="profile-action-button is-danger" type="button" data-edit-action="discard-confirm" hidden>Yes, discard</button>',
      "</div>",
    ].join("");
    card.append(slot);
    bar = slot.querySelector<HTMLElement>(".profile-edit-bar");
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          slotBelowView = entry.boundingClientRect.bottom > (entry.rootBounds?.bottom ?? window.innerHeight) + 0.5;
          place();
        },
        { threshold: [0, 1] },
      ).observe(slot);
    }
  }

  function render(next: EditBarState): void {
    state = next;
    ensure();
    if (!slot || !bar) return;
    slot.hidden = state.hidden;
    const text = bar.querySelector<HTMLElement>(".profile-edit-bar-text");
    if (text)
      text.textContent = state.saving
        ? texts.saving
        : state.confirming
          ? texts.confirmDiscard
          : state.dirty
            ? texts.unsaved
            : "";
    for (const [action, shown] of [
      ["discard", !state.confirming],
      ["save", !state.confirming],
      ["keep", state.confirming],
      ["discard-confirm", state.confirming],
    ] as const) {
      const node = button(action);
      if (node) node.hidden = !shown;
    }
    // Without changes both are off; while saving they stay focusable (aria-disabled) but do nothing.
    for (const action of ["discard", "save"]) {
      const node = button(action);
      if (!node) continue;
      node.disabled = !state.dirty && !state.saving;
      if (state.saving) node.setAttribute("aria-disabled", "true");
      else node.removeAttribute("aria-disabled");
    }
    bar.classList.toggle("is-dirty", state.dirty);
    place();
  }

  return { render, place, button };
}
