// The SAVE mode of the MSC save editor: loads Strikers2, edits the 12 captains' team presets through
// the formation and the icon picker, imports and exports them as XML and exports the patched save with
// the competitive default settings.

import { toPositiveInt } from "@ms/shared/text";
import { downloadFile, elementById, pickedFile, showStatus, type StatusLevel } from "../shared/editor-ui.ts";
import {
  REGIONS,
  captainName,
  checkSave,
  presetXml,
  readTeam,
  sidekickName,
  writeTeams,
  type Region,
  type Team,
} from "./save-core.ts";
import { CAPTAINS, FILE_NAME, SIDEKICKS, TEAM_PRESET_OFFSETS, type Character } from "./save-format.ts";

type Slot = "captain" | "top" | "bottom" | "back";
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const DEFAULT_CAPTAIN = 1;
const FALLBACK_ICON = "../assets/favicon/blball.png";
const ICON_BASE = "../assets/msc-saveeditor";
const SLOTS: readonly Slot[] = ["top", "back", "bottom", "captain"];

function captainKey(id: number): string {
  return CAPTAINS.find((captain) => captain.id === id)?.key ?? "mario";
}

function sidekickFolder(id: number): string {
  const sidekick = SIDEKICKS.find((entry) => entry.id === id);
  return sidekick ? `${String(sidekick.id).padStart(2, "0")}-${sidekick.key}` : "01-koopa";
}

function sidekickKey(id: number): string {
  return SIDEKICKS.find((sidekick) => sidekick.id === id)?.key ?? "koopa";
}

function captainIcon(id: number): string {
  return `${ICON_BASE}/captains/${String(id).padStart(2, "0")}-${captainKey(id)}.png`;
}

/** The sidekick as drawn next to the captain; the Mario version is the fallback. */
function sidekickIcon(id: number, captainId: number): string {
  return `${ICON_BASE}/sidekicks/${sidekickFolder(id)}/${captainKey(captainId)}-${sidekickKey(id)}.png`;
}

function sidekickFallbackIcon(id: number): string {
  return `${ICON_BASE}/sidekicks/${sidekickFolder(id)}/mario-${sidekickKey(id)}.png`;
}

/** Reads an XML-Export file back: exactly the 12 captains, sidekicks 1..8. */
export function parsePresetXml(xmlText: string): Parsed<Record<string, Team>> {
  const fail = (reason: string): Parsed<Record<string, Team>> => ({ ok: false, error: `XML import failed: ${reason}` });
  if (!xmlText.trim().length) return fail("file is empty.");
  const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (xmlDoc.getElementsByTagName("parsererror").length) return fail("invalid XML syntax.");
  const root = xmlDoc.documentElement;
  if (root.tagName !== "msc-presets") return fail("root element must be <msc-presets>.");
  if ((root.getAttribute("version") ?? "") !== "1") return fail("unsupported XML version.");
  const unexpected = Array.from(root.children).find((node) => node.tagName !== "captain");
  if (unexpected) return fail(`unexpected element <${unexpected.tagName}>.`);
  const nodes = Array.from(root.children);
  if (nodes.length !== CAPTAINS.length) return fail("expected exactly 12 captain entries.");

  const teams: Record<string, Team> = {};
  for (const node of nodes) {
    const id = toPositiveInt(node.getAttribute("id"));
    const top = toPositiveInt(node.getAttribute("top"));
    const bottom = toPositiveInt(node.getAttribute("bottom"));
    const back = toPositiveInt(node.getAttribute("back"));
    if (!id || id > 12) return fail("captain id must be 1-12.");
    if (teams[String(id)]) return fail(`duplicate captain id ${id}.`);
    if (!top || top > 8 || !bottom || bottom > 8 || !back || back > 8)
      return fail("sidekick values must be integers 1-8.");
    teams[String(id)] = { top, bottom, back };
  }
  for (let id = 1; id <= 12; id += 1) if (!teams[String(id)]) return fail(`missing captain id ${id}.`);
  return { ok: true, value: teams };
}

function optionsHtml(items: readonly Character[]): string {
  return items.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
}

