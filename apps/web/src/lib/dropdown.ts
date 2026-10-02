// The site's dropdown: a select-only combobox (WAI-ARIA APG) for a choice whose options a native <select>
// cannot show: images (the country's flag) or a look (a player title's colour, glow and ball). A plain text
// choice keeps the native <select>. One implementation and one stylesheet (styles/dropdown.css) for every
// dropdown, so a change to its behaviour, type or spacing reaches all of them.
//
// - Type: the field and its options take the font of the field around them (--field-font-size); an option
//   never sets its own size, so it never looks larger than the value it becomes.
// - Place: the open list is laid over the page in the browser's top layer (a manual popover), so no
//   container clips it (overflow) and no other element covers it (the floating save bar, toasts). It opens
//   below the field, or above when there is more room there, and is never taller than the room it has;
//   longer lists scroll. It follows the field while the page scrolls or resizes.
// - Keys: arrows, Home/End, PageUp/PageDown, Enter, Space, Tab, Escape and typing a name; a click on an
//   option takes it; a click outside, or the focus leaving, closes the list.

import { escapeHtml } from "@ms/shared/html";

export interface DropdownOption {
  /** The value the field stands for ("" for none). */
  readonly value: string;
  /** Its name: typing jumps to it, and it is shown when there is no `html`. */
  readonly label: string;
  /** The option's content, in the list and in the field, built by the caller (escaped there). */
  readonly html?: string;
}

export interface DropdownConfig {
  /** Id of the field (the combobox); the list gets `<id>-listbox`, the options `<id>-option-<n>`. */
  readonly id: string;
  /** Id of the element naming the field. */
  readonly labelledBy: string;
  /** Id of the element with the field's error, if any. */
  readonly describedBy?: string;
  readonly options: readonly DropdownOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** More classes for the field, e.g. its width. */
  readonly className?: string;
}

export interface Dropdown {
  readonly element: HTMLElement;
  focus(): void;
  setInvalid(invalid: boolean): void;
}

function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * The option typing `query` moves to: the next one (after `from`) whose label starts with it, wrapping
 * around; a repeated single letter ("sss") steps through the labels with that letter. Options without a
 * value ("No country") are skipped. -1 when none.
 */
