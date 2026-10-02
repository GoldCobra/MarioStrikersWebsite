// The country field of the profile page: a select-only combobox (WAI-ARIA APG) whose options show the
// country's flag from /assets/flags, as a native <select> cannot show images and Windows draws no flag
// emoji. Typing jumps to the first country starting with what was typed; Enter, Tab or a click takes it.
// The title field uses it too, without flags: each title in its look (colour and glow) after its game's
// ball, which the options of a native <select> cannot show either.

import { escapeHtml } from "@ms/shared/html";
import { countryDisplayName, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";

export interface CountryOption {
  /** The value the API takes (dbo.Enumeration's code, e.g. "de", "england"); "" for no country. */
  readonly value: string;
  readonly label: string;
  /** The flag file's code ("de", "gb-eng"), "" when there is none. */
  readonly flag: string;
  /** Classes for the option's name, in the list and in the field (a title's look). */
  readonly className?: string;
  /** An icon before the name, in the list and in the field (a title's game ball); built by the caller. */
  readonly iconHtml?: string;
}

export const NO_COUNTRY_LABEL = "No country";

/** A country's name as the site shows it: English, from its flag code; else the list's own name. */
export function countryLabel(code: string, fallback = ""): string {
  return countryDisplayName(normalizeCountryCode(code)) || fallback || code;
}

/** "No country", then every country once, alphabetically by the shown name. */
export function countryOptions(
  countries: readonly { readonly code: string; readonly name: string }[],
): CountryOption[] {
  const seen = new Set<string>();
  const options: CountryOption[] = [];
  for (const country of countries) {
    if (!country.code || seen.has(country.code)) continue;
    seen.add(country.code);
    options.push({
      value: country.code,
      label: countryLabel(country.code, country.name),
      flag: normalizeCountryCode(country.code),
    });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  return [{ value: "", label: NO_COUNTRY_LABEL, flag: "" }, ...options];
}

function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * The option typing `query` moves to: the next one (after `from`) whose name starts with it, wrapping
 * around; a repeated single letter ("sss") steps through the names with that letter. -1 when none.
 */
export function typeaheadIndex(options: readonly CountryOption[], query: string, from: number): number {
  const typed = folded(query);
  if (!typed) return -1;
  const repeated = /^(.)\1+$/u.test(typed);
  const prefix = repeated ? typed.slice(0, 1) : typed;
  // A new search starts after the active option, a growing one may stay on it.
  const start = repeated || typed.length === 1 ? from + 1 : from;
  for (let step = 0; step < options.length; step += 1) {
    const index = (((start + step) % options.length) + options.length) % options.length;
    const option = options[index];
    if (option?.value && folded(option.label).startsWith(prefix)) return index;
  }
  return -1;
}

export function flagImage(flag: string, className: string): string {
  return flag
    ? `<img class="${className}" src="${escapeHtml(flagUrl(flag))}" width="27" height="18" alt="" loading="lazy">`
    : `<span class="${className} is-empty" aria-hidden="true"></span>`;
}

export interface CountrySelectOptions {
  readonly id: string;
  /** Id of the element naming the field ("Country"). */
  readonly labelledBy: string;
  /** Id of the element with the field's error, if any. */
  readonly describedBy?: string;
  readonly options: readonly CountryOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Show the options' flags (default); off for a list without them. */
  readonly flags?: boolean;
  /** Another class for the field, e.g. its width. */
  readonly className?: string;
}

export interface CountrySelect {
  readonly element: HTMLElement;
  focus(): void;
  setInvalid(invalid: boolean): void;
}

const TYPEAHEAD_RESET_MS = 500;
const PAGE_STEP = 10;

export function createCountrySelect(config: CountrySelectOptions): CountrySelect {
  const { id, options, onChange } = config;
  const listId = `${id}-listbox`;
  const optionId = (index: number): string => `${id}-option-${String(index)}`;
  let value = options.some((option) => option.value === config.value) ? config.value : "";
  let active = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  let typed = "";
  let typedTimer: number | undefined;

  const flags = config.flags ?? true;
  const flagOf = (option: CountryOption | undefined): string =>
    flags ? flagImage(option?.flag ?? "", "profile-country-flag") : "";
  const nameOf = (option: CountryOption | undefined, fallback: string): string =>
    (option?.iconHtml ?? "") +
    `<span class="profile-country-name${option?.className ? ` ${escapeHtml(option.className)}` : ""}">${escapeHtml(option?.label ?? fallback)}</span>`;
  const element = document.createElement("div");
  element.className = config.className ? `profile-country-select ${config.className}` : "profile-country-select";
  element.innerHTML = [
    `<div id="${escapeHtml(id)}" class="profile-country-trigger" role="combobox" tabindex="0"`,
    ` aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeHtml(listId)}"`,
    ` aria-labelledby="${escapeHtml(config.labelledBy)} ${escapeHtml(id)}"`,
    config.describedBy ? ` aria-describedby="${escapeHtml(config.describedBy)}"` : "",
    "></div>",
    `<ul id="${escapeHtml(listId)}" class="profile-country-listbox" role="listbox" tabindex="-1"`,
    ` aria-labelledby="${escapeHtml(config.labelledBy)}" hidden>`,
    options
      .map(
        (option, index) =>
          `<li id="${escapeHtml(optionId(index))}" class="profile-country-option" role="option" aria-selected="false" data-index="${String(index)}" data-value="${escapeHtml(option.value)}">` +
          `${flagOf(option)}${nameOf(option, option.label)}</li>`,
      )
      .join(""),
    "</ul>",
  ].join("");
  const triggerNode = element.querySelector<HTMLElement>(".profile-country-trigger");
  const listNode = element.querySelector<HTMLElement>(".profile-country-listbox");
  if (!triggerNode || !listNode) throw new Error("Invalid country select.");
  const trigger: HTMLElement = triggerNode;
  const list: HTMLElement = listNode;
  const items = Array.from(list.querySelectorAll<HTMLElement>(".profile-country-option"));

  const isOpen = (): boolean => !list.hidden;

  function renderValue(): void {
    const option = options.find((entry) => entry.value === value) ?? options[0];
    trigger.innerHTML =
      flagOf(option) +
      nameOf(option, NO_COUNTRY_LABEL) +
      '<span class="profile-country-caret" aria-hidden="true"></span>';
    items.forEach((item, index) => {
      item.setAttribute("aria-selected", options[index]?.value === value ? "true" : "false");
    });
  }

  function setActive(index: number): void {
    active = Math.min(options.length - 1, Math.max(0, index));
    items.forEach((item, itemIndex) => item.classList.toggle("is-active", itemIndex === active));
    trigger.setAttribute("aria-activedescendant", optionId(active));
    const item = items[active];
    if (!item) return;
    // Keep the active option inside the list's own scroll area.
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }

  function open(): void {
    if (isOpen()) return;
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    // Upwards when the space below the field is too small for the list.
    const box = trigger.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    element.classList.toggle("opens-up", below < Math.min(list.scrollHeight, 280) && box.top > below);
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
  }

  function close(): void {
    if (!isOpen()) return;
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  }

  function choose(index: number): void {
    const option = options[index];
    if (option && option.value !== value) {
      value = option.value;
      renderValue();
      onChange(value);
    }
    close();
  }

  function typeahead(char: string): void {
    window.clearTimeout(typedTimer);
    typed += char;
    typedTimer = window.setTimeout(() => {
      typed = "";
    }, TYPEAHEAD_RESET_MS);
    const index = typeaheadIndex(options, typed, active);
    if (index < 0) return;
    open();
    setActive(index);
  }

  trigger.addEventListener("keydown", (event) => {
    const { key, altKey } = event;
    let handled = true;
    if (!isOpen()) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") open();
      else if (key === "Home") {
        open();
        setActive(0);
      } else if (key === "End") {
        open();
        setActive(options.length - 1);
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !altKey && key !== " ") typeahead(key);
      else handled = false;
    } else if (key === "ArrowDown") setActive(active + 1);
    else if (key === "ArrowUp" && altKey) choose(active);
    else if (key === "ArrowUp") setActive(active - 1);
    else if (key === "Home") setActive(0);
    else if (key === "End") setActive(options.length - 1);
    else if (key === "PageDown") setActive(active + PAGE_STEP);
    else if (key === "PageUp") setActive(active - PAGE_STEP);
    else if (key === "Enter" || (key === " " && !typed)) choose(active);
    else if (key === "Escape") close();
    else if (key === "Tab") {
      choose(active);
      handled = false;
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !altKey) typeahead(key);
    else handled = false;
    if (handled) {
      event.preventDefault();
      // Escape and Enter belong to the field here, not to the editor around it.
      event.stopPropagation();
    }
  });
  trigger.addEventListener("click", () => {
    if (isOpen()) close();
    else open();
  });
  trigger.addEventListener("blur", (event) => {
    if (!(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) close();
  });
  // The focus stays on the field while an option is clicked.
  list.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  list.addEventListener("click", (event) => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>(".profile-country-option") : null;
    if (item) choose(Number(item.dataset.index));
  });
  list.addEventListener("mousemove", (event) => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>(".profile-country-option") : null;
    if (item && Number(item.dataset.index) !== active) setActive(Number(item.dataset.index));
  });

  renderValue();
  return {
    element,
    focus: () => {
      trigger.focus();
    },
    setInvalid: (invalid) => {
      if (invalid) trigger.setAttribute("aria-invalid", "true");
      else trigger.removeAttribute("aria-invalid");
    },
  };
}
