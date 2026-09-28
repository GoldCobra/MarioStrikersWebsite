// The MSC Wiimmfi page: who is online right now, reloaded every minute with a countdown to the next
// update.

import { escapeHtml } from "@ms/shared/html";
import { toText } from "@ms/shared/text";

interface OnlinePlayer {
  readonly name?: unknown;
  readonly friend_code?: unknown;
  readonly region?: unknown;
}

const REFRESH_SECONDS = 60;

const REGION_LABELS: Readonly<Record<string, string>> = {
  R4QP: "PAL",
  R4QE: "NTSC-U",
  R4QJ: "NTSC-J",
  R4QK: "NTSC-K",
};

function clockTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}

function regionLabel(region: unknown): string {
  const code = toText(region);
  return (Object.hasOwn(REGION_LABELS, code) ? REGION_LABELS[code] : undefined) ?? (code || "–");
}

function playersHtml(players: readonly OnlinePlayer[]): string {
  if (!players.length) return '<p class="online-editor-empty">No players online.</p>';
  const rows = players
    .map(
      (player) =>
        '<tr class="online-editor-separator-row" aria-hidden="true"><td colspan="3"><span class="online-editor-row-separator"></span></td></tr>' +
        "<tr>" +
        `<td><span class="online-editor-roster-name">${escapeHtml(toText(player.name))}</span></td>` +
        `<td><span class="online-editor-roster-code">${escapeHtml(toText(player.friend_code))}</span></td>` +
        `<td><span class="wiimmfi-region">${escapeHtml(regionLabel(player.region))}</span></td>` +
        "</tr>",
    )
    .join("");
  return (
    '<table class="online-editor-table">' +
    "<thead><tr>" +
    '<th><span class="online-editor-roster-name">' +
    '<span class="online-editor-roster-header-muted">Online Now </span>' +
    `<span class="online-editor-roster-count">${players.length}</span>` +
    "</span></th>" +
    '<th><span class="online-editor-roster-code online-editor-roster-header-muted">Friend Code</span></th>' +
    '<th><span class="wiimmfi-region-head online-editor-roster-header-muted">Region</span></th>' +
    "</tr></thead>" +
    `<tbody>${rows}</tbody>` +
    "</table>" +
    `<p class="wiimmfi-last-updated" id="wiimmfi-last-updated">Updated: ${escapeHtml(clockTime(new Date()))}</p>`
  );
}

export function initWiimmfi(results: HTMLElement): void {
  let countdown: number | undefined;

  const startCountdown = (): void => {
    window.clearInterval(countdown);
    let seconds = REFRESH_SECONDS;
    countdown = window.setInterval(() => {
      seconds -= 1;
      const updated = document.getElementById("wiimmfi-last-updated");
      if (updated) {
        const base = updated.getAttribute("data-base-text") || (updated.textContent.split(" – ")[0] ?? "");
        updated.setAttribute("data-base-text", base);
        updated.textContent = `${base} – next update in ${seconds}s`;
      }
      if (seconds <= 0) window.clearInterval(countdown);
    }, 1000);
  };

  const load = async (): Promise<void> => {
    try {
      const response = await fetch("/api/wiimmfi/msc-charged", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { players?: unknown } | null;
      results.innerHTML = playersHtml(Array.isArray(data?.players) ? (data.players as OnlinePlayer[]) : []);
      startCountdown();
    } catch {
      results.innerHTML = '<p class="online-editor-empty">Could not load data.</p>';
    }
  };

  void load();
  window.setInterval(() => void load(), REFRESH_SECONDS * 1000);
}
