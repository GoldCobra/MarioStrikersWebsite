// Editing a club on My Club, the profile page's way (profile-edit.ts): a pencil opens one line (status, regions,
// club codes, uniforms, stadium, Discord server) without saving it; "+" adds a region or club code and "−" removes
// one while the line is open. A click outside an open line closes it; what was entered stays in the draft. Every
// change stays in the draft, marked unsaved, until SAVE sends the whole settings (PUT /api/my-club/settings with
// the version they were loaded with) or DISCARD drops it; when another officer saved meanwhile, the draft is laid
// on top of what is saved now. A new club is the same form with every line open, its name and tag first, and
// CREATE CLUB instead of the save bar.

import { escapeHtml } from "@ms/shared/html";
import {
  CLUB_NAME_MAX_LENGTH,
  CLUB_REGIONS,
  CLUB_STADIUMS,
  CLUB_STATUS_INVITE_ONLY,
  CLUB_STATUS_OPEN,
  CLUB_TAG_MAX_LENGTH,
  CLUB_UNIFORMS_COOL,
  CLUB_UNIFORMS_WARM,
  type ClubSettingsValue,
} from "@ms/shared/clubs";
import { regionBadgeHtml, uniformIconHtml, discordInviteUrl } from "../clubs/club-profile-view.ts";
import { statusHtml } from "../clubs/club-data.ts";
import { createEditBar } from "../profile/edit-bar.ts";
import { showToast } from "../profile/profile-toasts.ts";
import {
  NEW_CLUB_DRAFT,
  NEW_CLUB_FIELDS,
  SETTINGS_FIELDS,
  canAddLine,
  changedFields,
  checkNewClub,
  checkSettings,
  createDraft,
  errorsByField,
  rebaseDraft,
  withoutBlankLines,
  type ClubDraft,
  type ClubField,
  type FieldErrors,
} from "./club-edit-state.ts";
import type { FieldErrorBody } from "./my-club-data.ts";

const MESSAGES = {
  saved: "Changes saved.",
  discarded: "Changes discarded.",
  checkFields: "Check the marked fields.",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  creating: "Creating…",
  confirmDiscard: "Discard all unsaved changes?",
  changedElsewhere: "Another officer changed the club's settings meanwhile.",
  checkAgain: "Your changes are kept on top of them. Check them and save again.",
  conflict: "Also changed meanwhile. Check it and save again.",
} as const;

const LABELS: Readonly<Record<ClubField, string>> = {
  name: "Club Name",
  tag: "Club Tag",
  status: "Status",
  regions: "Regions (1 to 3)",
  codes: "Club Codes (1 to 3)",
  uniforms: "Uniforms",
  stadium: "Stadium",
  discord: "Discord Server",
};

