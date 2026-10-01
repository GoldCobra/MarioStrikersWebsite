// A dialog mounted from its HTML template on first use (the feature's *-popup.html, bundled with its code):
// named slots (data-slot) and lists (data-list) to fill, a status line for loading and errors, close
// buttons, Escape, and focus kept inside while it is open. The player and the club popup and the profile
// editor are built on it.

export interface PopupOptions {
  /** The popup's markup: one root element, hidden until opened. */
  readonly template: string;
  /** Class on <body> while the popup is open. */
  readonly openClass: string;
  /** The close button that gets focus when the popup opens. */
  readonly closeButtonSelector: string;
  /** Asked before a close button, the backdrop or Escape closes the popup; false keeps it open. */
  readonly beforeClose?: () => boolean;
}

function mapByAttribute(root: HTMLElement, attribute: string): Record<string, HTMLElement | undefined> {
  const map: Record<string, HTMLElement | undefined> = {};
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`))) {
    const key = (node.getAttribute(attribute) ?? "").trim();
    if (key) map[key] = node;
  }
  return map;
}

function focusableControls(card: Element): HTMLElement[] {
  return Array.from(
    card.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary, [tabindex]"),
  ).filter(
    (node) =>
      !(node as HTMLButtonElement).disabled &&
      node.tabIndex >= 0 &&
      node.getClientRects().length > 0 &&
      window.getComputedStyle(node).visibility !== "hidden",
  );
}

export class TemplatePopup {
  root: HTMLElement | null = null;
  slots: Record<string, HTMLElement | undefined> = {};
  lists: Record<string, HTMLElement | undefined> = {};
  isOpen = false;
  private activeRequest: symbol | null = null;
  private opener: HTMLElement | null = null;
  private keyboardBound = false;
  private readonly options: PopupOptions;

  constructor(options: PopupOptions) {
    this.options = options;
  }

  /** Mounts the popup once. */
  ensure(): HTMLElement {
    if (this.root) return this.root;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = this.options.template.trim();
    const root = wrapper.firstElementChild;
    if (!(root instanceof HTMLElement)) throw new Error("Invalid popup template.");
    document.body.appendChild(root);
    this.root = root;
    this.slots = mapByAttribute(root, "data-slot");
    this.lists = mapByAttribute(root, "data-list");

    const requestClose = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.requestClose();
    };
    for (const node of Array.from(root.querySelectorAll("[data-action='popup-close']"))) {
      node.addEventListener("click", requestClose);
    }
    root.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("[data-action='popup-close']")) requestClose(event);
    });
    this.bindKeyboard();
    return root;
  }

  /** Starts a request for new content; an older request that is still loading is ignored from now on. */
  begin(): symbol {
    const request = Symbol("popup-request");
    this.activeRequest = request;
    this.bindKeyboard();
    return request;
  }

  isCurrent(request: symbol): boolean {
    return this.activeRequest === request;
  }

  open(opener: HTMLElement | null): void {
    if (!this.root) return;
    this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    this.isOpen = true;
    document.body.classList.add(this.options.openClass);
    this.root.querySelector<HTMLElement>(this.options.closeButtonSelector)?.focus({ preventScroll: true });
  }

  /** Closes unless the popup's beforeClose keeps it open. */
  requestClose(): void {
    if (this.options.beforeClose && !this.options.beforeClose()) return;
    this.close();
  }

  close(): void {
    this.activeRequest = null;
    if (!this.root) return;
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
    this.isOpen = false;
    document.body.classList.remove(this.options.openClass);
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }

  /** Shows the loading or error message instead of the content, or the content (message null). */
  showStatus(message: string | null, isError = false): void {
    const status = this.slots["popup-status"];
    const content = this.slots["popup-content"];
    if (status) {
      if (message === null) {
        status.hidden = true;
      } else {
        status.textContent = message;
        status.hidden = false;
      }
      status.classList.toggle("is-error", message !== null && isError);
    }
    if (content) content.hidden = message !== null;
  }

  setText(slot: string, value: string): void {
    const node = this.slots[slot];
    if (node) node.textContent = value;
  }

  private bindKeyboard(): void {
    if (this.keyboardBound) return;
    this.keyboardBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && (this.isOpen || this.activeRequest)) {
        event.preventDefault();
        event.stopPropagation();
        this.requestClose();
        return;
      }
      if (event.key !== "Tab" || !this.isOpen || !this.root) return;
      const card = this.root.querySelector(".popup-card");
      if (!card) return;
      const controls = focusableControls(card);
      if (!controls.length) return;
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (index === -1 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0]?.focus({ preventScroll: true });
      }
    });
    document.addEventListener("focusin", (event) => {
      if (!this.isOpen || !this.root) return;
      const card = this.root.querySelector(".popup-card");
      if (card && !(event.target instanceof Node && card.contains(event.target))) {
        card.querySelector<HTMLElement>(".popup-close")?.focus({ preventScroll: true });
      }
    });
  }
}
