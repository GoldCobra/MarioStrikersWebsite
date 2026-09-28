// The MSBL save editor page: loads strkrs.save, edits coins, completes cups, buys all gear, imports Gear
// Builder presets and exports the patched file. Everything happens in the browser.

import { downloadFile, elementById, pickedFile, showStatus, type StatusLevel } from "../shared/editor-ui.ts";
import {
  applyGearPreset,
  characterName,
  completeCupsAndUnlockBushido,
  ownAllGear,
  parseCoins,
  patchSave,
  readSave,
  setCoins,
  type EditableSave,
  type GearPresetCharacter,
  type GearPresetResult,
  type PatchOutcome,
} from "./save-core.ts";
import { FILE_NAME } from "./save-format.ts";

const PRESET_ROOT_TAG = "msbl-gear-presets";
const PRESET_VERSION = "1";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Reads a Gear Builder export: <msbl-gear-presets version="1"><character id build /></...>. */
export function parseGearPresetXml(xmlText: string): Parsed<GearPresetCharacter[]> {
  const fail = (reason: string): Parsed<GearPresetCharacter[]> => ({
    ok: false,
    error: `Gear preset import failed: ${reason}`,
  });
  if (!xmlText.trim().length) return fail("file is empty.");
  const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (xmlDoc.getElementsByTagName("parsererror").length) return fail("invalid XML syntax.");
  const root = xmlDoc.documentElement;
  if (root.tagName !== PRESET_ROOT_TAG) return fail(`root element must be <${PRESET_ROOT_TAG}>.`);
  if ((root.getAttribute("version") ?? "") !== PRESET_VERSION) return fail("unsupported XML version.");

  const characters: GearPresetCharacter[] = [];
  const seen = new Set<number>();
  for (const node of Array.from(root.children)) {
    if (node.tagName !== "character") return fail(`unexpected element <${node.tagName}>.`);
    const id = Number((node.getAttribute("id") ?? "").trim());
    const build = (node.getAttribute("build") ?? "").trim();
    if (!Number.isInteger(id) || id < 1 || id > 16) return fail("character id must be 1-16.");
    if (seen.has(id)) return fail(`duplicate character id ${id}.`);
    if (!/^[0-9]{4}$/.test(build)) return fail("build must be four digits 0-9.");
    seen.add(id);
    characters.push({ id, name: node.getAttribute("name") || characterName(id), build });
  }
  if (!characters.length) return fail("XML contains no characters.");
  return { ok: true, value: characters };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function initMsblSaveEditor(): void {
  const loadButton = elementById("msbl-save-editor-load", HTMLElement);
  const gearImportButton = elementById("msbl-save-editor-gear-import", HTMLButtonElement);
  const completeCupsButton = elementById("msbl-save-editor-complete-cups", HTMLButtonElement);
  const haveAllButton = elementById("msbl-save-editor-have-all", HTMLButtonElement);
  const exportButton = elementById("msbl-save-editor-export", HTMLButtonElement);
  const fileInput = elementById("msbl-save-editor-file-input", HTMLInputElement);
  const gearInput = elementById("msbl-save-editor-gear-input", HTMLInputElement);
  const downloadAnchor = elementById("msbl-save-editor-download", HTMLAnchorElement);
  const coinsInput = elementById("msbl-save-editor-coins", HTMLInputElement);
  const status = elementById("msbl-save-editor-status", HTMLElement);

  let loaded = false;
  let fileName = FILE_NAME;
  let workingBytes: Uint8Array | null = null;

  const setStatus = (message: string, level?: StatusLevel): void => {
    showStatus(status, message, level);
  };
  const currentCoins = (): ReturnType<typeof parseCoins> =>
    coinsInput ? parseCoins(coinsInput.value) : { ok: false, error: "Coins field is missing." };

  const refreshButtons = (): void => {
    const enabled = loaded && currentCoins().ok;
    if (completeCupsButton) completeCupsButton.disabled = !enabled;
    if (gearImportButton) gearImportButton.disabled = !loaded;
    if (haveAllButton) haveAllButton.disabled = !enabled;
    if (exportButton) exportButton.disabled = !enabled;
    if (coinsInput) coinsInput.disabled = !loaded;
  };

  const showCoins = (coins: number): void => {
    if (coinsInput) coinsInput.value = String(coins);
  };

  /** Applies the coins field and a patch together; the status reports whether anything changed. */
  const runTransaction = (
    patcher: (context: EditableSave) => PatchOutcome,
    successMessage: string | ((meta: GearPresetResult) => string),
    unchangedMessage: string | ((meta: GearPresetResult) => string),
  ): void => {
    if (!loaded || !workingBytes) {
      setStatus("Import a save first.", "error");
      return;
    }
    const coins = currentCoins();
    if (!coins.ok) {
      setStatus(coins.error, "error");
      refreshButtons();
      return;
    }
    try {
      let meta: GearPresetResult = { changed: false, characterCount: 0, usesBushido: false };
      const result = patchSave(workingBytes, (context) => {
        const coinsChanged = setCoins(context, coins.value);
        const outcome = patcher(context);
        if (typeof outcome === "object") meta = outcome;
        return (typeof outcome === "object" ? outcome.changed : outcome) || coinsChanged;
      });
      workingBytes = result.bytes;
      showCoins(result.info.coins);
      refreshButtons();
      const message = result.changed ? successMessage : unchangedMessage;
      setStatus(typeof message === "function" ? message(meta) : message, result.changed ? "success" : "warning");
    } catch (error) {
      setStatus(errorMessage(error, "Patch failed."), "error");
      refreshButtons();
    }
  };

  const loadSave = (bytes: Uint8Array, name: string): void => {
    try {
      loaded = true;
      fileName = name || FILE_NAME;
      const save = readSave(bytes);
      workingBytes = save.bytes;
      showCoins(save.info.coins);
      refreshButtons();
      setStatus("Save loaded.", "success");
    } catch (error) {
      loaded = false;
      fileName = FILE_NAME;
      workingBytes = null;
      if (coinsInput) coinsInput.value = "";
      refreshButtons();
      setStatus(errorMessage(error, "Load failed."), "error");
    }
  };

  const onSavePicked = (event: Event): void => {
    const file = pickedFile(event);
    if (!file) return;
    file
      .arrayBuffer()
      .then((buffer) => {
        loadSave(new Uint8Array(buffer), file.name);
      })
      .catch(() => {
        setStatus("Failed to read file.", "error");
      })
      .finally(() => {
        if (fileInput) fileInput.value = "";
      });
  };

  const onGearPresetPicked = (event: Event): void => {
    const file = pickedFile(event);
    if (!file) return;
    if (!loaded) {
      setStatus("Import a save before importing a gear preset.", "warning");
      if (gearInput) gearInput.value = "";
      return;
    }
    file
      .text()
      .then((xmlText) => {
        const parsed = parseGearPresetXml(xmlText);
        if (!parsed.ok) {
          setStatus(parsed.error, "error");
          return;
        }
        runTransaction(
          (context) => applyGearPreset(context, parsed.value),
          (meta) => `Gear preset applied: ${meta.characterCount} characters. Export Save to download the patched file.`,
          (meta) => `Gear preset already matched the save: ${meta.characterCount} characters.`,
        );
      })
      .catch(() => {
        setStatus("Gear preset import failed: unable to read file.", "error");
      })
      .finally(() => {
        if (gearInput) gearInput.value = "";
      });
  };

  const onExport = (): void => {
    if (!loaded || !workingBytes) {
      setStatus("Import a save first.", "error");
      return;
    }
    const coins = currentCoins();
    if (!coins.ok) {
      setStatus(coins.error, "error");
      refreshButtons();
      return;
    }
    try {
      const result = patchSave(workingBytes, (context) => setCoins(context, coins.value));
      workingBytes = result.bytes;
      showCoins(result.info.coins);
      refreshButtons();
      downloadFile(workingBytes, "application/octet-stream", fileName || FILE_NAME, downloadAnchor);
      setStatus("Patched save exported.", "success");
    } catch (error) {
      setStatus(errorMessage(error, "Export failed."), "error");
      refreshButtons();
    }
  };

  refreshButtons();
  loadButton?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", onSavePicked);
  gearImportButton?.addEventListener("click", () => {
    if (!loaded) setStatus("Import a save before importing a gear preset.", "warning");
    else gearInput?.click();
  });
  gearInput?.addEventListener("change", onGearPresetPicked);
  coinsInput?.addEventListener("input", () => {
    if (!loaded) return;
    refreshButtons();
    const coins = currentCoins();
    if (coins.ok) setStatus("Coins updated. Export Save to download the patched file.", "warning");
    else setStatus(coins.error, "error");
  });
  completeCupsButton?.addEventListener("click", () => {
    runTransaction(
      (context) => completeCupsAndUnlockBushido(context.save),
      "Cups completed and Bushido Gear unlocked.",
      "Cups and Bushido Gear already unlocked/completed.",
    );
  });
  haveAllButton?.addEventListener("click", () => {
    runTransaction(
      (context) => {
        const gearChanged = ownAllGear(context);
        return completeCupsAndUnlockBushido(context.save) || gearChanged;
      },
      "All Gear applied and Bushido Gear unlocked.",
      "Already have All Gear unlocked.",
    );
  });
  exportButton?.addEventListener("click", onExport);
}
