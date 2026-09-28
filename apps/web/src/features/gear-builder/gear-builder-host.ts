// Hosts the MSBL Gear Builder, a third-party snapshot kept byte-identical under assets/gear-builder/
// (see docs/msbl-gear-builder-snapshot.md): loads its markup and scripts, loads each character's pane on
// first use, keeps the stat overlays in sync and sizes the host to the visible pane.

const TEMPLATE_VERSION = "20260508-lazy-v1";
const TEMPLATE_URL = `/pages/templates/msbl-gear-builder.html?v=${TEMPLATE_VERSION}`;
const CHARACTER_IMAGE_PATTERN = /(\.\.\/assets\/gear-builder\/images\/characters\/[^"'?#]+)\.png\b/gi;
const CHARACTER_ICON_PATTERN = /(\.\.\/assets\/gear-builder\/images\/characters-icons\/[^"'?#]+)\.png\b/gi;

const PANE_SLUGS = [
  "mario",
  "luigi",
  "bowser",
  "peach",
  "rosalina",
  "toad",
  "yoshi",
  "dk",
  "wario",
  "waluigi",
  "shy-guy",
  "daisy",
  "pauline",
  "diddy-kong",
  "bowser-jr",
  "birdo",
];

/** Tab pane id ("tab-01".."tab-16") → character id and pane markup URL. */
const CHARACTER_PANES = new Map(
  PANE_SLUGS.map((slug, index) => [
    `tab-${String(index + 1).padStart(2, "0")}`,
    { characterId: index + 1, url: `/pages/templates/msbl-gear-builder/panes/${slug}.html?v=${TEMPLATE_VERSION}` },
  ]),
);

/** The Gear Builder's scripts, loaded one after another in this order. */
const SCRIPTS: readonly { src: string; module?: true }[] = [
  { src: "../assets/gear-builder/scripts/jquery.min.js" },
  { src: "../assets/gear-builder/scripts/data.js", module: true },
  { src: "../assets/gear-builder/scripts/gear.js?v=20260514-buttons-v1", module: true },
  { src: "../assets/gear-builder/scripts/builder.js?v=20260507-perf-v1", module: true },
  { src: "../assets/gear-builder/scripts/screenshot.js?v=20260508-lazy-v1", module: true },
  { src: "../assets/gear-builder/scripts/html2canvas.min.js" },
  { src: "../assets/gear-builder/scripts/filesaver.min.js" },
  { src: "../assets/gear-builder/scripts/tabs.js" },
  { src: "../assets/gear-builder/scripts/add.js" },
  { src: "../assets/gear-builder/scripts/hiderows.js" },
  { src: "../assets/gear-builder/scripts/select.js" },
  { src: "../assets/gear-builder/scripts/checklist.js" },
  { src: "../assets/gear-builder/scripts/sliders.js" },
  { src: "../assets/gear-builder/scripts/menu.js" },
  { src: "../assets/gear-builder/scripts/presets.js?v=20260508-lazy-v1", module: true },
];

/** The rows of a build card whose bars get a text overlay with the stat's name and value. */
const STAT_ROWS = [
  { rowClass: "strengthbar", valueClass: "str", label: "STRENGTH" },
  { rowClass: "speedbar", valueClass: "spe", label: "SPEED" },
  { rowClass: "shotbar", valueClass: "sho", label: "SHOOTING" },
  { rowClass: "passbar", valueClass: "pas", label: "PASSING" },
  { rowClass: "techbar", valueClass: "tec", label: "TECHNIQUE" },
] as const;

declare global {
  interface Window {
    /** Set by the Gear Builder's presets.js. */
    MSBL_GEAR_PRESETS?: { restoreDraftForCharacter?: (characterId: number) => boolean };
  }
}

function overlayOf(row: Element): Element {
  const existing = row.querySelector(".stat-text-overlay");
  if (existing) return existing;
  const overlay = document.createElement("div");
  overlay.className = "stat-text-overlay";
  const label = document.createElement("span");
  label.className = "stat-text-label";
  overlay.appendChild(label);
  const value = document.createElement("span");
  value.className = "stat-text-value";
  overlay.appendChild(value);
  row.appendChild(overlay);
  return overlay;
}

function syncCardOverlays(card: Element): void {
  for (const stat of STAT_ROWS) {
    const row = card.querySelector(`.${stat.rowClass}`);
    if (!row) continue;
    const value = (card.querySelector(`.cardstat .stat.${stat.valueClass}`)?.textContent ?? "").trim();
    const overlay = overlayOf(row);
    const labelNode = overlay.querySelector(".stat-text-label");
    const valueNode = overlay.querySelector(".stat-text-value");
    if (labelNode) labelNode.textContent = stat.label;
    if (valueNode) valueNode.textContent = value;
  }
}

function syncPaneOverlays(pane: Element): void {
  for (const card of Array.from(pane.querySelectorAll(".buildcard"))) syncCardOverlays(card);
}

/** Re-syncs a card's overlays whenever the Gear Builder changes one of its stat values. */
function statObserver(): MutationObserver {
  return new MutationObserver((mutations) => {
    const cards = new Set<Element>();
    for (const mutation of mutations) {
      const target = mutation.target.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target;
      const card = target instanceof Element ? target.closest(".buildcard") : null;
      if (card) cards.add(card);
    }
    cards.forEach(syncCardOverlays);
  });
}

function loadScript(entry: (typeof SCRIPTS)[number]): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = entry.src;
    if (entry.module) script.type = "module";
    script.async = false;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      reject(new Error(`Failed to load script: ${entry.src}`));
    };
    document.body.appendChild(script);
  });
}

