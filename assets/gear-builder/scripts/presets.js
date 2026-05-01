import { Gear } from "./data.js";

const STORAGE_KEY = "msblGearPresetDraft:v1";
const XML_VERSION = "1";
const XML_ROOT_TAG = "msbl-gear-presets";
const STATS_IMAGE_BASE_URL = new URL("../images/stats/", import.meta.url).href;
const PARTS = [
  { key: "head", label: "Head", statRow: 3, statClass: "str" },
  { key: "arms", label: "Arms", statRow: 4, statClass: "spe" },
  { key: "body", label: "Body", statRow: 5, statClass: "sho" },
  { key: "legs", label: "Legs", statRow: 6, statClass: "pas" }
];
const STAT_CLASSES = ["str", "spe", "sho", "pas", "tec"];
const CHARACTERS = [
  "Mario",
  "Luigi",
  "Bowser",
  "Peach",
  "Rosalina",
  "Toad",
  "Yoshi",
  "Donkey Kong",
  "Wario",
  "Waluigi",
  "Shy Guy",
  "Daisy",
  "Pauline",
  "Diddy Kong",
  "Bowser Jr",
  "Birdo"
];

function readState() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "");
    if (!parsed || parsed.version !== 1 || !parsed.characters || typeof parsed.characters !== "object") {
      return { version: 1, characters: {} };
    }
    return parsed;
  } catch (_error) {
    return { version: 1, characters: {} };
  }
}

function writeState(state) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clearState() {
  window.sessionStorage.removeItem(STORAGE_KEY);
}

function setStatus(message) {
  const results = document.getElementById("results");
  if (results) {
    results.textContent = message || "";
  }
}

function normalizeBuild(build) {
  const value = String(build || "").trim();
  return /^[0-9]{4}$/.test(value) ? value : "0000";
}

function getCharacterIdFromPane(pane) {
  const match = pane && pane.id ? pane.id.match(/^tab-(\d{2})$/) : null;
  return match ? Number(match[1]) : null;
}

function getCharacterName(characterId) {
  return CHARACTERS[characterId - 1] || "Character " + characterId;
}

function getCharacterPane(characterId) {
  return document.getElementById("tab-" + String(characterId).padStart(2, "0"));
}

function getBuildCell(pane) {
  return pane ? pane.querySelector(".buildcell[builddata]") : null;
}

function getBuildFromPane(pane) {
  const cell = getBuildCell(pane);
  return normalizeBuild(cell ? cell.getAttribute("builddata") : "");
}

function getGearStats(partKey, digit) {
  const gear = Gear.find((item) => item.slot === partKey && String(item.num) === String(digit));
  return gear && Array.isArray(gear.stats) ? gear.stats : ["", "", "", "", ""];
}

function setCellText(row, cellIndex, value) {
  if (row && row.cells && row.cells[cellIndex]) {
    row.cells[cellIndex].textContent = value;
  }
}

function updateGearTable(table, build) {
  if (!table) {
    return { strength: 0, speed: 0, shot: 0, pass: 0, tech: 0 };
  }

  PARTS.forEach((part, index) => {
    const digit = Number(build.charAt(index));
    const stats = getGearStats(part.key, digit);
    const row = table.rows[part.statRow];
    for (let statIndex = 0; statIndex < 5; statIndex += 1) {
      setCellText(row, statIndex + 1, stats[statIndex]);
    }
  });

  const totals = [];
  for (let statIndex = 1; statIndex < 6; statIndex += 1) {
    let sum = 0;
    for (let rowIndex = 2; rowIndex < 7; rowIndex += 1) {
      const row = table.rows[rowIndex];
      sum += Number(row && row.cells[statIndex] ? row.cells[statIndex].textContent : 0);
    }
    totals.push(sum);
    setCellText(table.rows[1], statIndex, String(sum));
  }

  return {
    strength: totals[0],
    speed: totals[1],
    shot: totals[2],
    pass: totals[3],
    tech: totals[4]
  };
}

function updateActiveButtons(pane, build) {
  PARTS.forEach((part, index) => {
    const digit = Number(build.charAt(index));
    const buttons = pane.querySelectorAll("." + part.key + ".button");
    buttons.forEach((button) => {
      button.classList.remove("activebutton");
    });
    if (buttons[digit]) {
      buttons[digit].classList.add("activebutton");
    }
  });
}