export function typeaheadIndex(options: readonly DropdownOption[], query: string, from: number): number {
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

/** The list's greatest height (px), however much room there is. */
export const DROPDOWN_MAX_HEIGHT = 280;
/** Space between the field and its list, and the least space kept to the window's edge (px). */
export const DROPDOWN_GAP = 2;
export const DROPDOWN_EDGE = 8;

export interface DropdownRoom {
  /** The field's top and bottom edge, from the top of the window. */
  readonly top: number;
  readonly bottom: number;
  /** The window's height. */
  readonly viewport: number;
  /** The list's full height with every option. */
  readonly content: number;
  readonly max?: number;
}

export interface DropdownPlacement {
  readonly up: boolean;
  /** The list's height: its content, at most `max`, at most the room on its side. */
  readonly height: number;
  /** Its top edge, from the top of the window. */
  readonly top: number;
}

/**
 * Where the open list goes: below the field when it fits there, else on the side with more room; as tall
 * as its options, never taller than `max` or than the room on that side (the rest scrolls).
 */
export function dropdownPlacement({
  top,
  bottom,
  viewport,
  content,
  max = DROPDOWN_MAX_HEIGHT,
}: DropdownRoom): DropdownPlacement {
  const wanted = Math.min(content, max);
  const below = Math.max(0, viewport - bottom - DROPDOWN_GAP - DROPDOWN_EDGE);
  const above = Math.max(0, top - DROPDOWN_GAP - DROPDOWN_EDGE);
  const up = below < wanted && above > below;
  const height = Math.max(0, Math.min(wanted, up ? above : below));
  return { up, height, top: up ? top - DROPDOWN_GAP - height : bottom + DROPDOWN_GAP };
}

const TYPEAHEAD_RESET_MS = 500;
const PAGE_STEP = 10;

const supportsPopover = (element: HTMLElement): boolean => typeof element.showPopover === "function";

export function createDropdown(config: DropdownConfig): Dropdown {
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

  const contentOf = (option: DropdownOption | undefined): string =>
    option?.html ?? `<span class="dropdown-text">${escapeHtml(option?.label ?? "")}</span>`;

  const element = document.createElement("div");
  element.className = config.className ? `dropdown ${config.className}` : "dropdown";
  element.innerHTML = [
    `<div id="${escapeHtml(id)}" class="dropdown-field" role="combobox" tabindex="0"`,
    ` aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeHtml(listId)}"`,
    ` aria-labelledby="${escapeHtml(config.labelledBy)} ${escapeHtml(id)}"`,
    config.describedBy ? ` aria-describedby="${escapeHtml(config.describedBy)}"` : "",
    `><span class="dropdown-value"></span><span class="dropdown-caret" aria-hidden="true"></span></div>`,
    `<ul id="${escapeHtml(listId)}" class="dropdown-list" role="listbox" tabindex="-1" popover="manual"`,
    ` aria-labelledby="${escapeHtml(config.labelledBy)}" hidden>`,
    options
      .map(
        (option, index) =>
          `<li id="${escapeHtml(optionId(index))}" class="dropdown-option" role="option" aria-selected="false" data-index="${String(index)}" data-value="${escapeHtml(option.value)}">${contentOf(option)}</li>`,
      )
      .join(""),
    "</ul>",
  ].join("");
  const fieldNode = element.querySelector<HTMLElement>(".dropdown-field");
  const valueNode = element.querySelector<HTMLElement>(".dropdown-value");
  const listNode = element.querySelector<HTMLElement>(".dropdown-list");
  if (!fieldNode || !valueNode || !listNode) throw new Error("Invalid dropdown.");
  const field: HTMLElement = fieldNode;
  const shown: HTMLElement = valueNode;
  const list: HTMLElement = listNode;
  const items = Array.from(list.querySelectorAll<HTMLElement>(".dropdown-option"));

  const isOpen = (): boolean => !list.hidden;

  function renderValue(): void {
    shown.innerHTML = contentOf(options.find((option) => option.value === value) ?? options[0]);
    items.forEach((item, index) => {
      item.setAttribute("aria-selected", options[index]?.value === value ? "true" : "false");
    });
  }

  function setActive(index: number): void {
    active = Math.min(options.length - 1, Math.max(0, index));
    items.forEach((item, itemIndex) => item.classList.toggle("is-active", itemIndex === active));
    field.setAttribute("aria-activedescendant", optionId(active));
    const item = items[active];
    if (!item) return;
    // Keep the active option inside the list's own scroll area.
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }

  // -----------------------------------------------------------------------------------------------------
  // Placement: fixed to the window, next to the field, measured anew while the page scrolls or resizes.

  let frame = 0;

  function place(): void {
    frame = 0;
    if (!isOpen()) return;
    if (!element.isConnected) {
      close();
      return;
    }
    const box = field.getBoundingClientRect();
    // As wide as the field first: the options' height depends on it.
    list.style.left = `${String(box.left)}px`;
    list.style.width = `${String(box.width)}px`;
    const { height, top } = dropdownPlacement({
      top: box.top,
      bottom: box.bottom,
      viewport: document.documentElement.clientHeight || window.innerHeight,
      content: list.scrollHeight + (list.offsetHeight - list.clientHeight),
    });
    list.style.top = `${String(top)}px`;
    list.style.maxHeight = `${String(height)}px`;
  }

  function schedulePlace(event?: Event): void {
    // Scrolling the list itself moves nothing.
    if (event?.target === list || frame) return;
    frame = window.requestAnimationFrame(place);
  }

  function open(): void {
    if (isOpen()) return;
    list.hidden = false;
    // Without the top layer (older browsers) the list is still fixed to the window, above the page.
    if (supportsPopover(list) && !list.matches(":popover-open")) {
      try {
        list.showPopover();
      } catch {
        // Not in the document (yet): placed like the fallback.
      }
    }
    field.setAttribute("aria-expanded", "true");
    place();
    window.addEventListener("scroll", schedulePlace, { capture: true, passive: true });
    window.addEventListener("resize", schedulePlace, { passive: true });
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
  }

  function close(): void {
    window.removeEventListener("scroll", schedulePlace, { capture: true });
    window.removeEventListener("resize", schedulePlace);
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    if (!isOpen()) return;
    if (supportsPopover(list) && list.matches(":popover-open")) list.hidePopover();
    list.hidden = true;
    field.setAttribute("aria-expanded", "false");
    field.removeAttribute("aria-activedescendant");
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

  field.addEventListener("keydown", (event) => {
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
      // Escape and Enter belong to the field here, not to the form around it.
      event.stopPropagation();
    }
  });
  field.addEventListener("click", () => {
    if (isOpen()) close();
    else open();
  });
  field.addEventListener("blur", (event) => {
    if (!(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) close();
  });
  // The focus stays on the field while an option (or the list's scroll bar) is pressed.
  list.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  list.addEventListener("click", (event) => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>(".dropdown-option") : null;
    if (item) choose(Number(item.dataset.index));
  });
  list.addEventListener("mousemove", (event) => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>(".dropdown-option") : null;
    if (item && Number(item.dataset.index) !== active) setActive(Number(item.dataset.index));
  });

  renderValue();
  return {
    element,
    focus: () => {
      field.focus();
    },
    setInvalid: (invalid) => {
      if (invalid) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    },
  };
}
