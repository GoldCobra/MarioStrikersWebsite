// Editing on the profile page itself. A pencil opens one field (the title, the country, the Switch code, an
// MSC code) for editing without saving it; "+" adds an MSC code (at most three) and "−" removes one while it
// is open. The title is picked from the member's titles, each shown in its look (colour and glow). A click
// outside an open field closes it again; what was entered stays in the draft.
// Every change is kept in a draft, marked as unsaved, until SAVE sends the whole profile in one request
// (PUT /api/profile/me/editable) or DISCARD drops it. When the profile was changed elsewhere meanwhile (in
// Discord), the draft is laid on top of what is saved now, so nothing is overwritten unseen.

import { escapeHtml } from "@ms/shared/html";
import { LEGACY_MSC_REGIONS, MSC_PLATFORMS, MSC_REGIONS, type FieldError } from "@ms/shared/friend-codes";
import { loginPath } from "@ms/shared/site/navigation";
import { createDropdown, type DropdownOption } from "../../lib/dropdown.ts";
import { playerTitleHtml, showFlag } from "../players/player-profile-view.ts";
import { countryLabel, countryOptions, flagImage, NO_COUNTRY_LABEL } from "./country-select.ts";
import { bindFriendCodeInput } from "./friend-code-input.ts";
import {
  COUNTRY_FIELD,
  MSC_LIST_FIELD,
  SWITCH_FIELD,
  TITLE_FIELD,
  canAddMscCode,
  changedFields,
  checkDraft,
  createDraft,
  errorsByField,
  isBlankNewRow,
  mscField,
  newMscRow,
  parseStoredDraft,
  rebaseDraft,
  type Blocks,
  type Draft,
  type DraftMsc,
  type EditableProfile,
  type FieldErrors,
  type SavedProfile,
  type StoredDraft,
} from "./profile-edit-state.ts";
import { setToastLift, showToast } from "./profile-toasts.ts";

const API_URL = "/api/profile/me/editable";
const DRAFT_KEY = "ms-profile-edit-draft";

const MESSAGES = {
  saved: "Changes saved.",
  unchanged: "Nothing was changed.",
  discarded: "Changes discarded.",
  checkFields: "Check the marked fields.",
  saveFailed: "Your changes could not be saved right now. Please try again.",
  tooMany: "Too many requests. Please try again in a minute.",
  notMember: "Only members of the Mario Strikers Discord server can change their profile.",
  loginExpired: "Your login has expired. Your changes are kept for the next login.",
  changedElsewhere: "Your profile was changed elsewhere (for example in Discord) meanwhile.",
  checkAgain: "Your changes are kept on top of it. Check them and save again.",
  conflict: "Also changed elsewhere meanwhile. Check it and save again.",
  draftRestored: "Your unsaved changes from before the login are back. Check them and save.",
  missingPlatform: "Select the platform.",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  confirmDiscard: "Discard all unsaved changes?",
  noTitle: "No player title",
} as const;

