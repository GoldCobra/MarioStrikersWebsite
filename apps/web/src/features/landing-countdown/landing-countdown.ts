// The home page countdowns: the local season (computed in the browser) and the competitive season
// (from /api/competitive-season/current, on the server's clock). Both tick every second; the competitive
// season is reloaded every minute and shortly after its countdown runs out.

import {
  competitiveSeasonImageName,
  competitiveSeasonPhase,
  countdownSegmentsHtml,
  localSeasonPhase,
  timeMs,
  type CompetitiveSeason,
  type CountdownPhase,
} from "./season-clock.ts";

interface SeasonStatus {
  readonly season?: CompetitiveSeason | null;
  readonly server_now_utc?: unknown;
}

const SEASON_API_URL = "/api/competitive-season/current";
const SEASON_IMAGE_BASE = "/assets/landing/comp-season-";

function renderCountdown(node: HTMLElement, phase: CountdownPhase, segmentsHtml: string): void {
  const headline = node.closest(".landing-club")?.querySelector(".landing-club-headline");
  if (headline) headline.textContent = phase.headline;
  node.innerHTML =
    `<span class="landing-countdown-prefix">${phase.prefix}</span>` +
    `<span class="landing-countdown-group">${segmentsHtml}</span>`;
}

export function initLandingCountdown(): void {
  const localNodes = Array.from(document.querySelectorAll<HTMLElement>("[data-local-season-countdown]"));
  const competitiveNodes = Array.from(document.querySelectorAll<HTMLElement>("[data-competitive-season-countdown]"));
  if (!localNodes.length && !competitiveNodes.length) return;
  const seasonImage = document.querySelector<HTMLImageElement>(".landing-club--competitive-season .landing-club-image");
  const failedImages = new Set<string>();

  let status: SeasonStatus | null = null;
  let serverOffsetMs = 0;
  let requestInFlight = false;
  let refreshAfterTarget = false;

  /** Shows the season's artwork; an image that fails to load restores the previous one for good. The
   * page ships the current season's image, which stays untouched: setting it again would repaint it and
   * delay the largest contentful paint. */
  const applySeasonImage = (season: CompetitiveSeason): void => {
    if (!seasonImage) return;
    const name = competitiveSeasonImageName(season.display_name);
    if (!name || failedImages.has(name)) return;
    const nextSrc = `${SEASON_IMAGE_BASE}${name}.webp`;
    if (seasonImage.src === new URL(nextSrc, document.baseURI).href) return;
    const previousSrc = seasonImage.getAttribute("src");
    const previousAlt = seasonImage.getAttribute("alt");
    seasonImage.onerror = () => {
      seasonImage.onerror = null;
      failedImages.add(name);
      if (previousSrc) {
        seasonImage.setAttribute("src", previousSrc);
        seasonImage.setAttribute("alt", previousAlt ?? "");
      }
    };
    seasonImage.setAttribute("src", nextSrc);
    seasonImage.setAttribute("alt", `Competitive Season ${name.charAt(0).toUpperCase()}${name.slice(1)}`);
  };

  const renderCompetitive = (nowMs: number): void => {
    const season = status?.season;
    if (!competitiveNodes.length || !season) return;
    applySeasonImage(season);
    const phase = competitiveSeasonPhase(season, nowMs);
    const segments = countdownSegmentsHtml(phase.remainingMs);
    for (const node of competitiveNodes) renderCountdown(node, phase, segments);
    if (phase.targetMs && phase.remainingMs <= 0 && !refreshAfterTarget) {
      refreshAfterTarget = true;
      window.setTimeout(() => void loadSeason(), 5000);
    }
  };

  const renderAll = (): void => {
    const nowMs = Date.now() - serverOffsetMs;
    if (localNodes.length) {
      const phase = localSeasonPhase(nowMs);
      const segments = countdownSegmentsHtml(phase.remainingMs);
      for (const node of localNodes) renderCountdown(node, phase, segments);
    }
    renderCompetitive(nowMs);
  };

  const loadSeason = async (): Promise<void> => {
    if (!competitiveNodes.length || requestInFlight) return;
    requestInFlight = true;
    try {
      const response = await fetch(SEASON_API_URL, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`Competitive season API failed with ${response.status}`);
      const payload = (await response.json()) as SeasonStatus | null;
      const serverNowMs = timeMs(payload?.server_now_utc);
      status = payload;
      serverOffsetMs = serverNowMs ? Date.now() - serverNowMs : 0;
      refreshAfterTarget = false;
      renderAll();
    } catch (error) {
      console.warn("[landing-countdown] Competitive season status failed:", error);
    } finally {
      requestInFlight = false;
    }
  };

  renderAll();
  void loadSeason();
  window.setInterval(renderAll, 1000);
  window.setInterval(() => void loadSeason(), 60_000);
}
