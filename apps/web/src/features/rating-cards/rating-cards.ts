// The rating cards of the profile page and the player popup: the same markup, only the class prefix
// differs ("profile" / "player-popup").
//
// Two layouts exist; RATING_CARD_LAYOUT picks one (owner decision: compact):
//   "compact" - season reward level above the card; in the card the rank icon top right and, stacked
//               bottom left, game code, rank name and ELO rating; WHR/TST bottom right.
//   "classic" - the label/value list: Rating, Matches, WHR/TST, Games; reward level below.

import { escapeHtml } from "@ms/shared/html";

export type RatingCardLayout = "compact" | "classic";

export const RATING_CARD_LAYOUT: RatingCardLayout = "compact";

export interface SeasonRewardLevel {
  readonly image_url?: unknown;
  readonly name?: unknown;
  readonly required_wins?: unknown;
  readonly current_wins?: unknown;
  readonly order?: unknown;
}

/** One game's entry of a profile's ratings, as the API sends it. */
export interface RatingData {
  readonly rating?: unknown;
  readonly whr?: unknown;
  readonly tst?: unknown;
  readonly sets?: unknown;
  readonly games?: unknown;
  readonly rank_icon_url?: unknown;
  readonly competitive_rank?: unknown;
  readonly season_reward_level?: SeasonRewardLevel | null;
}

export type Ratings = Readonly<Record<string, RatingData | undefined>>;

interface CardDefinition {
  readonly key: string;
  readonly title: string;
  readonly game: string;
  readonly metricKey: "whr" | "tst";
  readonly metricLabel: string;
}

const SINGLES_CARDS: readonly CardDefinition[] = [
  { key: "msbl", title: "MSBL", game: "msbl", metricKey: "whr", metricLabel: "WHR" },
  { key: "msc", title: "MSC", game: "msc", metricKey: "whr", metricLabel: "WHR" },
  { key: "sms", title: "SMS", game: "sms", metricKey: "whr", metricLabel: "WHR" },
];

const DOUBLES_CARDS: readonly CardDefinition[] = [
  { key: "msbl2v2", title: "MSBL 2v2", game: "msbl", metricKey: "tst", metricLabel: "TST" },
  { key: "msc2v2", title: "MSC 2v2", game: "msc", metricKey: "tst", metricLabel: "TST" },
  { key: "sms2v2", title: "SMS 2v2", game: "sms", metricKey: "tst", metricLabel: "TST" },
];

interface Card {
  readonly definition: CardDefinition;
  readonly ratingValue: number | null;
  readonly metricValue: number | null;
  readonly setsValue: string;
  readonly gamesValue: string;
  readonly rankIconUrl: string;
  readonly rankName: string;
  readonly rewardLevel: SeasonRewardLevel | null | undefined;
  readonly isVisible: boolean;
  readonly isInactive: boolean;
}

function text(value: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- API strings and numbers
  return value ? String(value) : "";
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasDisplayText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== "-";
}

function isZeroRecord(value: string): boolean {
  return /^0\s*-\s*0$/.test(value.trim());
}

