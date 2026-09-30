// Size of the Discord card (/player-card, the popup's is-card mode). Discord shows a message image of
// at most 550 x 350px 1:1 from the file and scales a larger one, which blurs the text. So the card is
// 550px wide and as tall as its content, rounded up to a whole pixel; a card that would be taller
// than 350px is scaled down as a whole (CSS zoom, so the text stays sharp) instead of being cut off.

export const CARD_WIDTH = 550;
export const CARD_MAX_HEIGHT = 350;

/** The zoom for a card of this height: 1 up to 350px, else the largest whole-pixel width that fits. */
export function cardZoom(height: number): number {
  if (!(height > CARD_MAX_HEIGHT)) return 1;
  return Math.floor((CARD_WIDTH * CARD_MAX_HEIGHT) / height) / CARD_WIDTH;
}

/** The card's own min-height that rounds its shown height up to the next whole pixel. */
export function wholePixelMinHeight(shownHeight: number, zoom: number): number {
  return Math.ceil(shownHeight - 0.001) / zoom;
}

/** Sizes the rendered card: its own height on whole pixels, never more than 350px. */
export function fitPlayerCard(card: HTMLElement): void {
  card.style.zoom = "";
  card.style.minHeight = "";
  let zoom = cardZoom(card.getBoundingClientRect().height);
  for (;;) {
    card.style.zoom = zoom < 1 ? String(zoom) : "";
    const shown = card.getBoundingClientRect().height;
    // Lines round per font size, so a zoomed card can end a fraction taller than planned.
    if (Math.ceil(shown - 0.001) <= CARD_MAX_HEIGHT || zoom <= 0.5) {
      card.style.minHeight = `${wholePixelMinHeight(shown, zoom)}px`;
      return;
    }
    zoom = (Math.round(zoom * CARD_WIDTH) - 1) / CARD_WIDTH;
  }
}
