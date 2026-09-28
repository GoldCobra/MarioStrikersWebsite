// Browser helpers the save editors share: the status line under the buttons and file downloads.

export type StatusLevel = "success" | "warning" | "error";

/** The element with this id if it is of the expected kind, else null. */
export function elementById<T extends HTMLElement>(id: string, type: new () => T): T | null {
  const node = document.getElementById(id);
  return node instanceof type ? node : null;
}

/** Shows a message in an editor's status line, coloured by its level (none: neutral). */
export function showStatus(node: HTMLElement | null, message: string, level?: StatusLevel): void {
  if (!node) return;
  node.textContent = message;
  node.classList.remove("is-warning", "is-error", "is-success");
  if (level) node.classList.add(`is-${level}`);
}

/**
 * Saves bytes or text as a file. With an anchor from the page, that anchor is used (and keeps the link
 * of the last export); otherwise a temporary one.
 */
export function downloadFile(
  content: Uint8Array | string,
  type: string,
  fileName: string,
  anchor?: HTMLAnchorElement | null,
): void {
  const part = typeof content === "string" ? content : new Uint8Array(content);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const link = anchor ?? document.createElement("a");
  link.href = url;
  link.download = fileName;
  const temporary = !link.parentNode;
  if (temporary) document.body.appendChild(link);
  link.click();
  if (temporary && !anchor) link.remove();
  URL.revokeObjectURL(url);
}

/** The first file chosen in a file input, or null. */
export function pickedFile(event: Event): File | null {
  const input = event.target;
  return input instanceof HTMLInputElement ? (input.files?.[0] ?? null) : null;
}
