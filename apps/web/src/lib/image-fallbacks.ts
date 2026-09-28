// What an image does when it fails to load, declared in its markup instead of an inline onerror handler
// (which a Content Security Policy blocks):
//   data-fallback-src="url"     load this image instead, once
//   data-fallback-alt="text"    … and use this alt text
//   data-fallback-class="name"  … and add this class
//   data-on-error="remove"      remove the image
//   data-on-error="hide"        hide the image
//   data-on-error="hide-clear"  hide the image and drop its src
// One listener on the document handles every image, including those added later.

const SELECTOR = "img[data-fallback-src], img[data-on-error]";

function handleFailure(image: HTMLImageElement): void {
  const fallback = image.getAttribute("data-fallback-src");
  if (fallback !== null) {
    image.removeAttribute("data-fallback-src");
    const alt = image.getAttribute("data-fallback-alt");
    if (alt !== null) image.alt = alt;
    const className = image.getAttribute("data-fallback-class");
    if (className) image.classList.add(className);
    image.src = fallback;
    return;
  }
  const action = image.getAttribute("data-on-error");
  if (action === "remove") {
    image.remove();
  } else if (action === "hide" || action === "hide-clear") {
    image.hidden = true;
    if (action === "hide-clear") image.removeAttribute("src");
  }
}

export function installImageFallbacks(): void {
  document.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLImageElement && event.target.matches(SELECTOR)) handleFailure(event.target);
    },
    true,
  );
  // Images in the page's own markup may have failed before this module ran.
  for (const image of Array.from(document.querySelectorAll<HTMLImageElement>(SELECTOR))) {
    if (image.complete && image.naturalWidth === 0 && image.getAttribute("src")) handleFailure(image);
  }
}
