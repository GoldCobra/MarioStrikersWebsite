// Shrinks an element's font until its text fits its width (club names in the list and the popup).

export function scaleFitText(element: HTMLElement | null | undefined, minPx = 7): void {
  if (!element) return;
  element.style.fontSize = "";
  if (element.scrollWidth <= element.clientWidth) return;
  const baseSize = parseFloat(window.getComputedStyle(element).fontSize);
  const ratio = element.clientWidth / element.scrollWidth;
  element.style.fontSize = `${Math.max(minPx, Math.floor(baseSize * ratio * 10) / 10)}px`;
}
