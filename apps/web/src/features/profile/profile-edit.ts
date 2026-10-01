// Editing on the profile page itself: a pencil on every line that can change (the country in the title
// bar, the Switch code, each MSC code), "−" to delete an MSC code and "+" to add one (at most three). One
// line is open at a time; Save (✓, Enter) sends the whole profile with that one change through
// PUT /api/profile/me/editable, Cancel (✕, Escape) leaves it as it was. When the profile was changed
// elsewhere meanwhile (in Discord), the page shows what is saved now and the change stays open to be saved
// again, so nothing is overwritten unseen.

import { escapeHtml } from "@ms/shared/html";
import { LEGACY_MSC_REGIONS, MSC_PLATFORMS, MSC_REGIONS, type FieldError } from "@ms/shared/friend-codes";
import { loginPath } from "@ms/shared/site/navigation";
import { countryDisplayName, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import { bindFriendCodeInput } from "./friend-code-input.ts";
import {
  canAddMscCode,
  checkEdit,
  isChanged,
  rebaseEdit,
  savedText,
  startEdit,
  type Blocks,
  type Edit,
  type EditableProfile,
  type EditTarget,
} from "./profile-edit-state.ts";

const API_URL = "/api/profile/me/editable";
const DRAFT_KEY = "ms-profile-edit-draft";

const MESSAGES = {
  saving: "Saving…",
  saved: "Changes saved.",
  unchanged: "Nothing was changed.",
  saveFailed: "Your change could not be saved right now. Please try again.",
  tooMany: "Too many requests. Please try again in a minute.",
  notMember: "Only members of the Mario Strikers Discord server can change their profile.",
  loginExpired: "Your login has expired. Your change is kept for the next login.",
  finishFirst: "Save or cancel this change first.",
  changedElsewhere: "Your profile was changed elsewhere (for example in Discord) meanwhile.",
  checkAgain: "Check your change and save again.",
  draftRestored: "Your unsaved change from before the login is back. Check it and save.",
  missingPlatform: "Select the platform.",
} as const;

const icon = (paths: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${paths}</svg>`;

const ICONS = {
  pencil: icon('<path d="M11.4 1.6 14.4 4.6 5.3 13.7 1.6 14.4 2.3 10.7Z" fill="currentColor"/>'),
  minus: icon('<rect x="2.5" y="7" width="11" height="2" fill="currentColor"/>'),
  plus: icon('<path d="M7 2.5h2V7h4.5v2H9v4.5H7V9H2.5V7H7Z" fill="currentColor"/>'),
  check: icon('<path d="M6.2 11.3 2.9 8 1.5 9.4l4.7 4.7 8.3-8.3L13.1 4.4Z" fill="currentColor"/>'),
  cross: icon(
    '<path d="M3.9 2.5 8 6.6l4.1-4.1 1.4 1.4L9.4 8l4.1 4.1-1.4 1.4L8 9.4l-4.1 4.1-1.4-1.4L6.6 8 2.5 3.9Z" fill="currentColor"/>',
  ),
} as const;

interface Status {
  readonly text: string;
  readonly level: "info" | "success" | "error";
  readonly link?: { readonly href: string; readonly label: string };
}

interface OpenEdit {
  readonly target: EditTarget;
  /** The saved value when the edit opened, to tell whether it was changed elsewhere meanwhile. */
  readonly startedFrom: string;
  /** Values to fill the line with instead of the saved ones (after a conflict or a login). */
  readonly values: Edit | null;
  readonly message: string;
}

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

export interface ProfileEditor {
  /** Focuses the first pencil (the account menu's "Modify Profile"). */
  focusFirst(): void;
}

function countryName(code: string, profile: EditableProfile): string {
  const fallback = profile.countries.find((country) => country.code === code)?.name ?? code;
  return countryDisplayName(normalizeCountryCode(code)) || fallback;
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

function digitFields(label: string, blocks: Blocks): string {
  const field = (index: number): string =>
    `<input class="profile-edit-digits" type="text" inputmode="numeric" autocomplete="off" maxlength="4" spellcheck="false" enterkeyhint="${index === 2 ? "done" : "next"}" value="${escapeHtml(blocks[index] ?? "")}" aria-label="${escapeHtml(label)}, digits ${index * 4 + 1} to ${index * 4 + 4}">`;
  const dash = '<span class="profile-edit-dash" aria-hidden="true">-</span>';
  return field(0) + dash + field(1) + dash + field(2);
}

function iconButton(attributes: string, label: string, svg: string, className = "profile-edit-icon"): string {
  return `<button class="${className}" type="button" ${attributes} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${svg}</button>`;
}

function actionButtons(saveLabel: string): string {
  return (
    '<span class="profile-edit-actions">' +
    iconButton('data-edit-action="save"', saveLabel, ICONS.check, "profile-edit-icon is-save") +
    iconButton('data-edit-action="cancel"', "Cancel", ICONS.cross) +
    "</span>"
  );
}

/** A code line as it reads, e.g. "PAL (Wii): 1234-5678-9012". */
function lineText(row: Element): string {
  return Array.from(row.querySelectorAll(".player-popup-code-prefix, .player-popup-code-value"), (node) =>
    node.textContent.trim(),
  )
    .filter(Boolean)
    .join(" ");
}

/** Adds editing to the profile card; the card is rendered anew after every save (`reload`). */
export function createProfileEditor({ root, profile: initial, reload }: ProfileEditorOptions): ProfileEditor {
  let profile = initial;
  let open: OpenEdit | null = null;
  let saving = false;
  let status: Status | null = null;

  const blocked = (): boolean => profile.discord.membership === "not_member";
  const content = (): HTMLElement | null => root.querySelector<HTMLElement>(".player-popup-content");
  const list = (key: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-list="${key}"]`);
  const editRow = (): HTMLElement | null => root.querySelector<HTMLElement>("[data-edit-row]");
  const nameOf = (code: string): string => countryName(code, profile);

  // -------------------------------------------------------------------------------------------------
  // Status line

  function renderStatus(): void {
    const mount = content();
    if (!mount) return;
    let line = mount.querySelector<HTMLElement>(":scope > .profile-edit-status");
    if (!line) {
      line = document.createElement("p");
      line.className = "profile-edit-status";
      line.setAttribute("role", "status");
      mount.prepend(line);
    }
    line.innerHTML = status
      ? escapeHtml(status.text) +
        (status.link ? ` <a href="${escapeHtml(status.link.href)}">${escapeHtml(status.link.label)}</a>` : "")
      : "";
    line.hidden = !status;
    line.classList.toggle("is-success", status?.level === "success");
    line.classList.toggle("is-error", status?.level === "error");
  }

  function setStatus(next: Status | null): void {
    status = next;
    renderStatus();
  }

  // -------------------------------------------------------------------------------------------------
  // The lines and their buttons

  function editButton(kind: string, label: string, svg: string, code = ""): string {
    return iconButton(`data-edit="${kind}"${code ? ` data-code="${escapeHtml(code)}"` : ""}`, label, svg);
  }

  function missingRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "player-popup-code-row profile-code-missing";
    row.innerHTML = '<span class="player-popup-code-value">No code saved</span>';
    return row;
  }

  function addActions(container: HTMLElement, className: string, html: string, first = false): void {
    const actions = document.createElement("span");
    actions.className = className;
    actions.innerHTML = html;
    if (first) container.prepend(actions);
    else container.append(actions);
  }

  function showSection(mount: HTMLElement): void {
    const section = mount.closest<HTMLElement>(".player-popup-section");
    if (section) section.hidden = false;
  }

  function renderHeader(): void {
    const header = root.querySelector<HTMLElement>(".player-popup-header");
    if (header) {
      addActions(header, "profile-header-actions", editButton("country", "Change your country", ICONS.pencil));
    }
  }

  function renderSwitch(): void {
    const mount = list("fc-switch");
    if (!mount) return;
    showSection(mount);
    let row = mount.querySelector<HTMLElement>(".player-popup-code-row");
    if (!row) {
      row = missingRow();
      mount.append(row);
    }
    row.dataset.editTarget = "switch";
    addActions(row, "profile-row-actions", editButton("switch", "Change your Switch friend code", ICONS.pencil));
  }

  function renderMsc(): void {
    const mount = list("fc-msc");
    if (!mount) return;
    showSection(mount);
    const rows = Array.from(mount.querySelectorAll<HTMLElement>(".player-popup-code-row"));
    for (const row of rows) {
      const code = row.querySelector(".player-popup-code-value")?.textContent.trim() ?? "";
      const saved = profile.msc_codes.find((entry) => entry.code === code);
      if (!saved) continue;
      const label = lineText(row);
      row.dataset.editTarget = `msc:${code}`;
      addActions(
        row,
        "profile-row-actions",
        editButton("msc", `Change MSC friend code ${label}`, ICONS.pencil, code) +
          editButton("msc-delete", `Delete MSC friend code ${label}`, ICONS.minus, code),
      );
      // An older code saved without a platform asks for one.
      if (!saved.platform) {
        const hint = document.createElement("p");
        hint.className = "profile-row-hint";
        hint.textContent = MESSAGES.missingPlatform;
        row.after(hint);
      }
    }
    if (!rows.length) mount.append(missingRow());
    const section = mount.closest<HTMLElement>(".player-popup-section");
    if (section && canAddMscCode(profile)) {
      addActions(section, "profile-section-actions", editButton("msc-add", "Add an MSC friend code", ICONS.plus), true);
    }
  }

  function clearControls(): void {
    const added = ".profile-row-actions, .profile-section-actions, .profile-header-actions, .profile-row-hint";
    for (const node of Array.from(root.querySelectorAll(`${added}, .profile-code-missing, [data-edit-row]`))) {
      node.remove();
    }
    for (const node of Array.from(root.querySelectorAll<HTMLElement>("[data-edit-target]"))) {
      node.hidden = false;
      delete node.dataset.editTarget;
    }
  }

  function renderControls(): void {
    clearControls();
    if (blocked() && !status) status = { text: MESSAGES.notMember, level: "info" };
    renderStatus();
    if (blocked()) return;
    renderHeader();
    renderSwitch();
    renderMsc();
    if (open) renderEditRow(open);
  }

  // -------------------------------------------------------------------------------------------------
  // The open line

  function targetRow(target: EditTarget): HTMLElement | null {
    if (target.kind === "country") return null;
    const key = target.kind === "switch" ? "switch" : `msc:${target.code ?? ""}`;
    return root.querySelector<HTMLElement>(`[data-edit-target="${CSS.escape(key)}"]`);
  }

  function editRowHtml(edit: Edit): string {
    switch (edit.kind) {
      case "country": {
        const entries = profile.countries
          .map((country) => ({ value: country.code, label: nameOf(country.code) }))
          .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
        return [
          '<label class="profile-edit-label" for="profile-edit-country">Country</label>',
          `<select id="profile-edit-country" class="profile-edit-select" data-field="country">${options(entries, edit.country, "No country")}</select>`,
          '<img class="profile-edit-flag" data-slot="edit-flag" src="" alt="" width="27" height="18" hidden>',
          actionButtons("Save the country"),
        ].join("");
      }
      case "switch":
        return [
          '<span class="profile-edit-code" role="group" aria-label="Switch friend code">',
          '<span class="profile-edit-prefix" aria-hidden="true">SW-</span>',
          digitFields("Switch friend code", edit.blocks),
          iconButton('data-edit-action="clear"', "Clear the code", ICONS.cross, "profile-edit-icon is-clear"),
          "</span>",
          actionButtons("Save the Switch friend code"),
        ].join("");
      case "msc": {
        const regions: { value: string; label: string }[] = MSC_REGIONS.map((region) => ({ ...region }));
        // An older NTSC-J/K code keeps its region; no new code gets one.
        const legacy = Object.hasOwn(LEGACY_MSC_REGIONS, edit.region) ? LEGACY_MSC_REGIONS[edit.region] : undefined;
        if (legacy) regions.push({ value: edit.region, label: `${legacy} (no new codes)` });
        const platforms = MSC_PLATFORMS.map((platform) => ({ value: platform, label: platform }));
        return [
          `<select class="profile-edit-select" data-field="region" aria-label="MSC friend code, region">${options(regions, edit.region, "Region")}</select>`,
          `<select class="profile-edit-select" data-field="platform" aria-label="MSC friend code, platform">${options(platforms, edit.platform, "Platform")}</select>`,
          '<span class="profile-edit-code" role="group" aria-label="MSC friend code">',
          digitFields("MSC friend code", edit.blocks),
          "</span>",
          actionButtons(edit.original === null ? "Add the MSC friend code" : "Save the MSC friend code"),
        ].join("");
      }
      case "msc-delete": {
        const row = targetRow({ kind: "msc", code: edit.code });
        return [
          `<span class="profile-edit-question">Delete ${escapeHtml(row ? lineText(row) : edit.code)}?</span>`,
          actionButtons("Delete the MSC friend code"),
        ].join("");
      }
    }
  }

  function renderEditRow(state: OpenEdit): void {
    const edit = state.values ?? startEdit(profile, state.target);
    const row = document.createElement("div");
    row.className = `profile-edit-row is-${edit.kind}`;
    row.dataset.editRow = edit.kind;
    row.innerHTML = editRowHtml(edit) + '<p class="profile-edit-error" role="alert" hidden></p>';
    const anchor = targetRow(
      state.target.kind === "msc-delete" ? { kind: "msc", code: state.target.code } : state.target,
    );
    if (state.target.kind === "country") {
      const mount = content();
      const club = mount?.querySelector(":scope > .profile-club-line");
      if (club) club.after(row);
      else mount?.prepend(row);
    } else if (anchor) {
      anchor.hidden = true;
      anchor.after(row);
    } else {
      const mount = list("fc-msc");
      mount?.querySelector<HTMLElement>(".profile-code-missing")?.setAttribute("hidden", "");
      mount?.append(row);
    }
    const fields = Array.from(row.querySelectorAll<HTMLInputElement>(".profile-edit-digits"));
    if (fields.length) bindFriendCodeInput(fields, { onChange: () => undefined, onRejected: showError });
    renderFlag();
    showError(state.message);
    (
      row.querySelector<HTMLElement>("select, input") ?? row.querySelector<HTMLElement>("[data-edit-action='save']")
    )?.focus();
  }

  function renderFlag(): void {
    const select = root.querySelector<HTMLSelectElement>("[data-edit-row] [data-field='country']");
    const flag = root.querySelector<HTMLImageElement>("[data-slot='edit-flag']");
    if (!select || !flag) return;
    const code = normalizeCountryCode(select.value);
    flag.hidden = !code;
    if (code) flag.src = flagUrl(code);
    else flag.removeAttribute("src");
  }

  function showError(message: string): void {
    const node = editRow()?.querySelector<HTMLElement>(".profile-edit-error");
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  }

  /** The open line's values. */
  function readEdit(): Edit | null {
    const row = editRow();
    if (!open || !row) return null;
    const value = (field: string): string =>
      row.querySelector<HTMLSelectElement>(`[data-field="${field}"]`)?.value ?? "";
    const digits = Array.from(row.querySelectorAll<HTMLInputElement>(".profile-edit-digits")).map(
      (field) => field.value,
    );
    const blocks: Blocks = [digits[0] ?? "", digits[1] ?? "", digits[2] ?? ""];
    const target = open.target;
    switch (target.kind) {
      case "country":
        return { kind: "country", country: value("country") };
      case "switch":
        return { kind: "switch", blocks };
      case "msc-delete":
        return { kind: "msc-delete", code: target.code };
      case "msc":
        return { kind: "msc", original: target.code, region: value("region"), platform: value("platform"), blocks };
    }
  }

  function dirty(): boolean {
    const edit = readEdit();
    return edit ? isChanged(profile, edit) : false;
  }

  function openEdit(target: EditTarget, values: Edit | null = null, message = ""): void {
    if (saving) return;
    if (open) {
      if (JSON.stringify(open.target) === JSON.stringify(target)) return;
      if (dirty()) {
        showError(MESSAGES.finishFirst);
        editRow()?.querySelector<HTMLElement>("select, input, [data-edit-action='save']")?.focus();
        return;
      }
      closeEdit(false);
    }
    const start = values ?? startEdit(profile, target);
    open = { target, startedFrom: savedText(profile, start, nameOf), values, message };
    if (status?.level === "success") setStatus(null);
    renderEditRow(open);
  }

  /** Focus on the pencil of a line after it closed, or on "+" (or the country) when the line is gone. */
  function focusLine(target: EditTarget | null): void {
    let selector = "[data-edit='msc-add'], [data-edit='country']";
    if (target?.kind === "country" || target?.kind === "switch") selector = `[data-edit='${target.kind}']`;
    else if (target?.kind === "msc" && target.code)
      selector = `[data-edit='msc'][data-code="${CSS.escape(target.code)}"]`;
    root.querySelector<HTMLElement>(selector)?.focus();
  }

  function closeEdit(focus = true): void {
    const target = open?.target ?? null;
    open = null;
    editRow()?.remove();
    for (const node of Array.from(root.querySelectorAll<HTMLElement>("[data-edit-target], .profile-code-missing"))) {
      node.hidden = false;
    }
    if (focus) focusLine(target);
  }

  // -------------------------------------------------------------------------------------------------
  // Saving

  function saveDraft(target: EditTarget, edit: Edit): void {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ id: profile.discord.id, target, edit }));
    } catch {
      // Storage may be unavailable (private mode); the line stays open either way.
    }
  }

  function setRowDisabled(disabled: boolean): void {
    for (const node of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-edit-row] button"))) {
      node.disabled = disabled;
    }
  }

  /** The target of an edit that became something else (a code removed elsewhere is added anew). */
  function rebaseTarget(target: EditTarget, edit: Edit): EditTarget {
    return edit.kind === "msc" && edit.original === null ? { kind: "msc", code: null } : target;
  }

  async function save(): Promise<void> {
    if (saving || !open) return;
    const edit = readEdit();
    if (!edit) return;
    const checked = checkEdit(profile, edit);
    if (!checked.ok) {
      showError(checked.errors.join(" "));
      return;
    }
    const state = open;
    saving = true;
    setStatus({ text: MESSAGES.saving, level: "info" });
    setRowDisabled(true);
    try {
      const response = await fetch(API_URL, {
        method: "PUT",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ version: profile.version, ...checked.request }),
      });
      const body = (await response.json().catch(() => ({}))) as EditableProfile & ErrorBody & { changed?: boolean };
      if (response.ok) {
        profile = body;
        open = null;
        status = { text: body.changed === false ? MESSAGES.unchanged : MESSAGES.saved, level: "success" };
        await reload();
        renderControls();
        // The pencil of the saved line; a changed or new MSC code is found by its new digits.
        if (edit.kind === "msc") focusLine({ kind: "msc", code: edit.blocks.join("-") });
        else focusLine(edit.kind === "msc-delete" ? null : state.target);
        return;
      }
      if (response.status === 409 && body.code === "PROFILE_CHANGED" && body.current) {
        const current = body.current;
        const rebased = rebaseEdit(edit, current);
        const now = savedText(current, edit, (code) => countryName(code, current));
        const notes = [
          MESSAGES.changedElsewhere,
          now !== state.startedFrom ? `Saved now: ${now}.` : "",
          rebased.note,
          rebased.edit ? MESSAGES.checkAgain : "",
        ].filter(Boolean);
        profile = current;
        open = rebased.edit
          ? {
              target: rebaseTarget(state.target, rebased.edit),
              startedFrom: now,
              values: rebased.edit,
              message: notes.join(" "),
            }
          : null;
        status = rebased.edit ? null : { text: notes.join(" "), level: "info" };
        await reload();
        renderControls();
        return;
      }
      setStatus(null);
      if (body.fields?.length) {
        showError([...new Set(body.fields.map((error) => error.message))].join(" "));
      } else if (response.status === 401) {
        saveDraft(state.target, edit);
        setStatus({
          text: MESSAGES.loginExpired,
          level: "error",
          link: { href: loginPath("/profile"), label: "Log in again" },
        });
      } else if (body.code === "NOT_GUILD_MEMBER") {
        profile = { ...profile, discord: { ...profile.discord, membership: "not_member" } };
        open = null;
        status = { text: MESSAGES.notMember, level: "error" };
        renderControls();
      } else {
        showError(response.status === 429 ? MESSAGES.tooMany : MESSAGES.saveFailed);
      }
    } catch {
      setStatus(null);
      showError(MESSAGES.saveFailed);
    } finally {
      saving = false;
      setRowDisabled(false);
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Events

  root.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const trigger = element?.closest<HTMLElement>("[data-edit]");
    if (trigger) {
      const code = trigger.dataset.code ?? "";
      const kind = trigger.dataset.edit;
      if (kind === "country" || kind === "switch") openEdit({ kind });
      else if (kind === "msc") openEdit({ kind: "msc", code });
      else if (kind === "msc-add") openEdit({ kind: "msc", code: null });
      else if (kind === "msc-delete") openEdit({ kind: "msc-delete", code });
      return;
    }
    const action = element?.closest<HTMLElement>("[data-edit-action]")?.dataset.editAction;
    if (action === "save") void save();
    else if (action === "cancel") closeEdit();
    else if (action === "clear") {
      const fields = Array.from(root.querySelectorAll<HTMLInputElement>("[data-edit-row] .profile-edit-digits"));
      for (const field of fields) field.value = "";
      fields[0]?.focus();
    }
  });
  root.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-edit-row]")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeEdit();
    } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      void save();
    }
  });
  root.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement && event.target.dataset.field === "country") renderFlag();
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty()) event.preventDefault();
  });

  renderControls();

  // A change kept when the login expired comes back after the next login (same Discord account only).
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    const draft = raw ? (JSON.parse(raw) as { id?: string; target?: EditTarget; edit?: Edit }) : null;
    if (draft?.id === profile.discord.id && draft.target && draft.edit && !blocked()) {
      const rebased = rebaseEdit(draft.edit, profile);
      if (rebased.edit) openEdit(rebaseTarget(draft.target, rebased.edit), rebased.edit, MESSAGES.draftRestored);
    }
  } catch {
    // A broken or unavailable draft is dropped.
  }

  return {
    focusFirst() {
      root.querySelector<HTMLElement>("[data-edit]")?.focus();
    },
  };
}
