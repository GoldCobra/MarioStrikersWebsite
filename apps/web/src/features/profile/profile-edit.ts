// The profile editor, a dialog on /profile: the member's Discord names (read only, from Discord), the
// country and the friend codes. Apply saves through PUT /api/profile/me/editable and keeps the dialog open
// with the saved values; Close (also ×, Escape and the backdrop) asks before unsaved changes are dropped.
// A profile changed elsewhere meanwhile (in Discord) is merged into the form instead of being overwritten.

import { escapeHtml } from "@ms/shared/html";
import { LEGACY_MSC_REGIONS, MSC_PLATFORMS, MSC_REGIONS, type FieldError } from "@ms/shared/friend-codes";
import { countryDisplayName, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import { TemplatePopup } from "../../lib/popup.ts";
import { bindFriendCodeInput } from "./friend-code-input.ts";
import {
  EMPTY_BLOCKS,
  fromEditable,
  isDirty,
  mergeChanges,
  toFormField,
  toRequest,
  type Blocks,
  type EditableProfile,
  type FormState,
  type Group,
  type MscRow,
} from "./profile-edit-state.ts";
import template from "./profile-edit-popup.html?raw";

const API_URL = "/api/profile/me/editable";
const LOGIN_AGAIN_URL = "/api/auth/discord/start?returnTo=%2Fprofile%3Fedit%3D1";
const DRAFT_KEY = "ms-profile-edit-draft";

const MESSAGES = {
  loadFailed: "Your profile could not be loaded right now. Please try again later.",
  loginExpired: "Your login has expired. Close this dialog and log in again.",
  checkFields: "Please check the marked fields.",
  saving: "Saving…",
  saved: "Changes saved.",
  unchanged: "Nothing was changed.",
  saveFailed: "Your changes could not be saved right now. They are still here; please try again.",
  tooMany: "Too many requests. Please try again in a minute.",
  notMember: "Only members of the Mario Strikers Discord server can change their profile.",
  changedElsewhere:
    "Your profile was changed elsewhere (for example in Discord) while this dialog was open. Your changes are kept; the marked parts show what was saved there. Check them and apply again.",
  draftRestored: "Your unsaved changes from before the login are back. Check them and apply.",
} as const;

interface Editor {
  profile: EditableProfile;
  /** The saved values the form started from: what "unsaved changes" are measured against. */
  base: FormState;
  saving: boolean;
  readonly onSaved: () => void;
}

let editor: Editor | null = null;

const popup = new TemplatePopup({
  template,
  openClass: "popup-open",
  closeButtonSelector: ".profile-edit-close",
  beforeClose: () => confirmClose(),
});

function root(): HTMLElement {
  return popup.ensure();
}

function form(): HTMLFormElement | null {
  return root().querySelector<HTMLFormElement>(".profile-edit-form");
}

function codeFields(group: string): HTMLInputElement[] {
  return Array.from(root().querySelectorAll<HTMLInputElement>(`[data-code="${group}"] .profile-edit-digits`));
}

function mscRow(index: number): HTMLElement | null {
  return root().querySelector<HTMLElement>(`[data-msc-row="${index}"]`);
}

function select(container: ParentNode | null, field: string): HTMLSelectElement | null {
  return container?.querySelector<HTMLSelectElement>(`[data-field="${field}"]`) ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Rendering

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

function countryName(code: string, fallback: string): string {
  return countryDisplayName(normalizeCountryCode(code)) || fallback.trim() || code;
}

function renderCountries(profile: EditableProfile, selected: string): void {
  const node = root().querySelector<HTMLSelectElement>("[data-slot='country']");
  if (!node) return;
  const entries = profile.countries
    .map((country) => ({ value: country.code, label: countryName(country.code, country.name) }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  node.innerHTML = options(entries, selected, "No country");
  renderFlag(selected);
}

function renderFlag(code: string): void {
  const flag = root().querySelector<HTMLImageElement>("[data-slot='flag']");
  if (!flag) return;
  const flagCode = normalizeCountryCode(code);
  flag.hidden = !flagCode;
  if (flagCode) flag.src = flagUrl(flagCode);
  else flag.removeAttribute("src");
}

function mscRowHtml(index: number, row: MscRow): string {
  const number = index + 1;
  const regions: { value: string; label: string }[] = MSC_REGIONS.map((region) => ({ ...region }));
  // An older NTSC-J/K code is shown as it is saved; it can be kept or deleted, not chosen for a new code.
  const legacy = Object.hasOwn(LEGACY_MSC_REGIONS, row.region) ? LEGACY_MSC_REGIONS[row.region] : undefined;
  if (legacy) regions.push({ value: row.region, label: `${legacy} (no new codes)` });
  const platforms = MSC_PLATFORMS.map((platform) => ({ value: platform, label: platform }));
  const digit = (block: number): string =>
    `<input class="profile-edit-digits" type="text" inputmode="numeric" autocomplete="off" maxlength="4" spellcheck="false" enterkeyhint="${block === 3 ? "done" : "next"}" value="${escapeHtml(row.blocks[block - 1] ?? "")}" aria-label="MSC friend code ${number}, digits ${block * 4 - 3} to ${block * 4}" aria-describedby="profile-edit-error-msc-${index}">`;
  return [
    `<li class="profile-edit-msc-row" data-msc-row="${index}">`,
    `<span class="profile-edit-msc-number" aria-hidden="true">${number}.</span>`,
    `<select class="profile-edit-select" data-field="region" aria-label="MSC friend code ${number}, region" aria-describedby="profile-edit-error-msc-${index}">${options(regions, row.region, "Region")}</select>`,
    `<select class="profile-edit-select" data-field="platform" aria-label="MSC friend code ${number}, platform" aria-describedby="profile-edit-error-msc-${index}">${options(platforms, row.platform, "Platform")}</select>`,
    `<div class="profile-edit-code" role="group" aria-label="MSC friend code ${number}" data-code="msc-${index}">`,
    digit(1),
    '<span class="profile-edit-code-dash" aria-hidden="true">-</span>',
    digit(2),
    '<span class="profile-edit-code-dash" aria-hidden="true">-</span>',
    digit(3),
    `<button class="profile-edit-clear" type="button" data-clear="msc-${index}" aria-label="Clear MSC friend code ${number}">×</button>`,
    "</div>",
    `<p id="profile-edit-error-msc-${index}" class="profile-edit-error" data-error="msc.${index}" hidden></p>`,
    "</li>",
  ].join("");
}

function setBlocks(fields: readonly HTMLInputElement[], blocks: Blocks): void {
  fields.forEach((field, index) => {
    field.value = blocks[index] ?? "";
  });
}

function renderNames(profile: EditableProfile): void {
  const { discord } = profile;
  popup.setText("server-name", discord.server_name || discord.username || "-");
  popup.setText("username", discord.username ? `@${discord.username}` : "-");
  const note = popup.slots["names-note"];
  if (!note) return;
  let text = "";
  if (discord.membership === "not_member") text = MESSAGES.notMember;
  else if (!discord.nick && discord.membership === "member")
    text = "No server nickname: Discord shows your display name.";
  else if (discord.source === "login") text = "As of your last login.";
  note.textContent = text;
  note.hidden = !text;
  note.classList.toggle("is-error", discord.membership === "not_member");
}

function renderForm(profile: EditableProfile, state: FormState): void {
  renderNames(profile);
  renderCountries(profile, state.country);
  setBlocks(codeFields("switch"), state.switchBlocks);
  const list = popup.lists.msc;
  if (list) list.innerHTML = state.msc.map((row, index) => mscRowHtml(index, row)).join("");
  for (let index = 0; index < 3; index += 1) {
    bindFriendCodeInput(codeFields(`msc-${index}`), { onChange: edited, onRejected: showPasteRejected });
  }
  clearMessages();
  refresh();
}

// ---------------------------------------------------------------------------------------------------
// Reading the form and showing its state

function readBlocks(group: string): Blocks {
  const values = codeFields(group).map((field) => field.value);
  return [values[0] ?? "", values[1] ?? "", values[2] ?? ""];
}

function readRow(index: number): MscRow {
  const row = mscRow(index);
  return {
    region: select(row, "region")?.value ?? "",
    platform: select(row, "platform")?.value ?? "",
    blocks: readBlocks(`msc-${index}`),
  };
}

function readForm(): FormState {
  return {
    country: root().querySelector<HTMLSelectElement>("[data-slot='country']")?.value ?? "",
    switchBlocks: readBlocks("switch"),
    msc: [readRow(0), readRow(1), readRow(2)],
  };
}

function dirty(): boolean {
  return editor ? isDirty(editor.base, readForm()) : false;
}

function warnBeforeLeaving(event: BeforeUnloadEvent): void {
  if (dirty()) event.preventDefault();
}

/** Apply is offered while there is something to save and nothing is being saved. */
function refresh(): void {
  const apply = root().querySelector<HTMLButtonElement>("[data-action='apply']");
  const blocked = editor?.profile.discord.membership === "not_member";
  if (apply) apply.disabled = !editor || editor.saving || blocked || !dirty();
}

/** After every edit by the user: "Changes saved." belongs to the values it saved, so an edit ends it. */
function edited(): void {
  if (popup.slots["save-status"]?.classList.contains("is-success")) setStatus("");
  refresh();
}

function setStatus(message: string, level?: "success" | "error"): void {
  const status = popup.slots["save-status"];
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-success", level === "success");
  status.classList.toggle("is-error", level === "error");
}

function setSummary(message: string, link?: { href: string; label: string }): void {
  const summary = popup.slots.summary;
  if (!summary) return;
  summary.innerHTML = message
    ? escapeHtml(message) + (link ? ` <a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>` : "")
    : "";
  summary.hidden = !message;
}

function clearMessages(): void {
  setSummary("");
  setStatus("");
  for (const node of Array.from(root().querySelectorAll<HTMLElement>("[data-error]"))) {
    node.textContent = "";
    node.hidden = true;
  }
  for (const node of Array.from(root().querySelectorAll("[aria-invalid='true']"))) node.removeAttribute("aria-invalid");
  for (const node of Array.from(root().querySelectorAll<HTMLElement>("[data-conflict]"))) {
    node.removeAttribute("data-conflict");
  }
}

function showPasteRejected(message: string): void {
  setStatus(message, "error");
}

/** The control a form error points at, for aria-invalid and the first focus. */
function controlsOf(field: string): HTMLElement[] {
  if (field === "country") return Array.from(root().querySelectorAll<HTMLElement>("[data-slot='country']"));
  if (field === "switch_code") return codeFields("switch");
  const match = /^msc\.(\d+)\.(region|platform|code)$/.exec(field);
  if (!match) return [];
  const index = Number(match[1]);
  if (match[2] === "code") return codeFields(`msc-${index}`);
  const control = select(mscRow(index), match[2] ?? "");
  return control ? [control] : [];
}

function showFieldErrors(errors: readonly FieldError[]): void {
  const messages = new Map<string, string[]>();
  for (const error of errors) {
    const slot = /^msc\.\d+/.exec(error.field)?.[0] ?? error.field;
    const list = messages.get(slot) ?? [];
    if (!list.includes(error.message)) list.push(error.message);
    messages.set(slot, list);
    for (const control of controlsOf(error.field)) control.setAttribute("aria-invalid", "true");
  }
  for (const [slot, list] of messages) {
    const node = root().querySelector<HTMLElement>(`[data-error="${slot}"]`);
    if (node) {
      node.textContent = list.join(" ");
      node.hidden = false;
    }
  }
  const first = errors.map((error) => controlsOf(error.field)[0]).find((control) => control !== undefined);
  first?.focus();
}

// ---------------------------------------------------------------------------------------------------
// Drafts: a login that expired while editing does not lose the form.

interface Draft {
  readonly id: string;
  readonly base: FormState;
  readonly state: FormState;
}

function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage may be unavailable (private mode); the form stays open either way.
  }
}

function takeDraft(id: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    const draft = raw ? (JSON.parse(raw) as Draft) : null;
    return draft?.id === id ? draft : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// Merging a newer saved profile into the form

/** The message line of each field group, which names the value saved elsewhere. */
const GROUP_NOTE_SLOTS: Readonly<Record<Group, string>> = {
  country: "country",
  switch: "switch_code",
  msc: "msc",
};

function markGroups(groups: readonly string[], kind: "updated" | "contested"): void {
  for (const group of groups) {
    root().querySelector<HTMLElement>(`[data-group="${group}"]`)?.setAttribute("data-conflict", kind);
  }
}

/** A group's saved value in words, written like the profile page lists friend codes. */
function savedValue(profile: EditableProfile, group: Group): string {
  if (group === "country") {
    const name = profile.countries.find((country) => country.code === profile.country)?.name ?? "";
    return profile.country ? countryName(profile.country, name) : "no country";
  }
  if (group === "switch") return profile.switch_code ? `SW-${profile.switch_code}` : "no code";
  const codes = profile.msc_codes.map(
    (entry) => `${entry.region}${entry.platform ? ` (${entry.platform})` : ""}: ${entry.code}`,
  );
  return codes.join(", ") || "no codes";
}

function mergeInto(current: EditableProfile, mine: FormState, base: FormState, message: string): void {
  if (!editor) return;
  const theirs = fromEditable(current);
  const merged = mergeChanges(base, mine, theirs);
  editor.profile = current;
  editor.base = theirs;
  renderForm(current, merged.state);
  markGroups(merged.updated, "updated");
  markGroups(merged.contested, "contested");
  // A part changed here and elsewhere keeps this form's value; the other one is named, so Apply never
  // replaces a value the member has not seen.
  for (const group of merged.contested) {
    const note = root().querySelector<HTMLElement>(`[data-error="${GROUP_NOTE_SLOTS[group]}"]`);
    if (!note) continue;
    note.textContent = `Saved elsewhere: ${savedValue(current, group)}. Apply again to replace it with your change.`;
    note.hidden = false;
  }
  setSummary(message);
}

// ---------------------------------------------------------------------------------------------------
// Saving

interface ErrorBody {
  readonly code?: string;
  readonly fields?: readonly FieldError[];
  readonly current?: EditableProfile;
}

async function apply(): Promise<void> {
  if (!editor || editor.saving) return;
  clearMessages();
  const state = readForm();
  const checked = toRequest(state, editor.profile);
  if (!checked.ok) {
    showFieldErrors(checked.errors);
    setSummary(MESSAGES.checkFields);
    return;
  }
  const current = editor;
  current.saving = true;
  refresh();
  setStatus(MESSAGES.saving);
  try {
    const response = await fetch(API_URL, {
      method: "PUT",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ version: current.profile.version, ...checked.request }),
    });
    const body = (await response.json().catch(() => ({}))) as EditableProfile & ErrorBody & { changed?: boolean };
    if (editor !== current) return;
    setStatus("");
    if (response.ok) {
      current.profile = body;
      current.base = fromEditable(body);
      // The saved values replace the form, except what was typed while the save was under way.
      renderForm(body, mergeChanges(state, readForm(), current.base).state);
      setStatus(body.changed === false ? MESSAGES.unchanged : MESSAGES.saved, "success");
      current.onSaved();
    } else if (response.status === 409 && body.code === "PROFILE_CHANGED" && body.current) {
      mergeInto(body.current, state, current.base, MESSAGES.changedElsewhere);
    } else if (body.fields?.length) {
      const rows = state.msc.flatMap((row, index) => (row.blocks.some((block) => block !== "") ? [index] : []));
      showFieldErrors(body.fields.map((error) => ({ ...error, field: toFormField(error.field, rows) })));
      setSummary(MESSAGES.checkFields);
    } else if (response.status === 401) {
      saveDraft({ id: current.profile.discord.id, base: current.base, state });
      setSummary("Your login has expired. Your changes are kept for the next login.", {
        href: LOGIN_AGAIN_URL,
        label: "Log in again",
      });
    } else if (body.code === "NOT_GUILD_MEMBER") {
      setSummary(MESSAGES.notMember);
    } else if (response.status === 429) {
      setSummary(MESSAGES.tooMany);
    } else {
      setSummary(MESSAGES.saveFailed);
    }
  } catch {
    if (editor === current) setSummary(MESSAGES.saveFailed);
  } finally {
    current.saving = false;
    if (editor === current) refresh();
  }
}

// ---------------------------------------------------------------------------------------------------
// Closing

function showConfirm(show: boolean): void {
  const confirm = popup.slots.confirm;
  if (confirm) confirm.hidden = !show;
  if (show) root().querySelector<HTMLButtonElement>("[data-action='keep']")?.focus();
}

/** Close, ×, Escape and the backdrop end here: unsaved changes are dropped only after asking. */
function confirmClose(): boolean {
  if (!editor || !dirty()) {
    finish();
    return true;
  }
  showConfirm(true);
  return false;
}

function finish(): void {
  editor = null;
  showConfirm(false);
  window.removeEventListener("beforeunload", warnBeforeLeaving);
}

// ---------------------------------------------------------------------------------------------------
// Opening

let bound = false;

function bindOnce(): void {
  if (bound) return;
  bound = true;
  const node = root();
  bindFriendCodeInput(codeFields("switch"), { onChange: edited, onRejected: showPasteRejected });
  form()?.addEventListener("submit", (event) => {
    event.preventDefault();
    void apply();
  });
  node.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement && event.target.matches("[data-slot='country']")) {
      renderFlag(event.target.value);
    }
    edited();
  });
  node.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const clear = target?.closest<HTMLElement>("[data-clear]");
    if (clear) {
      const group = clear.getAttribute("data-clear") ?? "";
      setBlocks(codeFields(group), EMPTY_BLOCKS);
      const row = /^msc-(\d)$/.exec(group);
      if (row) {
        const container = mscRow(Number(row[1]));
        for (const field of ["region", "platform"]) {
          const control = select(container, field);
          if (control) control.value = "";
        }
      }
      codeFields(group)[0]?.focus();
      edited();
    } else if (target?.closest("[data-action='discard']")) {
      finish();
      popup.close();
    } else if (target?.closest("[data-action='keep']")) {
      showConfirm(false);
      codeFields("switch")[0]?.focus();
    }
  });
}

/** Opens the editor; `onSaved` runs after every successful save (the profile behind it reloads). */
export async function openProfileEditor(opener: HTMLElement | null, onSaved: () => void): Promise<void> {
  bindOnce();
  const request = popup.begin();
  showConfirm(false);
  popup.showStatus("Loading...");
  popup.open(opener);
  try {
    const response = await fetch(API_URL, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!popup.isCurrent(request)) return;
    if (!response.ok) {
      popup.showStatus(response.status === 401 ? MESSAGES.loginExpired : MESSAGES.loadFailed, true);
      return;
    }
    const profile = (await response.json()) as EditableProfile;
    if (!popup.isCurrent(request)) return;
    const base = fromEditable(profile);
    editor = { profile, base, saving: false, onSaved };
    popup.showStatus(null);
    renderForm(profile, base);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    const draft = takeDraft(profile.discord.id);
    if (draft) mergeInto(profile, draft.state, draft.base, MESSAGES.draftRestored);
    refresh();
  } catch {
    if (popup.isCurrent(request)) popup.showStatus(MESSAGES.loadFailed, true);
  }
}
