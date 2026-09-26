const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const golden = require("./test-support/rating-cards-classic.golden.json");

// js/rating-cards.js is a browser script that registers window.MSCRatingCards.
function loadRatingCards() {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "js", "rating-cards.js"), "utf8");
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context);
  return context.window.MSCRatingCards;
}

const ratingCards = loadRatingCards();

// The <article> of the compact card with the given title.
function compactCard(markup, title) {
  const units = markup.split('<div class="profile-rating-unit">').slice(1);
  const unit = units.find(function (entry) {
    return entry.includes('-rating-compact-title">' + title + "</h4>");
  });
  assert.ok(unit, "no card titled " + title);
  return unit.slice(unit.indexOf("<article"), unit.indexOf("</article>"));
}

test("the compact layout is the default", function () {
  assert.equal(ratingCards.layout, "compact");
  assert.equal(
    ratingCards.buildSingles(golden.ratings, "profile"),
    ratingCards.buildSingles(golden.ratings, "profile", "compact")
  );
});

test("the classic layout renders exactly what the engines rendered before", function () {
  assert.equal(ratingCards.buildSingles(golden.ratings, "profile", "classic"), golden.singles);
  assert.equal(ratingCards.buildDoubles(golden.ratings, "profile", "classic"), golden.doubles);
});

test("the popup gets the same classic cards under its own class prefix", function () {
  assert.equal(
    ratingCards.buildSingles(golden.ratings, "player-popup", "classic"),
    golden.singles.replace(/profile-/g, "player-popup-")
  );
});

test("a compact card shows the rank icon, game code, rank name, rating and WHR only", function () {
  const card = compactCard(ratingCards.buildSingles(golden.ratings, "profile"), "MSBL");

  assert.equal(card, [
    '<article class="profile-rating-card is-msbl-rating is-compact-layout">',
    '<img class="profile-rating-compact-rank" src="/assets/leaderboards/rankicons/3-gold-I.png?v=1" alt="" aria-hidden="true" loading="lazy">',
    '<h4 class="profile-rating-compact-title">MSBL</h4>',
    '<p class="profile-rating-compact-rank-name">Gold I</p>',
    '<p class="profile-rating-compact-value"><span class="visually-hidden">Rating </span>1020</p>',
    '<p class="profile-rating-compact-metric"><span class="profile-rating-compact-metric-label">WHR</span> ',
    '<span class="profile-rating-compact-metric-value">2131</span></p>'
  ].join(""));
  assert.doesNotMatch(card, /Matches|Games|7-0|549-121/);
});

test("a compact card leaves out what the player does not have", function () {
  const card = compactCard(ratingCards.buildSingles(golden.ratings, "profile"), "MSC");

  assert.match(card, /is-msc-rating is-compact-layout is-inactive-rating/);
  assert.doesNotMatch(card, /-rating-compact-rank/);
  assert.doesNotMatch(card, /-rating-compact-value/);
  assert.match(card, /-rating-compact-metric-value">1520</);
});

test("a compact card without a rank name keeps the icon and leaves the rank name out", function () {
  const markup = ratingCards.buildSingles({
    sms: { rating: 700, sets: "1-0", rank_icon_url: "/icon.png" }
  }, "profile");

  assert.match(markup, /<img class="profile-rating-compact-rank" src="\/icon\.png" alt="" aria-hidden="true" loading="lazy">/);
  assert.doesNotMatch(markup, /-rating-compact-rank-name/);
});

test("the season reward level sits above a compact card and below a classic one", function () {
  const compact = ratingCards.buildSingles(golden.ratings, "profile", "compact");
  const classic = ratingCards.buildSingles(golden.ratings, "profile", "classic");

  assert.ok(compact.indexOf('<div class="profile-rating-reward ') < compact.indexOf("<article"));
  assert.ok(classic.indexOf("<article") < classic.indexOf('<div class="profile-rating-reward '));
});

test("compact 2v2 cards keep the full title and show TST", function () {
  const card = compactCard(ratingCards.buildDoubles(golden.ratings, "profile"), "MSBL 2v2");

  assert.match(card, /is-msbl-rating is-compact-layout/);
  assert.match(card, /-rating-compact-metric-label">TST<\/span> <span class="profile-rating-compact-metric-value">983</);
});

test("both layouts show the same cards and the reward block", function () {
  ["classic", "compact"].forEach(function (layout) {
    const singles = ratingCards.buildSingles(golden.ratings, "profile", layout);
    const doubles = ratingCards.buildDoubles(golden.ratings, "profile", layout);

    assert.equal(singles.split('<div class="profile-rating-unit">').length - 1, 3, layout);
    assert.equal(doubles.split('<div class="profile-rating-unit">').length - 1, 2, layout);
    assert.equal(singles.split('<div class="profile-rating-reward ').length - 1, 3, layout);
  });
});

test("an empty rating renders no card in either layout", function () {
  ["classic", "compact"].forEach(function (layout) {
    assert.equal(ratingCards.buildSingles({}, "profile", layout), "", layout);
    assert.equal(ratingCards.buildDoubles({ msbl2v2: {} }, "player-popup", layout), "", layout);
  });
});
