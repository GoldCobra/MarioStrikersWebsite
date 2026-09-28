// A dialog loaded from an HTML template on first use (pages/templates/*-popup.html): named slots
// (data-slot) and lists (data-list) to fill, a status line for loading and errors, close buttons, Escape,
// and focus kept inside while it is open. The player and the club popup are built on it.

export interface PopupOptions {
  readonly templateUrl: string;
  /** Class on <body> while the popup is open. */
  readonly openClass: string;
  /** The close button that gets focus when the popup opens. */
  readonly closeButtonSelector: string;
  /** Note shown above the page's list when the popup cannot open at all, with a retry button. */
  readonly openError: {
    readonly id: string;
    readonly className: string;
    readonly message: string;
    readonly mountIds: readonly string[];
  };
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
  private templateLoad: Promise<HTMLElement> | null = null;
  private keyboardBound = false;
  private readonly options: PopupOptions;

  constructor(options: PopupOptions) {
    this.options = options;
  }

  /** Loads and mounts the popup once; a failed load is retried on the next request. */
  ensure(): Promise<HTMLElement> {
    if (this.root) return Promise.resolve(this.root);
    this.templateLoad ??= fetch(this.options.templateUrl, { headers: { Accept: "text/html" }, cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${this.options.templateUrl}.`);
        return response.text();
      })
      .then((html) => this.mount(html))
      .catch((error: unknown) => {
        this.templateLoad = null;
        throw error;
      });
    return this.templateLoad;
  }

  private mount(html: string): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
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
      this.close();
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
    this.clearOpenError();
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

  close(): void {
    this.activeRequest = null;
    this.clearOpenError();
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

  clearOpenError(): void {
    document.getElementById(this.options.openError.id)?.remove();
  }

  /** When the popup cannot even open, a note with a retry button appears above the page's list. */
  showOpenError(retry: () => void): void {
    this.clearOpenError();
    const { id, className, message, mountIds } = this.options.openError;
    const mount = mountIds.map((mountId) => document.getElementById(mountId)).find(Boolean);
    if (!mount) return;
    const feedback = document.createElement("p");
    feedback.id = id;
    feedback.className = className;
    feedback.setAttribute("role", "alert");
    feedback.textContent = message;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-action-button";
    button.textContent = "Retry";
    button.addEventListener("click", retry);
    feedback.appendChild(button);
    mount.insertAdjacentElement("beforebegin", feedback);
  }

  private bindKeyboard(): void {
    if (this.keyboardBound) return;
    this.keyboardBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && (this.isOpen || this.activeRequest)) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
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