function rewardWins(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

/** Everything a card is built from, read once so both layouts show exactly the same cards. */
function readCard(definition: CardDefinition, ratings: Ratings | null | undefined): Card {
  const rating = ratings?.[definition.key] ?? {};
  const ratingValue = finite(rating.rating);
  const metricValue = finite(rating[definition.metricKey]);
  const setsValue = text(rating.sets);
  const gamesValue = text(rating.games);
  const rankIconUrl = text(rating.rank_icon_url);
  return {
    definition,
    ratingValue,
    metricValue,
    setsValue,
    gamesValue,
    rankIconUrl,
    rankName: text(rating.competitive_rank).trim(),
    rewardLevel: rating.season_reward_level,
    isVisible:
      ratingValue !== null ||
      rankIconUrl !== "" ||
      hasDisplayText(setsValue) ||
      metricValue !== null ||
      hasDisplayText(gamesValue),
    isInactive: isZeroRecord(setsValue) || isZeroRecord(gamesValue),
  };
}

function ratingLine(prefix: string, label: string, value: string | number, leading = "", valueClass = ""): string {
  return [
    `<p class="${prefix}-rating-line">`,
    `<span class="${prefix}-rating-label">${escapeHtml(label)}:</span>`,
    leading,
    `<span class="${prefix}-rating-value${valueClass ? ` ${valueClass}` : ""}">${escapeHtml(value)}</span>`,
    "</p>",
  ].join("");
}

function classicBody(prefix: string, card: Card): string {
  const rankIcon = card.rankIconUrl
    ? `<img class="${prefix}-rank-icon" src="${escapeHtml(card.rankIconUrl)}" alt="" aria-hidden="true" loading="lazy">`
    : "";
  const lines: string[] = [];
  if (card.ratingValue !== null) lines.push(ratingLine(prefix, "Rating", card.ratingValue, rankIcon));
  else if (rankIcon) lines.push(ratingLine(prefix, "Rank", "", rankIcon));
  if (hasDisplayText(card.setsValue)) lines.push(ratingLine(prefix, "Matches", card.setsValue));
  if (card.metricValue !== null) {
    lines.push(ratingLine(prefix, card.definition.metricLabel, card.metricValue, "", "is-muted-stat-value"));
  }
  if (hasDisplayText(card.gamesValue))
    lines.push(ratingLine(prefix, "Games", card.gamesValue, "", "is-muted-stat-value"));
  return `<h4 class="${prefix}-rating-title">${escapeHtml(card.definition.title)}</h4>${lines.join("")}`;
}

/** Each element sits in a fixed grid cell (rating-cards.css), so a missing value leaves its spot empty. */
function compactBody(prefix: string, card: Card): string {
  const parts: string[] = [];
  if (card.rankIconUrl) {
    // Decorative: the rank name is written out below the game code.
    parts.push(
      `<img class="${prefix}-rating-compact-rank" src="${escapeHtml(card.rankIconUrl)}" alt="" aria-hidden="true" loading="lazy">`,
    );
  }
  parts.push(`<h4 class="${prefix}-rating-compact-title">${escapeHtml(card.definition.title)}</h4>`);
  if (card.rankName) parts.push(`<p class="${prefix}-rating-compact-rank-name">${escapeHtml(card.rankName)}</p>`);
  if (card.ratingValue !== null) {
    parts.push(
      `<p class="${prefix}-rating-compact-value"><span class="visually-hidden">Rating </span>${escapeHtml(card.ratingValue)}</p>`,
    );
  }
  if (card.metricValue !== null) {
    parts.push(
      [
        `<p class="${prefix}-rating-compact-metric">`,
        `<span class="${prefix}-rating-compact-metric-label">${escapeHtml(card.definition.metricLabel)}</span> `,
        `<span class="${prefix}-rating-compact-metric-value">${escapeHtml(card.metricValue)}</span>`,
        "</p>",
      ].join(""),
    );
  }
  return parts.join("");
}

function ratingReward(prefix: string, rewardLevel: SeasonRewardLevel | null | undefined): string {
  const reward = rewardLevel ?? {};
  const imageUrl = text(reward.image_url).trim();
  const name = text(reward.name || "Unranked").trim() || "Unranked";
  const requiredWins = Math.max(1, rewardWins(reward.required_wins, 5));
  const currentWins = Math.min(requiredWins, rewardWins(reward.current_wins, 0));
  const order = Number(reward.order);
  const tier = Number.isFinite(order) ? Math.max(0, Math.min(7, Math.floor(order))) : 0;
  const tierClass = ` is-reward-tier-${tier}` + (tier > 0 && currentWins >= requiredWins ? " is-reward-complete" : "");
  const progressLabel = tier > 0 ? "Season Reward Level" : "Matches";
  if (!imageUrl) return "";
  return [
    `<div class="${prefix}-rating-reward${tierClass}">`,
    `<div class="${prefix}-rating-reward-main">`,
    `<span class="${prefix}-rating-reward-icon-wrap">`,
    `<img class="${prefix}-rating-reward-icon" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" title="${escapeHtml(name)}" loading="lazy">`,
    "</span>",
    `<span class="${prefix}-rating-reward-name">${escapeHtml(name)}</span>`,
    "</div>",
    `<div class="${prefix}-rating-reward-rule" aria-hidden="true"></div>`,
    `<p class="${prefix}-rating-reward-progress">`,
    `<span>${escapeHtml(progressLabel)}</span>`,
    `<strong>${escapeHtml(`${currentWins}/${requiredWins}`)}</strong>`,
    "</p>",
    "</div>",
  ].join("");
}

function buildCards(
  definitions: readonly CardDefinition[],
  ratings: Ratings | null | undefined,
  prefix: string,
  layout: RatingCardLayout,
): string {
  const compact = layout === "compact";
  return definitions
    .map((definition) => {
      const card = readCard(definition, ratings);
      if (!card.isVisible) return "";
      const cardClass =
        `${prefix}-rating-card is-${definition.game}-rating` +
        (compact ? " is-compact-layout" : "") +
        (card.isInactive ? " is-inactive-rating" : "");
      const reward = ratingReward(prefix, card.rewardLevel);
      const article = `<article class="${cardClass}">${compact ? compactBody(prefix, card) : classicBody(prefix, card)}</article>`;
      // The compact layout puts the season reward level above the card, the classic one below.
      return `<div class="${prefix}-rating-unit">${compact ? reward + article : article + reward}</div>`;
    })
    .join("");
}

export function buildSingles(ratings: Ratings | null | undefined, prefix: string, layout = RATING_CARD_LAYOUT): string {
  return buildCards(SINGLES_CARDS, ratings, prefix, layout);
}

export function buildDoubles(ratings: Ratings | null | undefined, prefix: string, layout = RATING_CARD_LAYOUT): string {
  return buildCards(DOUBLES_CARDS, ratings, prefix, layout);
}
