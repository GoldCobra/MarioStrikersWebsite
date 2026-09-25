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

function compactCard(markup, title) {
  const cards = markup.split('<div class="profile-rating-unit">').slice(1);
  const card = cards.find(function (entry) {
    return entry.includes('-rating-compact-title">' + title + "</h4>");
  });
  assert.ok(card, "no card titled " + title);
  return card.slice(0, card.indexOf("</article>"));
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

test("a compact card shows the rank icon, game code, rating and WHR only", function () {
  const card = compactCard(ratingCards.buildSingles(golden.ratings, "profile"), "MSBL");

  assert.match(card, /^<article class="profile-rating-card is-msbl-rating is-compact-layout">/);
  assert.match(card, /<img class="profile-rating-compact-rank" src="[^"]+3-gold-I\.png[^"]*" alt="Gold I" title="Gold I" loading="lazy">/);
  assert.match(card, /<h4 class="profile-rating-compact-title">MSBL<\/h4>/);
  assert.match(card, /<p class="profile-rating-compact-value"><span class="visually-hidden">Rating <\/span>1020<\/p>/);
  assert.match(card, /<span class="profile-rating-compact-metric-label">WHR<\/span> <span class="profile-rating-compact-metric-value">2131<\/span>/);
  assert.doesNotMatch(card, /Matches|Games|7-0|549-121/);
});

test("a compact card leaves out what the player does not have", function () {
  const card = compactCard(ratingCards.buildSingles(golden.ratings, "profile"), "MSC");

  assert.match(card, /is-msc-rating is-compact-layout is-inactive-rating/);
  assert.doesNotMatch(card, /-rating-compact-rank/);
  assert.doesNotMatch(card, /-rating-compact-value/);
  assert.match(card, /-rating-compact-metric-value">1520</);
});

test("a compact rank icon without a rank name is hidden from screen readers", function () {
  const markup = ratingCards.buildSingles({
    sms: { rating: 700, sets: "1-0", rank_icon_url: "/icon.png" }
  }, "profile");

  assert.match(markup, /<img class="profile-rating-compact-rank" src="\/icon\.png" alt="" aria-hidden="true" loading="lazy">/);
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