function preferWebp(markup: string): string {
  return markup.replace(CHARACTER_IMAGE_PATTERN, "$1.webp").replace(CHARACTER_ICON_PATTERN, "$1.webp");
}

/** Character images are served as WebP; a browser without it gets the PNG. */
function attachWebpFallbacks(root: ParentNode): void {
  const selectors = [
    'img[src*="../assets/gear-builder/images/characters/"][src$=".webp"]',
    'img[src*="../assets/gear-builder/images/characters-icons/"][src$=".webp"]',
  ];
  for (const selector of selectors) {
    for (const image of Array.from(root.querySelectorAll<HTMLImageElement>(selector))) {
      image.addEventListener(
        "error",
        () => {
          if (image.getAttribute("data-webp-fallback-applied") === "true") return;
          image.setAttribute("data-webp-fallback-applied", "true");
          image.src = image.src.replace(/\.webp(\?.*)?$/i, ".png$1");
        },
        { once: true },
      );
    }
  }
}

/** Keeps the host as tall as the bar plus the visible pane, so the footer never jumps into it. */
function setupHeightSync(host: HTMLElement): () => void {
  let frame = 0;
  const sync = (): void => {
    const pane =
      host.querySelector(".tab-content .tab-pane:not(.hidden)") ?? host.querySelector(".tab-content .tab-pane");
    if (!(pane instanceof HTMLElement)) return;
    const bar = host.querySelector<HTMLElement>(".bar-area");
    const barHeight = bar ? bar.offsetHeight : 56;
    const contentHeight = Math.max(pane.scrollHeight || 0, pane.offsetHeight || 0);
    host.style.minHeight = `${String(Math.max(420, Math.ceil(barHeight + contentHeight + 12)))}px`;
  };
  const schedule = (): void => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  };
  schedule();
  const later = (): void => {
    window.setTimeout(schedule, 0);
  };
  host.addEventListener("click", later, true);
  host.addEventListener("input", later, true);
  window.addEventListener("resize", schedule);
  const tabContent = host.querySelector(".tab-content");
  if (tabContent) {
    new MutationObserver(schedule).observe(tabContent, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-selected"],
    });
  }
  return schedule;
}

