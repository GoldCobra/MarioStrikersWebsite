import assert from "node:assert/strict";
import test from "node:test";
import { CARD_MAX_HEIGHT, CARD_WIDTH, cardZoom, wholePixelMinHeight } from "./player-card.ts";

test("a card up to 350px keeps its size, a taller one is scaled down to a whole-pixel width", () => {
  assert.equal(cardZoom(229.4), 1);
  assert.equal(cardZoom(CARD_MAX_HEIGHT), 1);
  assert.equal(cardZoom(700), 0.5);
  const zoom = cardZoom(470.3);
  assert.equal(Math.round(zoom * CARD_WIDTH), 409);
  assert.ok(470.3 * zoom <= CARD_MAX_HEIGHT);
});

test("the shown card height is rounded up to the next whole pixel", () => {
  assert.equal(wholePixelMinHeight(286.67, 1), 287);
  assert.equal(wholePixelMinHeight(287, 1), 287);
  assert.equal(wholePixelMinHeight(349.4, 0.5), 700);
});
