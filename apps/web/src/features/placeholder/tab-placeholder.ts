// The placeholder page (development only): shows "under review", "under construction" or "TBA" from
// ?state=, and its switches change the state without a reload.

const STATES = {
  review: "UNDER REVIEW...",
  construction: "UNDER CONSTRUCTION...",
  tba: "TBA...",
} as const;

type State = keyof typeof STATES;

function toState(raw: string | null): State {
  const key = (raw ?? "").trim().toLowerCase();
  if (key === "under-review" || key === "under_review") return "review";
  if (key === "under-construction" || key === "under_construction") return "construction";
  return Object.hasOwn(STATES, key) ? (key as State) : "review";
}

export function initTabPlaceholder(): void {
  const status = document.getElementById("tab-placeholder-status");
  const switches = Array.from(document.querySelectorAll<HTMLElement>(".tab-placeholder-switch"));
  if (!status || !switches.length) return;
  const params = new URLSearchParams(window.location.search);

  const apply = (raw: string | null): void => {
    const state = toState(raw);
    status.textContent = STATES[state];
    for (const node of switches) {
      const active = node.getAttribute("data-state") === state;
      node.classList.toggle("is-active", active);
      if (active) node.setAttribute("aria-current", "page");
      else node.removeAttribute("aria-current");
    }
  };

  for (const node of switches) {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      const next = node.getAttribute("data-state") ?? "review";
      params.set("state", next);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      apply(next);
    });
  }
  apply(params.get("state"));
}
