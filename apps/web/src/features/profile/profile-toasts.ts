// Status messages of the profile page ("Changes saved."), stacked at the bottom right of the screen.
// They leave after a few seconds (not while the pointer or the focus is on them; one with a link stays
// until it is closed) and are announced politely by screen readers. They live in <body>, outside the
// profile card, whose rules strip every shadow.

import { escapeHtml } from "@ms/shared/html";

export interface Toast {
  readonly text: string;
  readonly level: "info" | "success" | "error";
  readonly link?: { readonly href: string; readonly label: string };
}

const MAX_TOASTS = 4;
const SHOW_MS = { info: 5000, success: 5000, error: 8000 } as const;
const LEAVE_MS = 200;

let stack: HTMLElement | null = null;
let paused = false;
const timers = new Map<HTMLElement, { remaining: number; started: number; timer: number | undefined }>();

function remove(toast: HTMLElement): void {
  const state = timers.get(toast);
  if (state) window.clearTimeout(state.timer);
  timers.delete(toast);
  toast.classList.add("is-leaving");
  window.setTimeout(() => {
    toast.remove();
  }, LEAVE_MS);
}

function run(toast: HTMLElement): void {
  const state = timers.get(toast);
  if (!state || paused) return;
  state.started = Date.now();
  state.timer = window.setTimeout(() => {
    remove(toast);
  }, state.remaining);
}

function pause(): void {
  if (paused) return;
  paused = true;
  for (const state of timers.values()) {
    window.clearTimeout(state.timer);
    state.remaining = Math.max(1000, state.remaining - (Date.now() - state.started));
  }
}

function resume(): void {
  if (!paused) return;
  paused = false;
  for (const toast of timers.keys()) run(toast);
}

function ensureStack(): HTMLElement {
  if (stack?.isConnected) return stack;
  const element = document.createElement("div");
  element.className = "profile-toasts";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.addEventListener("mouseenter", pause);
  element.addEventListener("mouseleave", () => {
    if (!element.contains(document.activeElement)) resume();
  });
  element.addEventListener("focusin", pause);
  element.addEventListener("focusout", (event) => {
    if (!(event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) && !element.matches(":hover")) {
      resume();
    }
  });
  element.addEventListener("click", (event) => {
    const close = event.target instanceof Element ? event.target.closest(".profile-toast-close") : null;
    const toast = close?.closest<HTMLElement>(".profile-toast");
    if (toast) remove(toast);
  });
  document.body.append(element);
  stack = element;
  return element;
}

export function showToast({ text, level, link }: Toast): void {
  const container = ensureStack();
  const toast = document.createElement("div");
  toast.className = `profile-toast is-${level}`;
  toast.innerHTML = [
    `<p class="profile-toast-text">${escapeHtml(text)}`,
    link ? ` <a class="profile-toast-link" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>` : "",
    "</p>",
    '<button class="profile-toast-close" type="button" aria-label="Close message">×</button>',
  ].join("");
  container.append(toast);
  const shown = Array.from(container.querySelectorAll<HTMLElement>(".profile-toast:not(.is-leaving)"));
  for (const old of shown.slice(0, Math.max(0, shown.length - MAX_TOASTS))) remove(old);
  if (link) return;
  timers.set(toast, { remaining: SHOW_MS[level], started: Date.now(), timer: undefined });
  run(toast);
}

/** Lifts the messages above the profile's save bar while it floats at the bottom of the screen. */
export function setToastLift(pixels: number): void {
  ensureStack().style.setProperty("--profile-toast-lift", `${String(Math.max(0, Math.round(pixels)))}px`);
}
