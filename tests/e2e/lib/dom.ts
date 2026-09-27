// Serializes the rendered document into diff-friendly text. Runs inside the browser via page.evaluate,
// so it must stay self-contained. One node per line; text nodes are JSON strings, so whitespace
// between inline elements (which changes pixels) stays visible in the golden.

export interface DocumentSnapshot {
  body: string;
  head: string;
}

export function snapshotDocument(): DocumentSnapshot {
  const REMOVED_ELEMENTS = "script, style, link, meta, noscript, template, #dev-data-notice";
  // Attributes written by layout measurements or event binding, not by page markup.
  const LAYOUT_ATTRIBUTES = new Set(["style", "data-prefetch-bound", "data-account-bound", "data-gradient-id"]);
  const LAYOUT_CLASSES = ["is-overflowing"];

  const URL_ATTRIBUTES = new Set(["src", "href", "poster", "action"]);

  // Same-origin URLs compare by resolved path, so "./assets/x.png?v=1" equals "/assets/x.png".
  function toPath(value: string): string {
    if (/^(#|mailto:|javascript:|data:)/i.test(value)) return value;
    const url = new URL(value, location.href);
    if (url.origin !== location.origin) return url.href;
    url.searchParams.delete("v");
    return url.pathname.replace(/\/pages\/([a-z0-9-]+)\.html$/, "/$1") + url.search + url.hash;
  }

  const body = document.body.cloneNode(true) as HTMLElement;
  body.querySelectorAll(REMOVED_ELEMENTS).forEach((node) => node.remove());
  body.querySelectorAll("svg.global-tabs-line-overlay").forEach((svg) => {
    svg.replaceChildren();
    for (const attribute of Array.from(svg.attributes)) {
      if (attribute.name !== "class") svg.removeAttribute(attribute.name);
    }
  });

  const lines: string[] = [];
  function serialize(node: Node, depth: number): void {
    const pad = "  ".repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      lines.push(pad + "#text " + JSON.stringify((node as Text).data));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    for (const name of LAYOUT_CLASSES) element.classList.remove(name);
    if (element.getAttribute("class") === "") element.removeAttribute("class");
    const attributes = Array.from(element.attributes)
      .filter((attribute) => !LAYOUT_ATTRIBUTES.has(attribute.name))
      .map((attribute) => " " + attribute.name + "="
        + JSON.stringify(URL_ATTRIBUTES.has(attribute.name) ? toPath(attribute.value) : attribute.value))
      .join("");
    const tag = element.localName;
    if (!element.childNodes.length) {
      lines.push(pad + "<" + tag + attributes + "/>");
      return;
    }
    lines.push(pad + "<" + tag + attributes + ">");
    element.childNodes.forEach((child) => serialize(child, depth + 1));
    lines.push(pad + "</" + tag + ">");
  }
  serialize(body, 0);

  // Head: metadata only. Stylesheets and scripts are delivery details covered by the visual check.
  const head = Array.from(document.head.children)
    .filter((element) => {
      if (element.localName === "style") return false;
      if (element.localName === "script") return (element as HTMLScriptElement).type === "application/ld+json";
      // Prefetch hints depend on idle timing; stylesheets are covered by the visual check.
      if (element.localName === "link") return !["stylesheet", "prefetch"].includes((element as HTMLLinkElement).rel);
      return true;
    })
    .map((element) => {
      if (element.localName === "script") return { tag: "script", json: JSON.parse(element.textContent || "null") as unknown };
      if (element.localName === "title") return { tag: "title", text: element.textContent };
      const attributes: Record<string, string> = {};
      for (const attribute of Array.from(element.attributes)) {
        attributes[attribute.name] = attribute.name === "href" ? toPath(attribute.value) : attribute.value;
      }
      return { tag: element.localName, attributes };
    })
    .map((entry) => JSON.stringify(entry))
    .sort()
    .map((entry) => JSON.parse(entry) as unknown);

  return { body: lines.join("\n") + "\n", head: JSON.stringify(head, null, 2) + "\n" };
}