function updateCard(pane, build, totals) {
  const cardBuild = pane.querySelector(".cardbuild");
  if (cardBuild) {
    cardBuild.textContent = build;
  }

  const values = [totals.strength, totals.speed, totals.shot, totals.pass, totals.tech];
  STAT_CLASSES.forEach((statClass, index) => {
    const statNode = pane.querySelector(".cardstat .stat." + statClass);
    if (statNode) {
      statNode.textContent = String(values[index]);
    }
    const barImage = pane.querySelector("img.bar." + statClass);
    if (barImage) {
      barImage.src = STATS_IMAGE_BASE_URL + values[index] + ".png";
    }
  });

  const tooltip = pane.querySelector(".tooltip");
  if (tooltip) {
    let tipValue = Number(((totals.speed * 0.39) + (totals.tech * 0.1) - 3.15) * 2).toFixed(1);
    if (tipValue < 1) {
      tipValue = 1;
    }
    tooltip.textContent = "Speed with Ball: " + tipValue;
  }
}

function applyBuildToPane(characterId, build) {
  const pane = getCharacterPane(characterId);
  const normalizedBuild = normalizeBuild(build);
  if (!pane) {
    return false;
  }

  const buildCell = getBuildCell(pane);
  if (buildCell) {
    buildCell.setAttribute("builddata", normalizedBuild);
  }

  const table = pane.querySelector(".gear-table");
  const totals = updateGearTable(table, normalizedBuild);
  updateActiveButtons(pane, normalizedBuild);
  updateCard(pane, normalizedBuild, totals);
  return true;
}

function persistPaneBuild(pane) {
  const characterId = getCharacterIdFromPane(pane);
  if (!characterId) {
    return;
  }

  const build = getBuildFromPane(pane);
  const state = readState();
  state.characters[String(characterId)] = {
    name: getCharacterName(characterId),
    build: build
  };
  writeState(state);
  setStatus("Gear preset draft saved for " + getCharacterName(characterId) + ".");
}

function restoreDrafts() {
  const state = readState();
  Object.keys(state.characters).forEach((id) => {
    const characterId = Number(id);
    const entry = state.characters[id];
    if (Number.isInteger(characterId) && characterId >= 1 && characterId <= 16 && entry) {
      applyBuildToPane(characterId, entry.build);
    }
  });
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildPresetXml(state) {
  const ids = Object.keys(state.characters)
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= 16)
    .sort((left, right) => left - right);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<' + XML_ROOT_TAG + ' version="' + escapeXml(XML_VERSION) + '">'
  ];

  ids.forEach((id) => {
    const entry = state.characters[String(id)] || {};
    const build = normalizeBuild(entry.build);
    lines.push(
      '  <character id="' + id + '" name="' + escapeXml(getCharacterName(id)) + '" build="' + build + '" />'
    );
  });

  lines.push("</" + XML_ROOT_TAG + ">");
  return {
    count: ids.length,
    text: lines.join("\n")
  };
}

function downloadText(text, fileName) {
  const blob = new Blob([text], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function exportPreset() {
  const state = readState();
  const xml = buildPresetXml(state);
  if (!xml.count) {
    setStatus("No edited characters in the gear preset draft.");
    return;
  }

  downloadText(xml.text, "msbl-gear-preset.xml");
  setStatus("Gear preset exported: " + xml.count + " characters.");
}

function clearDraft() {
  const state = readState();
  Object.keys(state.characters).forEach((id) => {
    const characterId = Number(id);
    if (Number.isInteger(characterId)) {
      applyBuildToPane(characterId, "0000");
    }
  });
  clearState();
  setStatus("Gear preset draft cleared.");
}

function injectMenuActions() {
  const menu = document.querySelector("#tab-b .menu-options");
  if (!menu || menu.querySelector("[data-gear-preset-export]")) {
    return;
  }

  const exportButton = document.createElement("button");
  exportButton.className = "gear-preset-menu-button";
  exportButton.type = "button";
  exportButton.textContent = "Export Gear Preset";
  exportButton.setAttribute("data-gear-preset-export", "true");
  exportButton.addEventListener("click", exportPreset);

  const clearButton = document.createElement("button");
  clearButton.className = "gear-preset-menu-button";
  clearButton.type = "button";
  clearButton.textContent = "Clear Gear Preset Draft";
  clearButton.addEventListener("click", clearDraft);

  menu.appendChild(exportButton);
  menu.appendChild(clearButton);
}

function attachDraftCapture() {
  const host = document.getElementById("msbl-gear-builder-host");
  if (!host) {
    return;
  }

  host.addEventListener("click", (event) => {
    const button = event.target && event.target.closest ? event.target.closest(".tab-pane[id^='tab-'] .button") : null;
    if (!button) {
      return;
    }

    const pane = button.closest(".tab-pane[id^='tab-']");
    if (!pane || pane.id === "tab-b") {
      return;
    }

    window.setTimeout(() => {
      persistPaneBuild(pane);
    }, 0);
  });
}

function boot() {
  restoreDrafts();
  injectMenuActions();
  attachDraftCapture();
}

boot();
