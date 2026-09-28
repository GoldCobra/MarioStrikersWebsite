// Renders a game's competitive rules at build time. Chapters and subsections get stable ids
// (msbl-rules-2, msbl-rules-2-3) that links into the rules rely on.

import { GAME_RULES, SHARED_RULES, type RulesChapter, type RulesSubsection } from "./rules.ts";

export type RulesGame = keyof typeof GAME_RULES;

function subsection(game: RulesGame, chapter: number, index: number, entry: RulesSubsection): string {
  return [
    `<section class="cr-subsection" id="${game}-rules-${chapter}-${index}">`,
    `<h3>${chapter}.${index} ${entry.title}</h3>`,
    entry.blocks.join(""),
    "</section>",
  ].join("");
}

function contentBox(id: string, inner: string): string {
  return [
    `<section class="content-box cr-section" id="${id}">`,
    '<div class="content-box-top" aria-hidden="true">',
    '<div class="content-box-top-left"></div>',
    '<div class="content-box-top-main"></div>',
    "</div>",
    '<div class="content-box-center">',
    '<div class="content-box-texture" aria-hidden="true"></div>',
    `<div class="content-box-content">${inner}</div>`,
    "</div>",
    '<div class="content-box-bottom" aria-hidden="true"></div>',
    "</section>",
  ].join("");
}

function chapter(game: RulesGame, number: number, entry: RulesChapter): string {
  const subsections = entry.subsections.map((item, index) => subsection(game, number, index + 1, item)).join("");
  return contentBox(`${game}-rules-${number}`, `<h2>${number}. ${entry.title}</h2>${subsections}`);
}

/** The chapters in reading order; the disruptions chapter ends with the game's technical additions. */
function chapters(game: RulesGame): RulesChapter[] {
  const rules = GAME_RULES[game];
  return [
    SHARED_RULES.intro,
    SHARED_RULES.universal,
    rules.gameSpecific,
    {
      title: SHARED_RULES.disruptionsCore.title,
      subsections: [...SHARED_RULES.disruptionsCore.subsections, ...rules.disruptionsAdditions.subsections],
    },
    SHARED_RULES.scheduling,
    SHARED_RULES.codeOfConduct,
  ];
}

/** Content of #competitive-rules-root. */
export function renderCompetitiveRules(game: RulesGame): string {
  const rules = GAME_RULES[game];
  const label = game.toUpperCase();
  return [
    `<header class="competitive-rules-header" aria-label="${label} rules header">`,
    `<h1 class="cr-page-title">${rules.pageTitle}</h1>`,
    `<p class="cr-page-revised">${rules.revisedText}</p>`,
    "</header>",
    `<article class="competitive-rules content-box-list" aria-label="${label} competitive rules">`,
    chapters(game)
      .map((entry, index) => chapter(game, index + 1, entry))
      .join(""),
    `<p class="cr-note">Source document: <a class="cr-link" href="${rules.sourceHref}" target="_blank" rel="noopener noreferrer">${rules.sourceLabel}</a></p>`,
    "</article>",
  ].join("");
}
