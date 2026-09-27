// The rating cards of the player profile and popup, rendered from the classic golden.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as ratingCardsModule from "./rating-cards.ts";
import type { Ratings } from "./rating-cards.ts";

interface Golden {
  readonly ratings: Ratings;
  readonly singles: string;
  readonly doubles: string;
}

const golden = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "rating-cards-classic.golden.json"), "utf8"),
) as Golden;

const ratingCards = { ...ratingCardsModule, layout: ratingCardsModule.RATING_CARD_LAYOUT };

// The <article> of the compact card with the given title.
function compactCard(markup: string, title: string): string {
  const units = markup.split('<div class="profile-rating-unit">').slice(1);
  const unit = units.find((entry) => entry.includes(`-rating-compact-title">${title}</h4>`));
  assert.ok(unit, `no card titled ${title}`);
  return unit.slice(unit.indexOf("<article"), unit.indexOf("</article>"));
}

test("the compact layout is the default", () => {
  assert.equal(ratingCards.layout, "compact");
  assert.equal(
    ratingCards.buildSingles(golden.ratings, "profile"),
    ratingCards.buildSingles(golden.ratings, "profile", "compact"),
  );
});

test("the classic layout renders exactly what the engines rendered before", () => {
  assert.equal(ratingCards.buildSingles(golden.ratings, "profile", "classic"), golden.singles);
  assert.equal(ratingCards.buildDoubles(golden.ratings, "profile", "classic"), golden.doubles);
});

test("the popup gets the same classic cards under its own class prefix", () => {
  assert.equal(
    ratingCards.buildSingles(golden.ratings, "player-popup", "classic"),
    golden.singles.replace(/profile-/g, "player-popup-"),
  );
});

test("a compact card shows the rank icon, game code, rank name, rating and WHR only", () => {
  const card = compactCard(ratingCards.buildSingles(golden.ratings, "profile"), "MSBL");

  assert.equal(
    card,
    [
      '<article class="profile-rating-card is-msbl-rating is-compact-layout">',
      '<img class="profile-rating-compact-rank" src="/assets/leaderboards/rankicons/3-gold-I.png?v=1" alt="" aria-hidden="true" loading="lazy">',
      '<h4 class="profile-rating-compact-title">MSBL</h4>',
      '<p class="profile-rating-compact-rank-name">Gold I</p>',
      '<p class="profile-rating-compact-value"><span class="visually-hidden">Rating </span>1020</p>',
      '<p class="profile-rating-compact-metric"><span class="profile-rating-compact-metric-label">WHR</span> ',
      '<span class="profile-rating-compact-metric-value">2131</span></p>',
    ].join(""),
  );
  assert.doesNotMatch(card, /Matches|Games|7-0|549-121/);
});

test("a compact card leaves out what the player does not have", () => {
  const card = compactCard(ratingCards.buildSingles(golden.ratings, "profile"), "MSC");

  assert.match(card, /is-msc-rating is-compact-layout is-inactive-rating/);
  assert.doesNotMatch(card, /-rating-compact-rank/);
  assert.doesNotMatch(card, /-rating-compact-value/);
  assert.match(card, /-rating-compact-metric-value">1520</);
});

test("a compact card without a rank name keeps the icon and leaves the rank name out", () => {
  const markup = ratingCards.buildSingles(
    {
      sms: { rating: 700, sets: "1-0", rank_icon_url: "/icon.png" },
    },
    "profile",
  );

  assert.match(
    markup,
    /<img class="profile-rating-compact-rank" src="\/icon\.png" alt="" aria-hidden="true" loading="lazy">/,
  );
  assert.doesNotMatch(markup, /-rating-compact-rank-name/);
});

test("the season reward level sits above a compact card and below a classic one", () => {
  const compact = ratingCards.buildSingles(golden.ratings, "profile", "compact");
  const classic = ratingCards.buildSingles(golden.ratings, "profile", "classic");

  assert.ok(compact.indexOf('<div class="profile-rating-reward ') < compact.indexOf("<article"));
  assert.ok(classic.indexOf("<article") < classic.indexOf('<div class="profile-rating-reward '));
});

test("compact 2v2 cards keep the full title and show TST", () => {
  const card = compactCard(ratingCards.buildDoubles(golden.ratings, "profile"), "MSBL 2v2");

  assert.match(card, /is-msbl-rating is-compact-layout/);
  assert.match(
    card,
    /-rating-compact-metric-label">TST<\/span> <span class="profile-rating-compact-metric-value">983</,
  );
});

test("both layouts show the same cards and the reward block", () => {
  for (const layout of ["classic", "compact"] as const) {
    const singles = ratingCards.buildSingles(golden.ratings, "profile", layout);
    const doubles = ratingCards.buildDoubles(golden.ratings, "profile", layout);

    assert.equal(singles.split('<div class="profile-rating-unit">').length - 1, 3, layout);
    assert.equal(doubles.split('<div class="profile-rating-unit">').length - 1, 2, layout);
    assert.equal(singles.split('<div class="profile-rating-reward ').length - 1, 3, layout);
  }
});

test("an empty rating renders no card in either layout", () => {
  for (const layout of ["classic", "compact"] as const) {
    assert.equal(ratingCards.buildSingles({}, "profile", layout), "", layout);
    assert.equal(ratingCards.buildDoubles({ msbl2v2: {} }, "player-popup", layout), "", layout);
  }
});
