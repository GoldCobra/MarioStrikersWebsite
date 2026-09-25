// Shared rating cards exposed as window.MSCRatingCards.
//
// The profile page (profile-page.js) and the player popup (players-engine.js) render the
// same cards; only the class prefix differs ("profile" / "player-popup"). This is the single
// source of truth for their markup. It must be loaded (defer) BEFORE either engine; they
// render no rating cards if it is somehow absent.
//
// Two layouts exist. To switch, change RATING_CARD_LAYOUT, bump this file's ?v= in every
// loader and release:
//   "compact" - rank icon top right, game code just below the middle, rating bottom left,
//               WHR/TST bottom right.
//   "classic" - the label/value list: Rating, Matches, WHR/TST, Games.
(function () {
  "use strict";

  var RATING_CARD_LAYOUT = "compact";

  var SINGLES_CARDS = [
    { key: "msbl", title: "MSBL", game: "msbl", metricKey: "whr", metricLabel: "WHR" },
    { key: "msc", title: "MSC", game: "msc", metricKey: "whr", metricLabel: "WHR" },
    { key: "sms", title: "SMS", game: "sms", metricKey: "whr", metricLabel: "WHR" }
  ];

  var DOUBLES_CARDS = [
    { key: "msbl2v2", title: "MSBL 2v2", game: "msbl", metricKey: "tst", metricLabel: "TST" },
    { key: "msc2v2", title: "MSC 2v2", game: "msc", metricKey: "tst", metricLabel: "TST" },
    { key: "sms2v2", title: "SMS 2v2", game: "sms", metricKey: "tst", metricLabel: "TST" }
  ];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hasDisplayText(value) {
    var text = String(value || "").trim();
    return text !== "" && text !== "-";
  }

  function isZeroRecord(value) {
    return /^0\s*-\s*0$/.test(String(value || "").trim());
  }

  function toRewardWins(value, fallback) {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(0, Math.floor(parsed));
  }

  // Everything a card is built from, read once so both layouts show exactly the same cards.
  function readCard(definition, ratings) {
    var rating = ratings && ratings[definition.key] ? ratings[definition.key] : {};
    var metricValue = Number.isFinite(rating[definition.metricKey]) ? rating[definition.metricKey] : null;
    var card = {
      definition: definition,
      ratingValue: Number.isFinite(rating.rating) ? rating.rating : null,
      metricValue: metricValue,
      setsValue: String(rating.sets || ""),
      gamesValue: String(rating.games || ""),
      rankIconUrl: String(rating.rank_icon_url || ""),
      rankName: String(rating.competitive_rank || "").trim(),
      rewardLevel: rating.season_reward_level
    };
    card.isVisible = card.ratingValue !== null
      || card.rankIconUrl !== ""
      || hasDisplayText(card.setsValue)
      || card.metricValue !== null
      || hasDisplayText(card.gamesValue);
    card.isInactive = isZeroRecord(card.setsValue) || isZeroRecord(card.gamesValue);
    return card;
  }

  function buildRatingLine(prefix, label, value, leadingHtml, trailingHtml, valueClassName) {
    var valueClass = prefix + "-rating-value" + (valueClassName ? " " + valueClassName : "");
    return [
      '<p class="', prefix, '-rating-line">',
      '<span class="', prefix, '-rating-label">', escapeHtml(label), ':</span>',
      leadingHtml || "",
      '<span class="' + valueClass + '">', escapeHtml(String(value)), "</span>",
      trailingHtml || "",
      "</p>"
    ].join("");
  }

  function buildClassicBody(prefix, card) {
    var rankIconHtml = card.rankIconUrl
      ? '<img class="' + prefix + '-rank-icon" src="' + escapeHtml(card.rankIconUrl) + '" alt="" aria-hidden="true" loading="lazy">'
      : "";
    var lines = [];

    if (card.ratingValue !== null) {
      lines.push(buildRatingLine(prefix, "Rating", card.ratingValue, rankIconHtml));
    } else if (rankIconHtml) {
      lines.push(buildRatingLine(prefix, "Rank", "", rankIconHtml));
    }
    if (hasDisplayText(card.setsValue)) {
      lines.push(buildRatingLine(prefix, "Matches", card.setsValue));
    }
    if (card.metricValue !== null) {
      lines.push(buildRatingLine(prefix, card.definition.metricLabel, card.metricValue, "", "", "is-muted-stat-value"));
    }
    if (hasDisplayText(card.gamesValue)) {
      lines.push(buildRatingLine(prefix, "Games", card.gamesValue, "", "", "is-muted-stat-value"));
    }

    return [
      '<h4 class="', prefix, '-rating-title">', escapeHtml(card.definition.title), "</h4>",
      lines.join("")
    ].join("");
  }

  // Each element sits in a fixed grid cell (global.css), so a missing value leaves its spot empty.
  function buildCompactBody(prefix, card) {
    var parts = [];

    if (card.rankIconUrl) {
      // The icon stands alone here, so it carries the rank name itself.
      var rankLabel = card.rankName
        ? ' alt="' + escapeHtml(card.rankName) + '" title="' + escapeHtml(card.rankName) + '"'
        : ' alt="" aria-hidden="true"';
      parts.push('<img class="' + prefix + '-rating-compact-rank" src="' + escapeHtml(card.rankIconUrl) + '"' + rankLabel + ' loading="lazy">');
    }
    parts.push('<h4 class="' + prefix + '-rating-compact-title">' + escapeHtml(card.definition.title) + "</h4>");
    if (card.ratingValue !== null) {
      parts.push([
        '<p class="', prefix, '-rating-compact-value">',
        '<span class="visually-hidden">Rating </span>', escapeHtml(String(card.ratingValue)),
        "</p>"
      ].join(""));
    }
    if (card.metricValue !== null) {
      parts.push([
        '<p class="', prefix, '-rating-compact-metric">',
        '<span class="', prefix, '-rating-compact-metric-label">', escapeHtml(card.definition.metricLabel), "</span> ",
        '<span class="', prefix, '-rating-compact-metric-value">', escapeHtml(String(card.metricValue)), "</span>",
        "</p>"
      ].join(""));
    }

    return parts.join("");
  }

  function buildRatingReward(prefix, rewardLevel) {
    var reward = rewardLevel || {};
    var imageUrl = String(reward.image_url || "").trim();
    var name = String(reward.name || "Unranked").trim() || "Unranked";
    var requiredWins = Math.max(1, toRewardWins(reward.required_wins, 5));
    var currentWins = Math.min(requiredWins, toRewardWins(reward.current_wins, 0));
    var tierOrder = Number(reward.order);
    var normalizedTierOrder = Number.isFinite(tierOrder) ? Math.max(0, Math.min(7, Math.floor(tierOrder))) : 0;
    var tierClass = " is-reward-tier-" + normalizedTierOrder;
    if (normalizedTierOrder > 0 && currentWins >= requiredWins) {
      tierClass += " is-reward-complete";
    }
    var progressLabel = normalizedTierOrder > 0 ? "Season Reward Level" : "Matches";
    if (!imageUrl) {
      return "";
    }

    return [
      '<div class="', prefix, '-rating-reward', tierClass, '">',
      '<div class="', prefix, '-rating-reward-main">',
      '<span class="', prefix, '-rating-reward-icon-wrap">',
      '<img class="', prefix, '-rating-reward-icon" src="', escapeHtml(imageUrl), '" alt="', escapeHtml(name), '" title="', escapeHtml(name), '" loading="lazy">',
      '</span>',
      '<span class="', prefix, '-rating-reward-name">', escapeHtml(name), "</span>",
      "</div>",
      '<div class="', prefix, '-rating-reward-rule" aria-hidden="true"></div>',
      '<p class="', prefix, '-rating-reward-progress">',
      '<span>', escapeHtml(progressLabel), '</span>',
      '<strong>', escapeHtml(currentWins + "/" + requiredWins), "</strong>",
      "</p>",
      "</div>"
    ].join("");
  }

  function buildCards(definitions, ratings, prefix, layout) {
    var isCompact = (layout || RATING_CARD_LAYOUT) === "compact";

    return definitions.map(function (definition) {
      var card = readCard(definition, ratings);
      if (!card.isVisible) {
        return "";
      }

      var cardClass = prefix + "-rating-card is-" + definition.game + "-rating";
      if (isCompact) {
        cardClass += " is-compact-layout";
      }
      if (card.isInactive) {
        cardClass += " is-inactive-rating";
      }

      return [
        '<div class="', prefix, '-rating-unit">',
        '<article class="', cardClass, '">',
        isCompact ? buildCompactBody(prefix, card) : buildClassicBody(prefix, card),
        "</article>",
        buildRatingReward(prefix, card.rewardLevel),
        "</div>"
      ].join("");
    }).join("");
  }

  window.MSCRatingCards = Object.freeze({
    layout: RATING_CARD_LAYOUT,
    // layout is optional and defaults to RATING_CARD_LAYOUT; tests pass it to cover both.
    buildSingles: function (ratings, prefix, layout) {
      return buildCards(SINGLES_CARDS, ratings, prefix, layout);
    },
    buildDoubles: function (ratings, prefix, layout) {
      return buildCards(DOUBLES_CARDS, ratings, prefix, layout);
    }
  });
})();