function setSelectValue(select: HTMLSelectElement | null, value: number): void {
  if (select && Array.from(select.options).some((option) => option.value === String(value)))
    select.value = String(value);
}

/** Shows an icon; a missing file falls back once to the given image, then to the site ball. */
function showIcon(image: HTMLImageElement | null, src: string, fallback: string, alt: string): void {
  if (!image) return;
  image.style.display = "";
  image.alt = alt;
  image.dataset.fallbackSrc = fallback || FALLBACK_ICON;
  image.dataset.retried = "0";
  image.onerror = () => {
    const fallbackSrc = image.dataset.fallbackSrc ?? FALLBACK_ICON;
    if (image.dataset.retried !== "1" && image.src !== fallbackSrc) {
      image.dataset.retried = "1";
      image.src = fallbackSrc;
      return;
    }
    image.onerror = null;
    image.src = FALLBACK_ICON;
  };
  image.src = src || fallback || FALLBACK_ICON;
}

function hideIcon(image: HTMLImageElement | null): void {
  if (!image) return;
  image.style.display = "none";
  image.alt = "";
  image.onerror = null;
  delete image.dataset.fallbackSrc;
  delete image.dataset.retried;
  image.removeAttribute("src");
}

export function initMscSaveEditor(): void {
  const applyButton = elementById("save-editor-apply", HTMLButtonElement);
  const xmlImportButton = elementById("save-editor-xml-import", HTMLButtonElement);
  const xmlExportButton = elementById("save-editor-xml-export", HTMLButtonElement);
  const saveButton = elementById("save-editor-save", HTMLButtonElement);
  const fileInput = elementById("save-editor-file-input", HTMLInputElement);
  const xmlInput = elementById("save-editor-xml-input", HTMLInputElement);
  const xmlDownloadAnchor = elementById("save-editor-xml-download", HTMLAnchorElement);
  const pickerGrid = elementById("save-editor-picker-grid", HTMLElement);
  const status = elementById("save-editor-status", HTMLElement);
  const selects: Record<Slot, HTMLSelectElement | null> = {
    captain: elementById("save-editor-captain", HTMLSelectElement),
    top: elementById("save-editor-top", HTMLSelectElement),
    bottom: elementById("save-editor-bottom", HTMLSelectElement),
    back: elementById("save-editor-back", HTMLSelectElement),
  };
  const slotButtons: Record<Slot, HTMLElement | null> = {
    captain: elementById("save-editor-slot-captain", HTMLElement),
    top: elementById("save-editor-slot-top", HTMLElement),
    bottom: elementById("save-editor-slot-bottom", HTMLElement),
    back: elementById("save-editor-slot-back", HTMLElement),
  };
  const slotIcons: Record<Slot, HTMLImageElement | null> = {
    captain: elementById("save-editor-slot-captain-icon", HTMLImageElement),
    top: elementById("save-editor-slot-top-icon", HTMLImageElement),
    bottom: elementById("save-editor-slot-bottom-icon", HTMLImageElement),
    back: elementById("save-editor-slot-back-icon", HTMLImageElement),
  };

  let loaded = false;
  let fileName = FILE_NAME;
  let workingBytes: Uint8Array | null = null;
  let currentCaptain = DEFAULT_CAPTAIN;
  let drafts: Record<string, Team> = {};
  let activeSlot: Slot = "captain";
  let region: Region = REGIONS.UNKNOWN;

  const setStatus = (message: string, level?: StatusLevel): void => {
    showStatus(status, message, level);
  };
  const selected = (slot: Slot, fallback: number): number => Number(selects[slot]?.value || fallback);
  const selectedCaptain = (): number =>
    selects.captain ? Number(selects.captain.value || DEFAULT_CAPTAIN) : DEFAULT_CAPTAIN;

  /** A select's id, checked as the former byte fields were (1..255, then 1..max). */
  const readSelect = (slot: Slot, label: string, max: number): Parsed<number> => {
    const select = selects[slot];
    if (!select) return { ok: false, error: `${label} field is missing.` };
    const raw = select.value.trim();
    if (!raw.length) return { ok: false, error: `${label} is required.` };
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 255) {
      return { ok: false, error: `${label} must be an integer between 1 and 255.` };
    }
    if (value > max) return { ok: false, error: `${label} must be between 1 and ${max}.` };
    return { ok: true, value };
  };

  /** Keeps the visible sidekicks as the draft of a captain; drafts are written on Write/Export. */
  const saveDraft = (captainId: number): Parsed<null> => {
    const top = readSelect("top", "Top", 8);
    if (!top.ok) return top;
    const bottom = readSelect("bottom", "Bottom", 8);
    if (!bottom.ok) return bottom;
    const back = readSelect("back", "Back", 8);
    if (!back.ok) return back;
    drafts[String(captainId)] = { top: top.value, bottom: bottom.value, back: back.value };
    return { ok: true, value: null };
  };

  const showTeam = (team: Team): void => {
    setSelectValue(selects.top, team.top);
    setSelectValue(selects.bottom, team.bottom);
    setSelectValue(selects.back, team.back);
  };

  /** Shows a captain's draft, or the team stored in the save. */
  const showCaptain = (captainId: number, silent: boolean): void => {
    const draft = drafts[String(captainId)];
    if (draft) {
      showTeam(draft);
      if (!silent) setStatus(`Loaded unsaved draft for ${captainName(captainId)}.`, "warning");
      return;
    }
    if (!loaded || !workingBytes) return;
    const team = readTeam(workingBytes, captainId);
    if (!team) {
      if (!silent) {
        const mapped = Object.keys(TEAM_PRESET_OFFSETS).map((id) => captainName(Number(id)));
        setStatus(`No mapping for ${captainName(captainId)}. Mapped captains: ${mapped.join(", ")}.`, "warning");
      }
      return;
    }
    showTeam(team);
    if (!silent) setStatus(`Loaded current ${captainName(captainId)} preset from save.`, "success");
  };

  const refreshButtons = (): void => {
    if (applyButton) applyButton.disabled = !loaded;
    if (xmlImportButton) xmlImportButton.disabled = !loaded;
    if (xmlExportButton) xmlExportButton.disabled = !loaded;
    if (saveButton) saveButton.disabled = !loaded;
  };

  const syncSlotButtons = (): void => {
    for (const slot of SLOTS) {
      const button = slotButtons[slot];
      if (!button) continue;
      button.classList.toggle("is-active-slot", slot === activeSlot);
      button.setAttribute("aria-pressed", slot === activeSlot ? "true" : "false");
    }
  };

  const updateFormation = (): void => {
    if (!loaded) {
      for (const slot of ["top", "back", "bottom", "captain"] as const) hideIcon(slotIcons[slot]);
      return;
    }
    const captain = selectedCaptain();
    showIcon(slotIcons.captain, captainIcon(captain), captainIcon(DEFAULT_CAPTAIN), `Captain: ${captainName(captain)}`);
    const labels = { top: "Top", bottom: "Bottom", back: "Back" } as const;
    for (const slot of ["top", "bottom", "back"] as const) {
      const sidekick = selected(slot, 1);
      showIcon(
        slotIcons[slot],
        sidekickIcon(sidekick, captain),
        sidekickFallbackIcon(sidekick),
        `${labels[slot]}: ${sidekickName(sidekick)}`,
      );
    }
  };

  const renderPicker = (): void => {
    if (!pickerGrid) return;
    if (!loaded) {
      pickerGrid.classList.remove("is-captain-layout");
      pickerGrid.innerHTML = "";
      return;
    }
    const isCaptain = activeSlot === "captain";
    pickerGrid.classList.toggle("is-captain-layout", isCaptain);
    const current = Number(selects[activeSlot]?.value || 0);
    const captain = selectedCaptain();
    pickerGrid.innerHTML = (isCaptain ? CAPTAINS : SIDEKICKS)
      .map((item) => {
        const src = isCaptain ? captainIcon(item.id) : sidekickIcon(item.id, captain);
        const fallback = isCaptain ? captainIcon(DEFAULT_CAPTAIN) : sidekickFallbackIcon(item.id);
        return (
          `<button class="save-editor-icon-option${item.id === current ? " is-selected" : ""}" data-picker-value="${item.id}" type="button" title="${item.name}" aria-label="${item.name}">` +
          `<img src="${src}" data-fallback-src="${fallback}" alt="${item.name}">` +
          "</button>"
        );
      })
      .join("");
    for (const image of Array.from(pickerGrid.querySelectorAll<HTMLImageElement>("img[data-fallback-src]"))) {
      image.dataset.retried = "0";
      image.onerror = () => {
        if (image.dataset.retried !== "1") {
          image.dataset.retried = "1";
          image.src = image.getAttribute("data-fallback-src") ?? FALLBACK_ICON;
          return;
        }
        image.onerror = null;
        image.src = FALLBACK_ICON;
      };
    }
  };

  const reset = (): void => {
    loaded = false;
    workingBytes = null;
    region = REGIONS.UNKNOWN;
    drafts = {};
    refreshButtons();
    updateFormation();
    renderPicker();
  };

  const loadSave = (bytes: Uint8Array, name: string): void => {
    const check = checkSave(bytes);
    if (!check.ok) {
      reset();
      setStatus(check.error, "error");
      return;
    }
    loaded = true;
    fileName = name || FILE_NAME;
    workingBytes = new Uint8Array(bytes);
    drafts = {};
    currentCaptain = selectedCaptain();
    activeSlot = "captain";
    region = check.region;
    refreshButtons();
    syncSlotButtons();
    showCaptain(currentCaptain, true);
    updateFormation();
    renderPicker();
    setStatus(`${region.code} (${region.label}) save loaded.`, check.regionKnown ? "success" : "warning");
  };

  const onCaptainChange = (): void => {
    if (!selects.captain || !loaded) return;
    if (Number.isInteger(currentCaptain) && currentCaptain >= 1 && currentCaptain <= 12) saveDraft(currentCaptain);
    currentCaptain = Number(selects.captain.value);
    showCaptain(currentCaptain, false);
    updateFormation();
    renderPicker();
    syncSlotButtons();
    refreshButtons();
  };

  const onSidekickChange = (): void => {
    if (!loaded || !Number.isInteger(currentCaptain) || currentCaptain < 1 || currentCaptain > 12) return;
    saveDraft(currentCaptain);
    updateFormation();
    renderPicker();
    syncSlotButtons();
    refreshButtons();
  };

  /** Writes the drafts and the competitive defaults into the working copy. */
  const applyDrafts = (): Parsed<null> => {
    if (!loaded || !workingBytes) return { ok: false, error: "Load a save first." };
    const captain = readSelect("captain", "Captain", 12);
    if (!captain.ok) return captain;
    const draft = saveDraft(captain.value);
    if (!draft.ok) return draft;
    workingBytes = writeTeams(workingBytes, drafts);
    return { ok: true, value: null };
  };

  const teamsForExport = (): Parsed<Record<string, Team>> => {
    if (!loaded || !workingBytes) return { ok: false, error: "Load a save before exporting XML presets." };
    const teams: Record<string, Team> = {};
    for (const captain of CAPTAINS) {
      const team = drafts[String(captain.id)] ?? readTeam(workingBytes, captain.id);
      if (!team) return { ok: false, error: `Failed to resolve preset values for ${captain.name}.` };
      const values = [team.top, team.bottom, team.back];
      if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 8)) {
        return { ok: false, error: `Preset values for ${captain.name} are invalid.` };
      }
      teams[String(captain.id)] = team;
    }
    return { ok: true, value: teams };
  };

  const onXmlPicked = (event: Event): void => {
    const file = pickedFile(event);
    if (!file) return;
    if (!loaded) {
      setStatus("Load a Strikers2 save file before importing XML presets.", "warning");
      if (xmlInput) xmlInput.value = "";
      return;
    }
    file
      .text()
      .then((xmlText) => {
        const parsed = parsePresetXml(xmlText);
        if (!parsed.ok) {
          setStatus(parsed.error, "error");
          return;
        }
        drafts = parsed.value;
        refreshButtons();
        currentCaptain = selectedCaptain();
        showCaptain(currentCaptain, true);
        updateFormation();
        renderPicker();
        syncSlotButtons();
        setStatus("XML presets imported successfully. Export Save will apply them.", "success");
      })
      .catch(() => {
        setStatus("XML import failed: unable to read file.", "error");
      })
      .finally(() => {
        if (xmlInput) xmlInput.value = "";
      });
  };

  const onXmlExport = (): void => {
    if (!loaded) {
      setStatus("Load a Strikers2 save file before exporting XML presets.", "warning");
      return;
    }
    if (!xmlDownloadAnchor) {
      setStatus("XML export failed: download target is missing.", "error");
      return;
    }
    const teams = teamsForExport();
    if (!teams.ok) {
      setStatus(teams.error, "error");
      return;
    }
    const xmlName = `msc-presets-${region.code.toLowerCase()}.xml`;
    downloadFile(presetXml(teams.value, region), "application/xml;charset=utf-8", xmlName, xmlDownloadAnchor);
    setStatus(`XML presets exported: ${xmlName}`, "success");
  };

  const writeOrExport = (download: boolean): void => {
    const result = applyDrafts();
    if (!result.ok) {
      refreshButtons();
      setStatus(result.error, "error");
      return;
    }
    refreshButtons();
    if (download && workingBytes) {
      downloadFile(workingBytes, "application/octet-stream", fileName || FILE_NAME);
      setStatus("Patched save exported.", "success");
    } else {
      setStatus("Wrote changes to save.", "success");
    }
  };

  if (selects.captain) selects.captain.innerHTML = optionsHtml(CAPTAINS);
  for (const slot of ["top", "bottom", "back"] as const) {
    const select = selects[slot];
    if (select) select.innerHTML = optionsHtml(SIDEKICKS);
  }
  setSelectValue(selects.captain, DEFAULT_CAPTAIN);
  for (const slot of ["top", "bottom", "back"] as const) setSelectValue(selects[slot], 1);
  refreshButtons();
  updateFormation();
  syncSlotButtons();
  renderPicker();

  elementById("save-editor-load", HTMLElement)?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (event) => {
    const file = pickedFile(event);
    if (!file) return;
    file
      .arrayBuffer()
      .then((buffer) => {
        loadSave(new Uint8Array(buffer), file.name);
      })
      .catch(() => {
        reset();
        setStatus("Failed to read file.", "error");
      })
      .finally(() => {
        fileInput.value = "";
      });
  });
  xmlImportButton?.addEventListener("click", () => {
    if (!loaded) setStatus("Load a Strikers2 save file before importing XML presets.", "warning");
    else xmlInput?.click();
  });
  xmlInput?.addEventListener("change", onXmlPicked);
  xmlExportButton?.addEventListener("click", onXmlExport);
  applyButton?.addEventListener("click", () => {
    writeOrExport(false);
  });
  saveButton?.addEventListener("click", () => {
    writeOrExport(true);
  });
  selects.captain?.addEventListener("change", onCaptainChange);
  for (const slot of ["top", "bottom", "back"] as const) selects[slot]?.addEventListener("change", onSidekickChange);
  for (const slot of SLOTS) {
    slotButtons[slot]?.addEventListener("click", (event) => {
      const key = (event.currentTarget as HTMLElement).getAttribute("data-slot") as Slot | null;
      if (!key) return;
      activeSlot = key;
      syncSlotButtons();
      renderPicker();
      if (!loaded) setStatus("Load a Strikers2 save file first.", "warning");
    });
  }
  pickerGrid?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-picker-value]") : null;
    if (!button) return;
    if (!loaded) {
      setStatus("Load a save before editing presets.", "warning");
      return;
    }
    const picked = Number(button.getAttribute("data-picker-value"));
    const select = selects[activeSlot];
    if (!select || Number(select.value) === picked) return;
    select.value = String(picked);
    if (activeSlot === "captain") onCaptainChange();
    else onSidekickChange();
  });
}
