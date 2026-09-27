(function () {
  "use strict";

  function getPageKey() {
    var body = document.body;
    if (!body) {
      return "";
    }
    return String(body.getAttribute("data-page") || "").toLowerCase();
  }

  function getGameCode(pageKey) {
    if (pageKey.indexOf("sms") === 0) {
      return "sms";
    }
    if (pageKey.indexOf("msc") === 0) {
      return "msc";
    }
    if (pageKey.indexOf("msbl") === 0) {
      return "msbl";
    }
    return "";
  }

  function getRulesConfig() {
    var root = window.COMPETITIVE_RULES_CONFIG || {};
    return {
      shared: root.sharedSections || {},
      games: root.gameConfigs || {}
    };
  }

  function chapterId(gameCode, chapterNumber) {
    return gameCode + "-rules-" + chapterNumber;
  }

  function subsectionId(gameCode, chapterNumber, subsectionNumber) {
    return gameCode + "-rules-" + chapterNumber + "-" + subsectionNumber;
  }

  function renderSubsection(gameCode, chapterNumber, subsectionNumber, subsection) {
    var blocks = Array.isArray(subsection.blocks) ? subsection.blocks.join("") : "";
    return [
      '<section class="cr-subsection" id="', subsectionId(gameCode, chapterNumber, subsectionNumber), '">',
      '<h3>', chapterNumber, '.', subsectionNumber, ' ', subsection.title, '</h3>',
      blocks,
      '</section>'
    ].join("");
  }

  function renderContentBox(sectionId, innerHtml, extraClassName) {
    var className = ["content-box", "cr-section"];

    if (extraClassName) {
      className.push(extraClassName);
    }

    return [
      '<section class="', className.join(" "), '" id="', sectionId, '">',
      '<div class="content-box-top" aria-hidden="true">',
      '<div class="content-box-top-left"></div>',
      '<div class="content-box-top-main"></div>',
      '</div>',
      '<div class="content-box-center">',
      '<div class="content-box-texture" aria-hidden="true"></div>',
      '<div class="content-box-content">',
      innerHtml,
      '</div>',
      '</div>',
      '<div class="content-box-bottom" aria-hidden="true"></div>',
      '</section>'
    ].join("");
  }

  function renderChapter(gameCode, chapterNumber, chapter) {
    var subsections = Array.isArray(chapter.subsections) ? chapter.subsections : [];
    return renderContentBox(chapterId(gameCode, chapterNumber), [
      '<h2>', chapterNumber, '. ', chapter.title, '</h2>',
      subsections.map(function (subsection, index) {
        return renderSubsection(gameCode, chapterNumber, index + 1, subsection);
      }).join("")
    ].join(""));
  }

  function buildDisruptionsChapter(shared, gameConfig) {
    var core = shared.disruptionsCore || { title: "Match Disruptions & Technical Issues", subsections: [] };
    var additionsContainer = gameConfig.disruptionsAdditions || { subsections: [] };
    var additions = Array.isArray(additionsContainer.subsections) ? additionsContainer.subsections : [];

    return {
      title: core.title,
      subsections: (Array.isArray(core.subsections) ? core.subsections.slice() : []).concat(additions)
    };
  }

  function buildRulesModel(pageKey) {
    var configRoot = getRulesConfig();
    var gameCode = getGameCode(pageKey);
    var gameConfig = configRoot.games[gameCode];

    if (!gameCode || !gameConfig) {
      return null;
    }

    var shared = configRoot.shared;
    var chapters = [
      shared.intro,
      shared.universal,
      gameConfig.gameSpecific,
      buildDisruptionsChapter(shared, gameConfig),
      shared.scheduling,
      shared.codeOfConduct
    ];

    return {
      gameCode: gameCode,
      pageTitle: gameConfig.pageTitle,
      revisedText: gameConfig.revisedText,
      sourceHref: gameConfig.sourceHref,
      sourceLabel: gameConfig.sourceLabel,
      chapters: chapters
    };
  }

  function renderRulesPage(model) {
    var mount = document.getElementById("competitive-rules-root");
    if (!mount) {
      return;
    }

    mount.innerHTML = [
      '<header class="competitive-rules-header" aria-label="', model.gameCode.toUpperCase(), ' rules header">',
      '<h1 class="cr-page-title">', model.pageTitle, '</h1>',
      '<p class="cr-page-revised">', model.revisedText, '</p>',
      '</header>',
      '<article class="competitive-rules content-box-list" aria-label="', model.gameCode.toUpperCase(), ' competitive rules">',
      model.chapters.map(function (chapter, index) {
        return renderChapter(model.gameCode, index + 1, chapter || { title: "", subsections: [] });
      }).join(""),
      '<p class="cr-note">Source document: <a class="cr-link" href="', model.sourceHref, '" target="_blank" rel="noopener noreferrer">', model.sourceLabel, '</a></p>',
      '</article>'
    ].join("");
  }

  function initCompetitiveRulesPage() {
    var pageKey = getPageKey();
    var model = buildRulesModel(pageKey);
    if (!model) {
      return;
    }

    renderRulesPage(model);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCompetitiveRulesPage);
    return;
  }

  initCompetitiveRulesPage();
})();