const icon = (paths: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${paths}</svg>`;

const ICONS = {
  pencil: icon('<path d="M11.4 1.6 14.4 4.6 5.3 13.7 1.6 14.4 2.3 10.7Z" fill="currentColor"/>'),
  minus: icon('<rect x="2.5" y="7" width="11" height="2" fill="currentColor"/>'),
  plus: icon('<path d="M7 2.5h2V7h4.5v2H9v4.5H7V9H2.5V7H7Z" fill="currentColor"/>'),
} as const;

/** What a SAVE or CREATE request came back with. */
export type SubmitResult =
  | { readonly kind: "done" }
  | { readonly kind: "fields"; readonly fields: readonly FieldErrorBody[] }
  /** 409: the settings changed meanwhile; `saved` is what is saved now (the page reloaded it). */
  | { readonly kind: "changed"; readonly saved: ClubSettingsValue; readonly version: string }
  /** Anything else; the page has said why already. */
  | { readonly kind: "failed" };

export interface ClubEditorOptions {
  /** The page's club card (#club-profile-page), for the save bar at its end. */
  readonly root: HTMLElement;
  /** Where the lines go. */
  readonly mount: HTMLElement;
  readonly mode: "settings" | "create";
  /** What is saved (settings), or nothing yet (create). */
  readonly saved: ClubSettingsValue;
  readonly version: string;
  /** Captain and officers edit; members see the lines without pencils. */
  readonly editable: boolean;
  /** Sends the request (settings with their version, or the new club). */
  readonly submit: (request: Record<string, unknown>) => Promise<SubmitResult>;
  /** Create mode: CANCEL closes the form. */
  readonly cancel?: () => void;
}

export interface ClubEditor {
  /** The club changed (a save, or another action's answer): new saved settings; the draft stays on top. */
  setSaved(saved: ClubSettingsValue, version: string): void;
  isDirty(): boolean;
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

function iconButton(attributes: string, label: string, svg: string): string {
  return `<button class="profile-edit-icon" type="button" ${attributes} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${svg}</button>`;
}

function fieldId(field: string): string {
  return `club-field-${field}`;
}

const REGION_OPTIONS = CLUB_REGIONS.map((region) => ({
  value: region.value,
  label: `${region.value} (${region.label})`,
}));
const UNIFORM_OPTIONS = [...CLUB_UNIFORMS_WARM, ...CLUB_UNIFORMS_COOL].map((colour) => ({
  value: colour,
  label: colour,
}));
const STADIUM_OPTIONS = CLUB_STADIUMS.map((stadium) => ({ value: stadium, label: stadium }));
const STATUS_OPTIONS = [
  { value: "open", label: CLUB_STATUS_OPEN },
  { value: "invite", label: CLUB_STATUS_INVITE_ONLY },
];

export function createClubEditor(config: ClubEditorOptions): ClubEditor {
  const { root, mount, mode, editable } = config;
  const creating = mode === "create";
  const fields = creating ? NEW_CLUB_FIELDS : SETTINGS_FIELDS;
  let saved = config.saved;
  let version = config.version;
  let draft: ClubDraft = creating ? NEW_CLUB_DRAFT : createDraft(saved);
  const openFields = new Set<ClubField>(creating ? fields : []);
  let errors: FieldErrors = new Map();
  let saving = false;
  let confirming = false;
  let renders = 0;

  const dirty = (): boolean => !creating && changedFields(draft, saved).size > 0;
  const isOpen = (field: ClubField): boolean => editable && openFields.has(field);

  // -------------------------------------------------------------------------------------------------
  // Lines

  function errorHtml(field: ClubField): string {
    const messages = errors.get(field) ?? [];
    return `<p id="${fieldId(field)}-error" class="profile-edit-error" role="alert"${messages.length ? "" : " hidden"}>${escapeHtml(messages.join(" "))}</p>`;
  }

  function pencil(field: ClubField): string {
    if (!editable || creating) return "";
    return `<span class="profile-row-actions">${iconButton(`data-edit-open="${field}"`, `Change ${LABELS[field].replace(/ \(.*\)$/, "").toLowerCase()}`, ICONS.pencil)}</span>`;
  }

  function viewRow(field: ClubField, inner: string, missing: boolean): string {
    return `<div class="player-popup-code-row${missing ? " profile-code-missing" : ""}" data-field-row="${field}">${inner}<span class="visually-hidden" data-unsaved-note hidden>(unsaved)</span>${pencil(field)}</div>`;
  }

  function editRow(field: ClubField, inner: string): string {
    return `<div class="profile-edit-row is-club-${field}" data-field-row="${field}" data-edit-row>${inner}<span class="visually-hidden" data-unsaved-note hidden>(unsaved)</span>${errorHtml(field)}</div>`;
  }

  const value = (text: string): string => `<span class="player-popup-code-value">${escapeHtml(text)}</span>`;
  const described = (field: ClubField): string => `aria-describedby="${fieldId(field)}-error"`;

  function textInput(field: ClubField, text: string, attributes: string): string {
    return `<input class="profile-edit-text" type="text" data-field="${field}" value="${escapeHtml(text)}" autocomplete="off" spellcheck="false" aria-labelledby="${fieldId(field)}-label" ${described(field)} ${attributes}>`;
  }

  function listLine(field: "regions" | "codes", index: number, control: string): string {
    const remove =
      (field === "regions" ? draft.regions : draft.codes).length > 1
        ? iconButton(
            `data-edit-action="remove" data-field="${field}" data-index="${String(index)}"`,
            "Remove this line",
            ICONS.minus,
          )
        : "";
    return `<span class="club-edit-line">${control}${remove}</span>`;
  }

  function lineHtml(field: ClubField): string {
    if (isOpen(field)) {
      switch (field) {
        case "name":
          return editRow(
            field,
            textInput(field, draft.name, `maxlength="${String(CLUB_NAME_MAX_LENGTH)}" enterkeyhint="next"`),
          );
        case "tag":
          return editRow(
            field,
            textInput(field, draft.tag, `maxlength="${String(CLUB_TAG_MAX_LENGTH)}" enterkeyhint="next"`),
          );
        case "status": {
          const selected = draft.isOpen === null ? "" : draft.isOpen ? "open" : "invite";
          return editRow(
            field,
            `<select class="profile-edit-select" data-field="status" aria-labelledby="${fieldId(field)}-label" ${described(field)}>${options(STATUS_OPTIONS, selected, "Who can join?")}</select>`,
          );
        }
        case "regions":
          return editRow(
            field,
            draft.regions
              .map((region, index) =>
                listLine(
                  field,
                  index,
                  `<select class="profile-edit-select" data-field="regions" data-index="${String(index)}" aria-label="Region ${String(index + 1)}" ${described(field)}>${options(REGION_OPTIONS, region, "Region")}</select>`,
                ),
              )
              .join(""),
          );
        case "codes":
          return editRow(
            field,
            draft.codes
              .map((code, index) =>
                listLine(
                  field,
                  index,
                  `<input class="profile-edit-text is-club-code" type="text" data-field="codes" data-index="${String(index)}" value="${escapeHtml(code)}" maxlength="7" autocomplete="off" spellcheck="false" aria-label="Club code ${String(index + 1)}" ${described(field)}>`,
                ),
              )
              .join(""),
          );
        case "uniforms":
          return editRow(
            field,
            [
              `<select class="profile-edit-select" data-field="firstUniform" aria-label="First uniform" ${described(field)}>${options(UNIFORM_OPTIONS, draft.firstUniform, "First colour")}</select>`,
              `<select class="profile-edit-select" data-field="secondUniform" aria-label="Second uniform" ${described(field)}>${options(UNIFORM_OPTIONS, draft.secondUniform, "Second colour")}</select>`,
            ].join(""),
          );
        case "stadium":
          return editRow(
            field,
            `<select class="profile-edit-select" data-field="stadium" aria-labelledby="${fieldId(field)}-label" ${described(field)}>${options(STADIUM_OPTIONS, draft.stadium, "No stadium")}</select>`,
          );
        case "discord":
          return editRow(
            field,
            textInput(field, draft.discordUrl, 'inputmode="url" placeholder="https://discord.gg/…"'),
          );
      }
    }
    switch (field) {
      case "name":
        return viewRow(field, value(draft.name || "-"), !draft.name);
      case "tag":
        return viewRow(field, value(draft.tag || "-"), !draft.tag);
      case "status": {
        const status = draft.isOpen === null ? "" : draft.isOpen ? CLUB_STATUS_OPEN : CLUB_STATUS_INVITE_ONLY;
        return viewRow(
          field,
          `<span class="player-popup-code-value club-edit-status">${statusHtml(status)}</span>`,
          !status,
        );
      }
      case "regions": {
        const regions = draft.regions.filter(Boolean);
        return viewRow(
          field,
          regions.length
            ? `<span class="club-edit-badges">${regions.map(regionBadgeHtml).join("")}</span>`
            : value("No region saved"),
          !regions.length,
        );
      }
      case "codes": {
        const codes = draft.codes.map((code) => code.trim()).filter(Boolean);
        return viewRow(field, value(codes.length ? codes.join(" | ") : "No club code saved"), !codes.length);
      }
      case "uniforms": {
        const icons = uniformIconHtml("first", draft.firstUniform) + uniformIconHtml("second", draft.secondUniform);
        const names = [draft.firstUniform, draft.secondUniform].filter(Boolean).join(" / ");
        return viewRow(field, icons ? `${icons}${value(names)}` : value("No uniforms saved"), !icons);
      }
      case "stadium":
        return viewRow(field, value(draft.stadium || "No stadium saved"), !draft.stadium);
      case "discord": {
        const url = discordInviteUrl(draft.discordUrl);
        return viewRow(
          field,
          url
            ? `<a class="player-popup-code-value club-edit-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(draft.discordUrl)}</a>`
            : value(draft.discordUrl || "No Discord server saved"),
          !draft.discordUrl,
        );
      }
    }
  }

  function sectionHtml(field: ClubField): string {
    const add =
      isOpen(field) && (field === "regions" || field === "codes") && canAddLine(draft, field)
        ? `<span class="profile-section-actions">${iconButton(`data-edit-action="add" data-field="${field}"`, field === "regions" ? "Add a region" : "Add a club code", ICONS.plus)}</span>`
        : "";
    return [
      `<section class="player-popup-section club-edit-section" data-club-section="${field}">`,
      add,
      `<h3 id="${fieldId(field)}-label" class="player-popup-section-title">${escapeHtml(LABELS[field])}</h3>`,
      `<div class="player-popup-code-list">${lineHtml(field)}</div>`,
      "</section>",
    ].join("");
  }

  // -------------------------------------------------------------------------------------------------
  // Save bar (settings) or CREATE CLUB (a new club)

  const bar = creating
    ? null
    : createEditBar(root, {
        label: "Club settings changes",
        unsaved: MESSAGES.unsaved,
        saving: MESSAGES.saving,
        confirmDiscard: MESSAGES.confirmDiscard,
      });

  function createActionsHtml(): string {
    return [
      '<p class="profile-state-actions club-create-actions">',
      `<button class="profile-action-button is-primary" type="button" data-edit-action="create"${saving ? ' aria-disabled="true"' : ""}>${saving ? MESSAGES.creating : "Create Club"}</button>`,
      config.cancel
        ? ' <button class="profile-action-button" type="button" data-edit-action="cancel">Cancel</button>'
        : "",
      "</p>",
    ].join("");
  }

  function renderBar(): void {
    bar?.render({ hidden: !editable, dirty: dirty(), saving, confirming });
  }

  // -------------------------------------------------------------------------------------------------
  // State on screen

  function refresh(): void {
    const changed = creating ? new Set<ClubField>() : changedFields(draft, saved);
    for (const row of Array.from(mount.querySelectorAll<HTMLElement>("[data-field-row]"))) {
      const unsaved = changed.has(row.dataset.fieldRow as ClubField);
      row.classList.toggle("is-unsaved", unsaved);
      const note = row.querySelector<HTMLElement>(":scope > [data-unsaved-note]");
      if (note) note.hidden = !unsaved;
    }
    renderBar();
  }

  function render(): void {
    renders += 1;
    mount.innerHTML = fields.map(sectionHtml).join("") + (creating ? createActionsHtml() : "");
    for (const control of Array.from(mount.querySelectorAll<HTMLElement>("[data-edit-row] :is(input, select)"))) {
      const field = control.closest<HTMLElement>("[data-edit-row]")?.dataset.fieldRow as ClubField | undefined;
      control.toggleAttribute("aria-invalid", field ? errors.has(field) : false);
    }
    refresh();
  }

  function showFieldError(field: ClubField, messages: readonly string[]): void {
    const next = new Map(errors);
    if (messages.length) next.set(field, messages);
    else next.delete(field);
    errors = next;
    const node = mount.querySelector<HTMLElement>(`#${CSS.escape(`${fieldId(field)}-error`)}`);
    if (node) {
      node.textContent = messages.join(" ");
      node.hidden = !messages.length;
    }
  }

  function focusField(field: ClubField): void {
    const row = mount.querySelector<HTMLElement>(`[data-field-row="${field}"]`);
    (row?.querySelector<HTMLElement>("select, input") ?? row?.querySelector<HTMLElement>("[data-edit-open]"))?.focus();
  }

  function focusFirstError(): void {
    const first = fields.find((field) => errors.has(field));
    if (first) focusField(first);
  }

  // -------------------------------------------------------------------------------------------------
  // Changing the draft

  function readControl(control: HTMLInputElement | HTMLSelectElement): void {
    const field = control.dataset.field ?? "";
    const index = Number(control.dataset.index ?? -1);
    const text = control.value;
    const replaceAt = (list: readonly string[]): string[] => list.map((entry, at) => (at === index ? text : entry));
    switch (field) {
      case "name":
        draft = { ...draft, name: text };
        break;
      case "tag":
        draft = { ...draft, tag: text };
        break;
      case "status":
        draft = { ...draft, isOpen: text === "" ? null : text === "open" };
        break;
      case "regions":
        draft = { ...draft, regions: replaceAt(draft.regions) };
        break;
      case "codes":
        draft = { ...draft, codes: replaceAt(draft.codes) };
        break;
      case "firstUniform":
        draft = { ...draft, firstUniform: text };
        break;
      case "secondUniform":
        draft = { ...draft, secondUniform: text };
        break;
      case "stadium":
        draft = { ...draft, stadium: text };
        break;
      case "discord":
        draft = { ...draft, discordUrl: text };
        break;
      default:
        return;
    }
    const row = control.closest<HTMLElement>("[data-edit-row]")?.dataset.fieldRow as ClubField | undefined;
    if (row && errors.has(row)) showFieldError(row, []);
    refresh();
  }

  function openField(field: ClubField): void {
    if (saving || !editable) return;
    confirming = false;
    openFields.add(field);
    render();
    focusField(field);
  }

  /** Escape on an open line: back to what is saved, and closed (a new club's lines stay open). */
  function revertField(field: ClubField): void {
    if (creating) return;
    const base = createDraft(saved);
    switch (field) {
      case "status":
        draft = { ...draft, isOpen: base.isOpen };
        break;
      case "regions":
        draft = { ...draft, regions: base.regions };
        break;
      case "codes":
        draft = { ...draft, codes: base.codes };
        break;
      case "uniforms":
        draft = { ...draft, firstUniform: base.firstUniform, secondUniform: base.secondUniform };
        break;
      case "stadium":
        draft = { ...draft, stadium: base.stadium };
        break;
      case "discord":
        draft = { ...draft, discordUrl: base.discordUrl };
        break;
      default:
        break;
    }
    openFields.delete(field);
    showFieldError(field, []);
    render();
    focusField(field);
  }

  function addLine(field: "regions" | "codes"): void {
    if (saving || !canAddLine(draft, field)) return;
    draft =
      field === "regions" ? { ...draft, regions: [...draft.regions, ""] } : { ...draft, codes: [...draft.codes, ""] };
    render();
    const controls = mount.querySelectorAll<HTMLElement>(`[data-field-row="${field}"] [data-index]:is(input, select)`);
    controls[controls.length - 1]?.focus();
  }

  function removeLine(field: "regions" | "codes", index: number): void {
    if (saving) return;
    const drop = (list: readonly string[]): string[] => list.filter((_, at) => at !== index);
    draft = field === "regions" ? { ...draft, regions: drop(draft.regions) } : { ...draft, codes: drop(draft.codes) };
    render();
    focusField(field);
  }

  function discard(): void {
    draft = createDraft(saved);
    openFields.clear();
    errors = new Map();
    confirming = false;
    render();
    showToast({ text: MESSAGES.discarded, level: "info" });
    mount.querySelector<HTMLElement>("[data-edit-open]")?.focus();
  }

  // -------------------------------------------------------------------------------------------------
  // Saving

  async function submit(): Promise<void> {
    if (saving || !editable || (!creating && !dirty())) return;
    confirming = false;
    const checked = creating ? checkNewClub(draft) : checkSettings(draft, saved);
    if (!checked.ok) {
      errors = checked.errors;
      for (const field of errors.keys()) openFields.add(field);
      render();
      focusFirstError();
      showToast({ text: MESSAGES.checkFields, level: "error" });
      return;
    }
    saving = true;
    if (creating) render();
    else renderBar();
    const result = await config.submit(creating ? checked.request : { version, ...checked.request });
    saving = false;
    switch (result.kind) {
      case "done":
        if (!creating) {
          // The answer's settings are what is saved now (setSaved ran with them), in their stored form: a link
          // typed as "discord.gg/…" comes back with https://, so the draft starts over from them.
          draft = createDraft(saved);
          openFields.clear();
          errors = new Map();
          render();
          showToast({ text: MESSAGES.saved, level: "success" });
        }
        return;
      case "fields":
        errors = errorsByField(result.fields);
        for (const field of errors.keys()) openFields.add(field);
        render();
        focusFirstError();
        showToast({ text: MESSAGES.checkFields, level: "error" });
        return;
      case "changed": {
        const rebased = rebaseDraft(draft, saved, result.saved);
        saved = result.saved;
        version = result.version;
        draft = rebased.draft;
        errors = new Map([...rebased.conflicts].map((field) => [field, [MESSAGES.conflict]]));
        for (const field of errors.keys()) openFields.add(field);
        render();
        showToast({
          text: [MESSAGES.changedElsewhere, dirty() ? MESSAGES.checkAgain : ""].filter(Boolean).join(" "),
          level: "error",
        });
        focusFirstError();
        return;
      }
      case "failed":
        if (creating) render();
        else renderBar();
        return;
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Events

  // A click outside an open line closes it (not on a new club's form, whose lines stay open); the draft keeps
  // what was entered, and a blank region or club code line goes. As on the profile page, the lines are drawn
  // anew only once the click has passed, so it still reaches a pencil, "+", SAVE or DISCARD.
  let closedAt: number | null = null;
  function closeFieldsOutside(event: MouseEvent): void {
    if (!mount.isConnected) {
      document.removeEventListener("click", closeFieldsOutside, true);
      document.removeEventListener("click", drawClosedFields);
      return;
    }
    if (creating || !openFields.size || saving) return;
    const target = event.target instanceof Node ? event.target : null;
    const closing = [...openFields].filter(
      (field) => !mount.querySelector(`[data-club-section="${field}"]`)?.contains(target),
    );
    if (!closing.length) return;
    for (const field of closing) {
      openFields.delete(field);
      draft = withoutBlankLines(draft, field);
    }
    closedAt = renders;
    window.setTimeout(drawClosedFields, 0);
  }
  function drawClosedFields(): void {
    if (closedAt === null) return;
    const drawn = closedAt;
    closedAt = null;
    if (mount.isConnected && renders === drawn) render();
  }
  document.addEventListener("click", closeFieldsOutside, true);
  document.addEventListener("click", drawClosedFields);

  root.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || !(mount.contains(element) || element.closest(".profile-edit-bar"))) return;
    const opener = element.closest<HTMLElement>("[data-edit-open]");
    if (opener) {
      openField(opener.dataset.editOpen as ClubField);
      return;
    }
    const trigger = element.closest<HTMLElement>("[data-edit-action]");
    if (!trigger || (trigger instanceof HTMLButtonElement && trigger.disabled) || saving) return;
    const listField = trigger.dataset.field === "codes" ? "codes" : "regions";
    switch (trigger.dataset.editAction) {
      case "save":
      case "create":
        void submit();
        break;
      case "cancel":
        config.cancel?.();
        break;
      case "discard":
        if (dirty()) {
          confirming = true;
          renderBar();
          bar?.button("discard-confirm")?.focus();
        }
        break;
      case "keep":
        confirming = false;
        renderBar();
        bar?.button("discard")?.focus();
        break;
      case "discard-confirm":
        discard();
        break;
      case "add":
        addLine(listField);
        break;
      case "remove":
        removeLine(listField, Number(trigger.dataset.index ?? -1));
        break;
    }
  });
  mount.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement) readControl(event.target);
  });
  mount.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement) readControl(event.target);
  });
  mount.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest<HTMLElement>("[data-edit-row]");
    if (!row) return;
    if (event.key === "Escape") {
      event.preventDefault();
      revertField(row.dataset.fieldRow as ClubField);
    } else if (event.key === "Enter" && !(target instanceof HTMLButtonElement)) {
      event.preventDefault();
      void submit();
    }
  });
  root.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === "Escape" && confirming && target?.closest(".profile-edit-bar")) {
      event.preventDefault();
      confirming = false;
      renderBar();
      bar?.button("discard")?.focus();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty() && mount.isConnected) event.preventDefault();
  });
  if (bar) window.addEventListener("resize", bar.place);

  render();

  return {
    setSaved(next, nextVersion) {
      if (creating || nextVersion === version) return;
      const rebased = rebaseDraft(draft, saved, next);
      saved = next;
      version = nextVersion;
      draft = rebased.draft;
      render();
    },
    isDirty: dirty,
  };
}
