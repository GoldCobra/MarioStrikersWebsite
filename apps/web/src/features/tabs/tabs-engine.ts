// Tab strips: the orange line under the strip that opens around the active tab, and scrolling the
// active tab into view on narrow screens. Used by the page tabs and the leaderboard tabs.

const SVG_NS = "http://www.w3.org/2000/svg";
const LINE_THICKNESS = 3;
const OVERLAY_CLASS = "global-tabs-line-overlay";
const EPSILON = 0.001;
let gradientCounter = 0;

export interface TabsGroupOptions {
  readonly tabsRoot: HTMLElement | null;
  readonly shell?: HTMLElement | null;
  readonly tabSelector?: string;
  readonly activeSelector?: string;
}

export interface TabsGeometry {
  readonly activeLeft: number;
  readonly activeWidth: number;
  readonly tabsWidth: number;
  readonly tabsHeight: number;
}

export interface TabsGroup {
  sync(): TabsGeometry | null;
  revealActiveTab(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Whole-pixel span of a fractional range, so the line never blurs across two pixels. */
function snapRange(rawLeft: number, rawWidth: number, maxWidth: number): { left: number; width: number } {
  const left = clamp(Math.floor(rawLeft + EPSILON), 0, maxWidth);
  const right = clamp(Math.ceil(rawLeft + rawWidth - EPSILON), left, maxWidth);
  return { left, width: right - left };
}

function ensureOverlay(tabsRoot: HTMLElement): SVGSVGElement {
  const existing = tabsRoot.querySelector<SVGSVGElement>(`.${OVERLAY_CLASS}`);
  if (existing) return existing;
  const overlay = document.createElementNS(SVG_NS, "svg");
  overlay.setAttribute("class", OVERLAY_CLASS);
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("focusable", "false");
  overlay.setAttribute("preserveAspectRatio", "none");
  tabsRoot.appendChild(overlay);
  return overlay;
}

function gradientId(overlay: SVGSVGElement): string {
  const existing = overlay.getAttribute("data-gradient-id");
  if (existing) return existing;
  gradientCounter += 1;
  const id = `global-tabs-line-gradient-${gradientCounter}`;
  overlay.setAttribute("data-gradient-id", id);
  return id;
}

/** Sizes the overlay and returns the gradient definition every line segment is filled with. */
function prepareOverlay(overlay: SVGSVGElement, width: number, height: number): { defs: string; fill: string } {
  const id = gradientId(overlay);
  overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  overlay.setAttribute("width", String(width));
  overlay.setAttribute("height", String(height));
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  overlay.setAttribute("shape-rendering", "crispEdges");
  const defs = [
    "<defs>",
    `<linearGradient id="${id}" x1="0" y1="0" x2="${width}" y2="0" gradientUnits="userSpaceOnUse">`,
    '<stop offset="0%" stop-color="#b33a08"/>',
    '<stop offset="50%" stop-color="#c77603"/>',
    '<stop offset="100%" stop-color="#b33a08"/>',
    "</linearGradient>",
    "</defs>",
  ].join("");
  return { defs, fill: `url(#${id})` };
}

function rect(x: number, y: number, width: number, height: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`;
}

/** The bottom line with a gap under the active tab, which gets a top line (and outer edges). */
function drawLines(
  overlay: SVGSVGElement,
  tabsWidth: number,
  tabsHeight: number,
  activeLeft: number,
  activeWidth: number,
  activeIndex: number,
  tabCount: number,
): void {
  const width = Math.max(1, tabsWidth);
  const height = Math.max(1, tabsHeight);
  const activeX = Math.max(0, Math.min(width, activeLeft));
  const activeW = Math.max(0, Math.min(width - activeX, activeWidth));
  const activeRight = activeX + activeW;
  const bottomY = Math.max(0, height - LINE_THICKNESS);
  const leftBottomWidth = Math.max(0, activeX);
  const rightBottomWidth = Math.max(0, width - activeRight);
  const { defs, fill } = prepareOverlay(overlay, width, height);

  const parts = [defs];
  if (leftBottomWidth > 0) parts.push(rect(0, bottomY, leftBottomWidth, LINE_THICKNESS, fill));
  if (rightBottomWidth > 0) parts.push(rect(activeRight, bottomY, rightBottomWidth, LINE_THICKNESS, fill));
  if (activeW > 0) {
    const single = tabCount <= 1;
    parts.push(rect(activeX, 0, activeW, LINE_THICKNESS, fill));
    if (!single && activeIndex === 0) parts.push(rect(activeX, 0, LINE_THICKNESS, height, fill));
    if (!single && activeIndex === tabCount - 1) {
      parts.push(rect(activeRight - LINE_THICKNESS, 0, LINE_THICKNESS, height, fill));
    }
  }
  overlay.innerHTML = parts.join("");
}

function drawBaseLine(overlay: SVGSVGElement, tabsWidth: number, tabsHeight: number): void {
  const width = Math.max(1, tabsWidth);
  const height = Math.max(1, tabsHeight);
  const { defs, fill } = prepareOverlay(overlay, width, height);
  overlay.innerHTML = defs + rect(0, Math.max(0, height - LINE_THICKNESS), width, LINE_THICKNESS, fill);
}

function matches(query: string, fallbackMaxWidth: number): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : window.innerWidth <= fallbackMaxWidth;
}

export function initTabsGroup(options: TabsGroupOptions): TabsGroup | null {
  const { tabsRoot, shell = null } = options;
  const tabSelector = options.tabSelector ?? ".global-tab";
  const activeSelector = options.activeSelector ?? ".global-tab.is-active";
  if (!tabsRoot) return null;
  const root = tabsRoot;

  function updateOverflowState(): boolean {
    const hasOverflow = root.scrollWidth > root.clientWidth + 2;
    root.classList.toggle("is-overflowing", hasOverflow);
    return hasOverflow;
  }

  function shouldRevealActiveTab(): boolean {
    return updateOverflowState() && matches("(max-width: 760px)", 760);
  }

  function shouldCenterActiveTab(): boolean {
    if (shell?.classList.contains("leaderboard-tabs-shell")) return false;
    return matches("(max-width: 430px)", 430);
  }

  function revealActiveTab(): void {
    const activeTab = root.querySelector(activeSelector);
    if (!activeTab || !shouldRevealActiveTab()) return;
    window.requestAnimationFrame(() => {
      const rootRect = root.getBoundingClientRect();
      const activeRect = activeTab.getBoundingClientRect();
      const needsScroll =
        shouldCenterActiveTab() || activeRect.left < rootRect.left + 8 || activeRect.right > rootRect.right - 8;
      if (!needsScroll) return;
      const targetLeft =
        root.scrollLeft + (activeRect.left - rootRect.left) - (root.clientWidth - activeRect.width) / 2;
      root.scrollTo({ left: Math.max(0, targetLeft), behavior: "auto" });
    });
  }

  function sync(): TabsGeometry | null {
    const activeTab = root.querySelector(activeSelector);
    const overlay = ensureOverlay(root);
    const hasOverflow = updateOverflowState();
    const tabsWidth = Math.max(1, Math.round(hasOverflow ? root.scrollWidth : root.clientWidth));
    const tabsHeight = Math.max(1, Math.round(root.clientHeight));
    if (!activeTab) {
      drawBaseLine(overlay, tabsWidth, tabsHeight);
      return null;
    }

    const tabsRect = root.getBoundingClientRect();
    const activeRect = activeTab.getBoundingClientRect();
    const shellRect = shell ? shell.getBoundingClientRect() : tabsRect;
    const shellWidth = Math.max(1, Math.round(shell ? shell.clientWidth : tabsWidth));
    const shellHeight = Math.max(1, Math.round(shell ? shell.clientHeight : tabsHeight));

    const line = snapRange(
      activeRect.left - tabsRect.left + (hasOverflow ? root.scrollLeft : 0),
      activeRect.width,
      tabsWidth,
    );
    const inShell = snapRange(activeRect.left - shellRect.left, activeRect.width, shellWidth);
    const headTop = Math.round(clamp(tabsRect.top - shellRect.top, 0, shellHeight));
    const headHeight = Math.round(clamp(tabsRect.height, 0, shellHeight - headTop));
    const panelTop = Math.round(clamp(headTop + headHeight, 0, shellHeight));
    const panelHeight = Math.round(clamp(shellHeight - panelTop, 0, shellHeight));

    const tabs = Array.from(root.querySelectorAll(tabSelector));
    const activeIndex = tabs.indexOf(activeTab);

    if (shell) {
      shell.style.setProperty("--active-left", `${inShell.left}px`);
      shell.style.setProperty("--active-width", `${inShell.width}px`);
      shell.style.setProperty("--tabs-head-top", `${headTop}px`);
      shell.style.setProperty("--tabs-head-height", `${headHeight}px`);
      shell.style.setProperty("--tabs-panel-top", `${panelTop}px`);
      const suppressPanel = getComputedStyle(shell).getPropertyValue("--tabs-suppress-panel").trim() === "1";
      shell.style.setProperty("--tabs-panel-height", suppressPanel ? "0" : `${panelHeight}px`);
      shell.style.setProperty("--tabs-render-height", `${tabsHeight}px`);
    }

    drawLines(overlay, tabsWidth, tabsHeight, line.left, line.width, activeIndex, tabs.length);
    return { activeLeft: line.left, activeWidth: line.width, tabsWidth, tabsHeight };
  }

  const refresh = (): void => {
    sync();
    revealActiveTab();
  };

  refresh();
  root.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", refresh);
  window.addEventListener("load", refresh);
  for (const image of Array.from(root.querySelectorAll("img"))) {
    if (!image.complete) image.addEventListener("load", refresh, { once: true });
  }
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(refresh);
    observer.observe(root);
    if (shell) observer.observe(shell);
  }
  void document.fonts.ready.then(refresh);

  return { sync, revealActiveTab };
}