const icon = (paths: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${paths}</svg>`;

const ICONS = {
  pencil: icon('<path d="M11.4 1.6 14.4 4.6 5.3 13.7 1.6 14.4 2.3 10.7Z" fill="currentColor"/>'),
  minus: icon('<rect x="2.5" y="7" width="11" height="2" fill="currentColor"/>'),
  plus: icon('<path d="M7 2.5h2V7h4.5v2H9v4.5H7V9H2.5V7H7Z" fill="currentColor"/>'),
  cross: icon(
    '<path d="M3.9 2.5 8 6.6l4.1-4.1 1.4 1.4L9.4 8l4.1 4.1-1.4 1.4L8 9.4l-4.1 4.1-1.4-1.4L6.6 8 2.5 3.9Z" fill="currentColor"/>',
  ),
} as const;

/** MSC regions as the code lines name them ("NTSC-U (Wii): …"). */
const REGION_NAMES: Readonly<Record<string, string>> = { PAL: "PAL", NTSC: "NTSC-U", ...LEGACY_MSC_REGIONS };

interface ErrorBody {
  readonly code?: string;
  readonly fields?: readonly FieldError[];
  readonly current?: EditableProfile;
}

export interface ProfileEditorOptions {
  /** The profile card on the page (#player-profile-page). */
  readonly root: HTMLElement;
  readonly profile: EditableProfile;
  /** Renders the card again from the saved profile, after a save. */
  readonly reload: () => Promise<void>;
}

function savedOf(profile: EditableProfile): SavedProfile {
  return {
    title: profile.title,
    country: profile.country,
    switch_code: profile.switch_code,
    msc_codes: profile.msc_codes,
  };
}

/**
 * The title list: "No player title", then only the member's titles, in the order the API sends them (by
 * category and each category's own rule, titles/availability.ts), each as every view shows a title (its
 * game's ball, FULL CAPS, its look); no category names.
 */
function titleOptions(titles: EditableProfile["titles"]): DropdownOption[] {
  return [
    {
      value: "",
      label: MESSAGES.noTitle,
      html: `<span class="dropdown-text profile-title-none">${escapeHtml(MESSAGES.noTitle)}</span>`,
    },
    ...titles.map((title) => ({
      value: title.code,
      label: title.name,
      html: playerTitleHtml(title.name, title.style, title.game_code, "dropdown-text"),
    })),
  ];
}

function options(entries: readonly { value: string; label: string }[], selected: string, placeholder: string): string {
  const known = entries.some((entry) => entry.value === selected);
  return [
    `<option value=""${selected === "" || !known ? " selected" : ""}>${escapeHtml(placeholder)}</option>`,
    ...entries.map(
      (entry) =>
        `<option value="${escapeHtml(entry.value)}"${entry.value === selected ? " selected" : ""}>${escapeHtml(entry.label)}</option>`,
    ),
  ].join("");
}

function digitFields(label: string, blocks: Blocks, describedBy: string): string {
  const field = (index: number): string =>
    `<input class="profile-edit-digits" type="text" inputmode="numeric" autocomplete="off" maxlength="4" spellcheck="false" enterkeyhint="${index === 2 ? "done" : "next"}" value="${escapeHtml(blocks[index] ?? "")}" aria-label="${escapeHtml(label)}, digits ${String(index * 4 + 1)} to ${String(index * 4 + 4)}" aria-describedby="${escapeHtml(describedBy)}">`;
  const dash = '<span class="profile-edit-dash" aria-hidden="true">-</span>';
  return field(0) + dash + field(1) + dash + field(2);
}

function iconButton(attributes: string, label: string, svg: string, className = "profile-edit-icon"): string {
  return `<button class="${className}" type="button" ${attributes} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${svg}</button>`;
}

function rowActions(html: string): string {
  return `<span class="profile-row-actions">${html}</span>`;
}

/** "PAL (Wii):" in front of an MSC code, as the popup shows it. */
function mscPrefix(row: Pick<DraftMsc, "region" | "platform">): string {
  const region = Object.hasOwn(REGION_NAMES, row.region) ? (REGION_NAMES[row.region] ?? row.region) : row.region;
  return `${region || "MSC"}${row.platform ? ` (${row.platform})` : ""}:`;
}

function blocksCode(blocks: Blocks): string {
  return blocks.every((block) => block.length === 4) ? blocks.join("-") : blocks.filter(Boolean).join("-");
}

/** Id-safe text of a field key ("msc:saved:1234-…" → "msc-saved-1234-…"). */
function fieldId(field: string): string {
  return `profile-field-${field.replace(/[^a-z0-9-]/gi, "-")}`;
}

/** Adds the editing to the profile card; the card is rendered anew from the saved profile after a save. */
export function createProfileEditor({ root, profile: initial, reload }: ProfileEditorOptions): void {
  let profile = initial;
  let base: SavedProfile = savedOf(profile);
  let draft: Draft = createDraft(base);
  let countries = countryOptions(profile.countries);
  const openFields = new Set<string>();
  let errors: FieldErrors = new Map();
  let saving = false;
  let confirming = false;
  /** How often the lines were drawn; a click outside a field draws them only if nothing else did. */
  let renders = 0;
  let slotBelowView = false;

  const blocked = (): boolean => profile.discord.membership === "not_member";
  const dirty = (): boolean => changedFields(draft, base).size > 0;
  const content = (): HTMLElement | null => root.querySelector<HTMLElement>(".player-popup-content");
  const list = (key: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-list="${key}"]`);
  const nameOf = (code: string): string =>
    countryLabel(code, profile.countries.find((country) => country.code === code)?.name);
  const titleOf = (code: string) => profile.titles.find((title) => title.code === code);
  const titleNameOf = (code: string): string => titleOf(code)?.name ?? code.toUpperCase();

  // -------------------------------------------------------------------------------------------------
  // Fields

  function errorHtml(field: string): string {
    const messages = errors.get(field) ?? [];
    return `<p id="${fieldId(field)}-error" class="profile-edit-error" role="alert"${messages.length ? "" : " hidden"}>${escapeHtml(messages.join(" "))}</p>`;
  }

  function pencil(field: string, label: string): string {
    return blocked() ? "" : rowActions(iconButton(`data-edit-open="${escapeHtml(field)}"`, label, ICONS.pencil));
  }

  function viewRow(field: string, inner: string, actions: string, extraClass = ""): string {
    return `<div class="player-popup-code-row${extraClass}" data-field-row="${escapeHtml(field)}">${inner}<span class="visually-hidden" data-unsaved-note hidden>(unsaved)</span>${actions}</div>`;
  }

  function editRow(field: string, kind: string, inner: string): string {
    return `<div class="profile-edit-row is-${kind}" data-field-row="${escapeHtml(field)}" data-edit-row>${inner}<span class="visually-hidden" data-unsaved-note hidden>(unsaved)</span>${errorHtml(field)}</div>`;
  }

  function showSection(mount: HTMLElement): void {
    const section = mount.closest<HTMLElement>(".player-popup-section");
    if (section) section.hidden = false;
  }

  /** "Player Title" as its own section, before the country: only on this page, not in the popup. */
  function titleSection(): HTMLElement | null {
    let mount = list("title");
    if (mount) return mount;
    const next = (list("country") ?? list("fc-switch"))?.closest(".player-popup-section");
    if (!next) return null;
    const section = document.createElement("section");
    section.className = "player-popup-section profile-title-section";
    section.innerHTML =
      '<h3 id="profile-title-label" class="player-popup-section-title">Player Title</h3><div class="player-popup-code-list" data-list="title"></div>';
    next.before(section);
    mount = section.querySelector<HTMLElement>("[data-list='title']");
    return mount;
  }

  function renderTitle(): void {
    const mount = titleSection();
    if (!mount) return;
    if (openFields.has(TITLE_FIELD) && !blocked()) {
      mount.innerHTML = editRow(TITLE_FIELD, "title", "");
      const select = createDropdown({
        id: "profile-title-select",
        labelledBy: "profile-title-label",
        describedBy: `${fieldId(TITLE_FIELD)}-error`,
        options: titleOptions(profile.titles),
        value: draft.title,
        className: "profile-title-select",
        onChange: (value) => {
          draft = { ...draft, title: value };
          clearError(TITLE_FIELD);
          refresh();
        },
      });
      select.setInvalid(errors.has(TITLE_FIELD));
      mount.querySelector<HTMLElement>("[data-edit-row]")?.prepend(select.element);
      return;
    }
    const title = titleOf(draft.title);
    mount.innerHTML = viewRow(
      TITLE_FIELD,
      title
        ? playerTitleHtml(title.name, title.style, title.game_code, "player-popup-code-value")
        : `<span class="player-popup-code-value">${escapeHtml(MESSAGES.noTitle)}</span>`,
      pencil(TITLE_FIELD, "Change your title"),
      title ? " profile-title-row" : " profile-title-row profile-code-missing",
    );
  }

  /** "Country" as its own section, before the Switch code: only on this page, not in the popup. */
  function countrySection(): HTMLElement | null {
    let mount = list("country");
    if (mount) return mount;
    const switchSection = list("fc-switch")?.closest(".player-popup-section");
    if (!switchSection) return null;
    const section = document.createElement("section");
    section.className = "player-popup-section profile-country-section";
    section.innerHTML =
      '<h3 id="profile-country-label" class="player-popup-section-title">Country</h3><div class="player-popup-code-list" data-list="country"></div>';
    switchSection.before(section);
    mount = section.querySelector<HTMLElement>("[data-list='country']");
    return mount;
  }

  function renderCountry(): void {
    const mount = countrySection();
    if (!mount) return;
    if (openFields.has(COUNTRY_FIELD) && !blocked()) {
      mount.innerHTML = editRow(COUNTRY_FIELD, "country", "");
      const row = mount.querySelector<HTMLElement>("[data-edit-row]");
      const select = createDropdown({
        id: "profile-country-select",
        labelledBy: "profile-country-label",
        describedBy: `${fieldId(COUNTRY_FIELD)}-error`,
        options: countries,
        value: draft.country,
        className: "profile-country-select",
        onChange: (value) => {
          draft = { ...draft, country: value };
          clearError(COUNTRY_FIELD);
          renderHeaderFlag();
          refresh();
        },
      });
      select.setInvalid(errors.has(COUNTRY_FIELD));
      row?.prepend(select.element);
      return;
    }
    const code = draft.country;
    const option = countries.find((entry) => entry.value === code);
    const label = code ? (option?.label ?? nameOf(code)) : NO_COUNTRY_LABEL;
    mount.innerHTML = viewRow(
      COUNTRY_FIELD,
      `${flagImage(option?.flag ?? "", "profile-country-flag")}<span class="player-popup-code-value">${escapeHtml(label)}</span>`,
      pencil(COUNTRY_FIELD, "Change your country"),
      code ? " profile-country-row" : " profile-country-row profile-code-missing",
    );
  }

  function renderSwitch(): void {
    const mount = list("fc-switch");
    if (!mount) return;
    showSection(mount);
    if (openFields.has(SWITCH_FIELD) && !blocked()) {
      mount.innerHTML = editRow(
        SWITCH_FIELD,
        "switch",
        [
          '<span class="profile-edit-code" role="group" aria-label="Switch friend code">',
          '<span class="profile-edit-prefix" aria-hidden="true">SW-</span>',
          digitFields("Switch friend code", draft.switchBlocks, `${fieldId(SWITCH_FIELD)}-error`),
          iconButton('data-edit-action="clear"', "Clear the code", ICONS.cross, "profile-edit-icon is-clear"),
          "</span>",
        ].join(""),
      );
      return;
    }
    const code = blocksCode(draft.switchBlocks);
    mount.innerHTML = viewRow(
      SWITCH_FIELD,
      `<span class="player-popup-code-value">${escapeHtml(code ? `SW-${code}` : "No code saved")}</span>`,
      pencil(SWITCH_FIELD, "Change your Switch friend code"),
      code ? "" : " profile-code-missing",
    );
  }

  function mscEditRow(row: DraftMsc): string {
    const field = mscField(row);
    const regions: { value: string; label: string }[] = MSC_REGIONS.map((region) => ({ ...region }));
    // An older NTSC-J/K code keeps its region; no new code gets one.
    const legacy = Object.hasOwn(LEGACY_MSC_REGIONS, row.region) ? LEGACY_MSC_REGIONS[row.region] : undefined;
    if (legacy) regions.push({ value: row.region, label: `${legacy} (no new codes)` });
    const platforms = MSC_PLATFORMS.map((platform) => ({ value: platform, label: platform }));
    const described = `${fieldId(field)}-error`;
    return editRow(
      field,
      "msc",
      [
        `<select class="profile-edit-select" data-field="region" aria-label="MSC friend code, region" aria-describedby="${described}">${options(regions, row.region, "Region")}</select>`,
        `<select class="profile-edit-select" data-field="platform" aria-label="MSC friend code, platform" aria-describedby="${described}">${options(platforms, row.platform, "Platform")}</select>`,
        '<span class="profile-edit-code" role="group" aria-label="MSC friend code">',
        digitFields("MSC friend code", row.blocks, described),
        "</span>",
        rowActions(
          iconButton(
            `data-edit-action="remove" data-key="${escapeHtml(row.key)}"`,
            row.original ? `Remove MSC friend code ${row.original}` : "Remove this MSC friend code",
            ICONS.minus,
          ),
        ),
      ].join(""),
    );
  }

  function mscViewRow(row: DraftMsc): string {
    const code = blocksCode(row.blocks);
    const html = viewRow(
      mscField(row),
      `<span class="player-popup-code-prefix">${escapeHtml(mscPrefix(row))}</span><span class="player-popup-code-value">${escapeHtml(code)}</span>`,
      pencil(mscField(row), `Change MSC friend code ${mscPrefix(row)} ${code}`),
    );
    // An older code saved without a platform asks for one.
    return row.platform || blocked() ? html : `${html}<p class="profile-row-hint">${MESSAGES.missingPlatform}</p>`;
  }

  function renderMsc(): void {
    const mount = list("fc-msc");
    if (!mount) return;
    showSection(mount);
    const section = mount.closest<HTMLElement>(".player-popup-section");
    section?.querySelector(":scope > .profile-section-actions")?.remove();
    if (section && !blocked() && canAddMscCode(draft)) {
      section.insertAdjacentHTML(
        "afterbegin",
        `<span class="profile-section-actions">${iconButton('data-edit-action="add"', "Add an MSC friend code", ICONS.plus)}</span>`,
      );
    }
    const rows = draft.msc.map((row) =>
      openFields.has(mscField(row)) && !blocked() ? mscEditRow(row) : mscViewRow(row),
    );
    mount.innerHTML =
      (rows.length
        ? rows.join("")
        : '<div class="player-popup-code-row profile-code-missing"><span class="player-popup-code-value">No code saved</span></div>') +
      errorHtml(MSC_LIST_FIELD);
  }

  function bindDigitFields(): void {
    for (const row of Array.from(root.querySelectorAll<HTMLElement>("[data-edit-row]"))) {
      const fields = Array.from(row.querySelectorAll<HTMLInputElement>(".profile-edit-digits"));
      if (!fields.length) continue;
      const field = row.dataset.fieldRow ?? "";
      bindFriendCodeInput(fields, {
        onChange: () => {
          readRow(row);
        },
        onRejected: (message) => {
          showFieldError(field, message ? [message] : []);
        },
      });
      const invalid = errors.has(field);
      for (const input of fields) input.toggleAttribute("aria-invalid", invalid);
    }
    for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>("[data-edit-row] select"))) {
      const field = select.closest<HTMLElement>("[data-edit-row]")?.dataset.fieldRow ?? "";
      select.toggleAttribute("aria-invalid", errors.has(field));
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Save bar: at the end of the card; while there are unsaved changes and the end is out of sight, it
  // floats at the bottom of the screen (the page's layout keeps position: sticky from working here).

  let slot: HTMLElement | null = null;
  let bar: HTMLElement | null = null;

  const barButton = (action: string): HTMLButtonElement | null =>
    bar?.querySelector<HTMLButtonElement>(`[data-edit-action="${action}"]`) ?? null;

  function ensureBar(): void {
    if (slot?.isConnected) return;
    const card = root.querySelector<HTMLElement>(".popup-card");
    if (!card) return;
    slot = document.createElement("div");
    slot.className = "profile-edit-bar-slot";
    // The buttons stay the same elements in every state, so the focus stays on them.
    slot.innerHTML = [
      '<div class="profile-edit-bar" role="group" aria-label="Profile changes">',
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
          placeBar();
        },
        { threshold: [0, 1] },
      ).observe(slot);
    }
  }

  function placeBar(): void {
    if (!slot || !bar) return;
    const floating = !blocked() && dirty() && slotBelowView;
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

  function renderBar(): void {
    ensureBar();
    if (!slot || !bar) return;
    slot.hidden = blocked();
    const changed = dirty();
    const text = bar.querySelector<HTMLElement>(".profile-edit-bar-text");
    if (text)
      text.textContent = saving
        ? MESSAGES.saving
        : confirming
          ? MESSAGES.confirmDiscard
          : changed
            ? MESSAGES.unsaved
            : "";
    for (const [action, shown] of [
      ["discard", !confirming],
      ["save", !confirming],
      ["keep", confirming],
      ["discard-confirm", confirming],
    ] as const) {
      const button = barButton(action);
      if (button) button.hidden = !shown;
    }
    // Without changes both are off; while saving they stay focusable (aria-disabled) but do nothing.
    for (const action of ["discard", "save"]) {
      const button = barButton(action);
      if (!button) continue;
      button.disabled = !changed && !saving;
      if (saving) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
    }
    bar.classList.toggle("is-dirty", changed);
    placeBar();
  }

  // -------------------------------------------------------------------------------------------------
  // State on screen

  function renderHeaderFlag(): void {
    const flag = root.querySelector<HTMLImageElement>(".player-popup-flag");
    if (flag) showFlag(flag, draft.country);
  }

  function renderNotice(): void {
    const mount = content();
    let notice = mount?.querySelector<HTMLElement>(":scope > .profile-edit-notice") ?? null;
    if (!blocked()) {
      notice?.remove();
      return;
    }
    if (!mount) return;
    if (!notice) {
      notice = document.createElement("p");
      notice.className = "profile-edit-notice";
      mount.querySelector(":scope > .profile-top-line")?.after(notice);
      if (!notice.isConnected) mount.prepend(notice);
    }
    notice.textContent = MESSAGES.notMember;
  }

  /** Unsaved marks and the save bar, after the draft changed without the lines changing. */
  function refresh(): void {
    const changed = changedFields(draft, base);
    for (const row of Array.from(root.querySelectorAll<HTMLElement>("[data-field-row]"))) {
      const unsaved = changed.has(row.dataset.fieldRow ?? "");
      row.classList.toggle("is-unsaved", unsaved);
      const note = row.querySelector<HTMLElement>(":scope > [data-unsaved-note]");
      if (note) note.hidden = !unsaved;
    }
    const mscTitle = list("fc-msc")?.closest(".player-popup-section")?.querySelector(".player-popup-section-title");
    mscTitle?.classList.toggle("is-unsaved", changed.has(MSC_LIST_FIELD));
    renderBar();
  }

  function render(): void {
    renders += 1;
    renderNotice();
    renderCountry();
    renderTitle();
    renderSwitch();
    renderMsc();
    bindDigitFields();
    renderHeaderFlag();
    refresh();
  }

  function showFieldError(field: string, messages: readonly string[]): void {
    const next = new Map(errors);
    if (messages.length) next.set(field, messages);
    else next.delete(field);
    errors = next;
    const node = root.querySelector<HTMLElement>(`#${CSS.escape(`${fieldId(field)}-error`)}`);
    if (!node) return;
    node.textContent = messages.join(" ");
    node.hidden = !messages.length;
  }

  function clearError(field: string): void {
    if (errors.has(field)) showFieldError(field, []);
  }

  /** A field's first control, or its pencil when it is closed. */
  function focusField(field: string): void {
    const row = root.querySelector<HTMLElement>(`[data-field-row="${CSS.escape(field)}"]`);
    (
      row?.querySelector<HTMLElement>("[role='combobox'], select, input") ??
      row?.querySelector<HTMLElement>("[data-edit-open]")
    )?.focus();
  }

  function focusFirstError(): void {
    const first = Array.from(root.querySelectorAll<HTMLElement>("[data-field-row]")).find((row) =>
      errors.has(row.dataset.fieldRow ?? ""),
    );
    if (first) focusField(first.dataset.fieldRow ?? "");
    else
      root
        .querySelector<HTMLElement>(`#${CSS.escape(`${fieldId(MSC_LIST_FIELD)}-error`)}`)
        ?.scrollIntoView({ block: "nearest" });
  }

  // -------------------------------------------------------------------------------------------------
  // Changing the draft

  /** An open line's values into the draft. */
  function readRow(row: HTMLElement): void {
    const field = row.dataset.fieldRow ?? "";
    const digits = Array.from(row.querySelectorAll<HTMLInputElement>(".profile-edit-digits")).map(
      (input) => input.value,
    );
    const blocks: Blocks = [digits[0] ?? "", digits[1] ?? "", digits[2] ?? ""];
    if (field === SWITCH_FIELD) {
      draft = { ...draft, switchBlocks: blocks };
    } else if (field.startsWith("msc:")) {
      const value = (name: string): string =>
        row.querySelector<HTMLSelectElement>(`[data-field="${name}"]`)?.value ?? "";
      draft = {
        ...draft,
        msc: draft.msc.map((entry) =>
          mscField(entry) === field
            ? { ...entry, region: value("region"), platform: value("platform"), blocks }
            : entry,
        ),
      };
    }
    clearError(field);
    refresh();
  }

  function openField(field: string): void {
    if (saving || blocked()) return;
    confirming = false;
    openFields.add(field);
    render();
    focusField(field);
  }

  /** Escape on an open field: back to what is saved, and closed. */
  function revertField(field: string): void {
    const saved = createDraft(base);
    if (field === TITLE_FIELD) draft = { ...draft, title: saved.title };
    else if (field === COUNTRY_FIELD) draft = { ...draft, country: saved.country };
    else if (field === SWITCH_FIELD) draft = { ...draft, switchBlocks: saved.switchBlocks };
    else {
      const row = draft.msc.find((entry) => mscField(entry) === field);
      const savedRow = saved.msc.find((entry) => row?.original !== null && entry.original === row?.original);
      draft = {
        ...draft,
        msc: savedRow
          ? draft.msc.map((entry) => (mscField(entry) === field ? { ...savedRow, key: entry.key } : entry))
          : draft.msc.filter((entry) => mscField(entry) !== field),
      };
      if (!savedRow) {
        openFields.delete(field);
        clearError(field);
        render();
        root.querySelector<HTMLElement>("[data-edit-action='add']")?.focus();
        return;
      }
    }
    openFields.delete(field);
    clearError(field);
    render();
    focusField(field);
  }

  function addRow(): void {
    if (saving || blocked() || !canAddMscCode(draft)) return;
    confirming = false;
    const row = newMscRow(draft);
    draft = { ...draft, msc: [...draft.msc, row] };
    openFields.add(mscField(row));
    render();
    focusField(mscField(row));
  }

  function removeRow(key: string): void {
    if (saving) return;
    const index = draft.msc.findIndex((row) => row.key === key);
    if (index < 0) return;
    const field = mscField({ key });
    draft = { ...draft, msc: draft.msc.filter((row) => row.key !== key) };
    openFields.delete(field);
    clearError(field);
    clearError(MSC_LIST_FIELD);
    render();
    const next = draft.msc[index] ?? draft.msc[index - 1];
    if (next) focusField(mscField(next));
    else root.querySelector<HTMLElement>("[data-edit-action='add']")?.focus();
  }

  function resetTo(next: EditableProfile): void {
    profile = next;
    base = savedOf(next);
    draft = createDraft(base);
    countries = countryOptions(next.countries);
    openFields.clear();
    errors = new Map();
    confirming = false;
  }

  function discard(): void {
    resetTo(profile);
    clearStoredDraft();
    render();
    showToast({ text: MESSAGES.discarded, level: "info" });
    root.querySelector<HTMLElement>("[data-edit-open]")?.focus();
  }

  // -------------------------------------------------------------------------------------------------
  // Saving

  function storeDraft(): void {
    try {
      const stored: StoredDraft = { v: 3, id: profile.discord.id, base, draft };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(stored));
    } catch {
      // Storage may be unavailable (private mode); the draft stays on the page either way.
    }
  }

  function clearStoredDraft(): void {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Nothing was stored.
    }
  }

  /** Opens the fields that have errors, so their messages can show. */
  function openErrorFields(): void {
    for (const field of errors.keys()) {
      const isField = [TITLE_FIELD, COUNTRY_FIELD, SWITCH_FIELD].includes(field);
      if (isField || draft.msc.some((row) => mscField(row) === field)) {
        openFields.add(field);
      }
    }
  }

  async function save(): Promise<void> {
    if (saving || blocked() || !dirty()) return;
    confirming = false;
    const checked = checkDraft(draft, base, profile.countries, profile.titles);
    if (!checked.ok) {
      errors = checked.errors;
      openErrorFields();
      render();
      focusFirstError();
      showToast({ text: MESSAGES.checkFields, level: "error" });
      return;
    }
    saving = true;
    renderBar();
    try {
      const response = await fetch(API_URL, {
        method: "PUT",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ version: profile.version, ...checked.request }),
      });
      const body = (await response.json().catch(() => ({}))) as EditableProfile & ErrorBody & { changed?: boolean };
      if (response.ok) {
        resetTo(body);
        clearStoredDraft();
        saving = false;
        await reload();
        render();
        showToast({ text: body.changed === false ? MESSAGES.unchanged : MESSAGES.saved, level: "success" });
        root.querySelector<HTMLElement>("[data-edit-open]")?.focus();
        return;
      }
      if (response.status === 409 && body.code === "PROFILE_CHANGED" && body.current) {
        const current = body.current;
        const rebased = rebaseDraft(draft, base, savedOf(current), nameOf, titleNameOf);
        profile = current;
        base = savedOf(current);
        countries = countryOptions(current.countries);
        draft = rebased.draft;
        errors = new Map([...rebased.conflicts].map((field) => [field, [MESSAGES.conflict]]));
        openErrorFields();
        saving = false;
        await reload();
        render();
        showToast({
          text: [MESSAGES.changedElsewhere, ...rebased.notes, dirty() ? MESSAGES.checkAgain : ""]
            .filter(Boolean)
            .join(" "),
          level: "error",
        });
        focusFirstError();
        return;
      }
      if (body.fields?.length) {
        errors = errorsByField(body.fields, checked.rowKeys);
        openErrorFields();
        saving = false;
        render();
        focusFirstError();
        showToast({ text: MESSAGES.checkFields, level: "error" });
      } else if (response.status === 401) {
        storeDraft();
        showToast({
          text: MESSAGES.loginExpired,
          level: "error",
          link: { href: loginPath("/profile"), label: "Log in again" },
        });
      } else if (body.code === "NOT_GUILD_MEMBER") {
        profile = { ...profile, discord: { ...profile.discord, membership: "not_member" } };
        resetTo(profile);
        saving = false;
        render();
        showToast({ text: MESSAGES.notMember, level: "error" });
      } else {
        showToast({ text: response.status === 429 ? MESSAGES.tooMany : MESSAGES.saveFailed, level: "error" });
      }
    } catch {
      showToast({ text: MESSAGES.saveFailed, level: "error" });
    } finally {
      if (saving) {
        saving = false;
        renderBar();
      }
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Events

  // A click outside an open field closes it: anywhere but its line, whose selects, digit fields, country
  // list, "×" and "−" belong to it. The draft keeps what was entered, marked unsaved; nothing is saved or
  // reverted, and a code line added with "+" and left empty goes. Seen in the capture phase, before the
  // card's own handler; the lines are drawn anew only once the click has passed (in the bubble phase, or
  // right after it if something stopped it on the way), so it still reaches a pencil, "+", SAVE or
  // DISCARD, and only when the click drew nothing itself.
  let closedAt: number | null = null;
  function closeFieldsOutside(event: MouseEvent): void {
    if (!root.isConnected) {
      document.removeEventListener("click", closeFieldsOutside, true);
      document.removeEventListener("click", drawClosedFields);
      return;
    }
    if (!openFields.size || saving) return;
    const target = event.target instanceof Node ? event.target : null;
    const closing = [...openFields].filter(
      (field) => !root.querySelector(`[data-edit-row][data-field-row="${CSS.escape(field)}"]`)?.contains(target),
    );
    if (!closing.length) return;
    for (const field of closing) openFields.delete(field);
    draft = { ...draft, msc: draft.msc.filter((row) => !(closing.includes(mscField(row)) && isBlankNewRow(row))) };
    closedAt = renders;
    window.setTimeout(drawClosedFields, 0);
  }
  function drawClosedFields(): void {
    if (closedAt === null) return;
    const drawn = closedAt;
    closedAt = null;
    if (root.isConnected && renders === drawn) render();
  }
  document.addEventListener("click", closeFieldsOutside, true);
  document.addEventListener("click", drawClosedFields);

  root.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const opener = element?.closest<HTMLElement>("[data-edit-open]");
    if (opener) {
      openField(opener.dataset.editOpen ?? "");
      return;
    }
    const trigger = element?.closest<HTMLElement>("[data-edit-action]");
    if (!trigger || (trigger instanceof HTMLButtonElement && trigger.disabled) || saving) return;
    switch (trigger.dataset.editAction) {
      case "save":
        void save();
        break;
      case "discard":
        if (dirty()) {
          confirming = true;
          renderBar();
          barButton("discard-confirm")?.focus();
        }
        break;
      case "keep":
        confirming = false;
        renderBar();
        barButton("discard")?.focus();
        break;
      case "discard-confirm":
        discard();
        break;
      case "add":
        addRow();
        break;
      case "remove":
        removeRow(trigger.dataset.key ?? "");
        break;
      case "clear": {
        const row = trigger.closest<HTMLElement>("[data-edit-row]");
        const fields = Array.from(row?.querySelectorAll<HTMLInputElement>(".profile-edit-digits") ?? []);
        for (const field of fields) field.value = "";
        if (row) readRow(row);
        fields[0]?.focus();
        break;
      }
    }
  });
  root.addEventListener("change", (event) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-edit-row]") : null;
    if (row && event.target instanceof HTMLSelectElement) readRow(row);
  });
  root.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === "Escape" && confirming && target?.closest(".profile-edit-bar")) {
      event.preventDefault();
      confirming = false;
      renderBar();
      barButton("discard")?.focus();
      return;
    }
    const row = target?.closest<HTMLElement>("[data-edit-row]");
    if (!row) return;
    if (event.key === "Escape") {
      event.preventDefault();
      revertField(row.dataset.fieldRow ?? "");
    } else if (event.key === "Enter" && !(target instanceof HTMLButtonElement)) {
      event.preventDefault();
      void save();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!dirty() || blocked()) return;
    event.preventDefault();
  });
  window.addEventListener("resize", placeBar);

  // Changes kept when the login expired come back after the next login (same Discord account only).
  let restored = false;
  try {
    const stored = parseStoredDraft(sessionStorage.getItem(DRAFT_KEY), profile.discord.id);
    sessionStorage.removeItem(DRAFT_KEY);
    if (stored && !blocked()) {
      const rebased = rebaseDraft(stored.draft, stored.base, base, nameOf, titleNameOf);
      draft = rebased.draft;
      for (const field of changedFields(draft, base)) if (field !== MSC_LIST_FIELD) openFields.add(field);
      restored = dirty();
    }
  } catch {
    // A broken or unavailable draft is dropped.
  }
  render();
  if (restored) showToast({ text: MESSAGES.draftRestored, level: "info" });
}