/**
 * sliders.js paints its range sliders from window.onload, written for a page that loads it directly. Here
 * it runs after the page has loaded, so the handler would never fire: run it once. (While the page is
 * still loading, the load event runs it as intended.)
 */
function runMissedLoadHandler(): void {
  if (document.readyState === "complete" && typeof window.onload === "function") {
    window.onload.call(window, new Event("load"));
  }
}

function paneStatusHtml(message: string, isError: boolean): string {
  return `<p class="msbl-gear-pane-state${isError ? " is-error" : ""}" role="status">${message}</p>`;
}

/** Loads a character's pane the first time its tab is chosen; a failed load can be retried. */
function setupLazyPanes(host: HTMLElement, observer: MutationObserver, schedule: () => void): void {
  const loading = new Map<string, Promise<HTMLElement | null>>();

  const ensurePane = (paneId: string): Promise<HTMLElement | null> => {
    const config = CHARACTER_PANES.get(paneId);
    const pane = host.querySelector<HTMLElement>(`.tab-pane[id="${paneId}"]`);
    if (!config || !pane) return Promise.resolve(null);
    if (pane.getAttribute("data-pane-load-state") === "loaded") return Promise.resolve(pane);
    const pending = loading.get(paneId);
    if (pending) return pending;

    pane.setAttribute("data-pane-load-state", "loading");
    pane.innerHTML = paneStatusHtml("Loading character...", false);
    schedule();
    const request = fetch(config.url, { headers: { Accept: "text/html" } })
      .then((response) => {
        if (!response.ok) throw new Error("Pane request failed.");
        return response.text();
      })
      .then((markup) => {
        const template = document.createElement("template");
        template.innerHTML = preferWebp(markup).trim();
        const source = template.content.querySelector(".tab-pane");
        if (source?.id !== paneId) throw new Error(`Gear Builder pane markup did not match ${paneId}.`);
        pane.innerHTML = source.innerHTML;
        pane.setAttribute("data-pane-load-state", "loaded");
        attachWebpFallbacks(pane);
        syncPaneOverlays(pane);
        for (const value of Array.from(pane.querySelectorAll(".cardstat .stat"))) {
          observer.observe(value, { childList: true, characterData: true, subtree: true });
        }
        window.MSBL_GEAR_PRESETS?.restoreDraftForCharacter?.(config.characterId);
        syncPaneOverlays(pane);
        schedule();
        loading.delete(paneId);
        return pane;
      })
      .catch((error: unknown) => {
        pane.setAttribute("data-pane-load-state", "error");
        pane.innerHTML = paneStatusHtml("Failed to load character.", true);
        schedule();
        loading.delete(paneId);
        throw error;
      });
    loading.set(paneId, request);
    return request;
  };

  host.addEventListener(
    "click",
    (event) => {
      const tab =
        event.target instanceof Element ? event.target.closest('.tab-link-icon[aria-controls^="tab-"]') : null;
      const paneId = tab?.getAttribute("aria-controls") ?? "";
      if (!CHARACTER_PANES.has(paneId)) return;
      ensurePane(paneId).catch(() => {
        // The pane shows the error itself.
      });
    },
    true,
  );
}

export async function initGearBuilder(host: HTMLElement): Promise<void> {
  const status = (message: string, isError: boolean): string =>
    `<p class="msbl-gear-builder-note${isError ? " is-error" : ""}">${message}</p>`;
  host.innerHTML = status("Loading...", false);
  try {
    const response = await fetch(TEMPLATE_URL, { headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error("Template request failed.");
    host.innerHTML = preferWebp(await response.text());
    attachWebpFallbacks(host);
    for (const script of SCRIPTS) await loadScript(script);
    runMissedLoadHandler();
    const observer = statObserver();
    const schedule = setupHeightSync(host);
    setupLazyPanes(host, observer, schedule);
    schedule();
  } catch {
    host.innerHTML = status("Failed to load Gear Builder.", true);
  }
}
