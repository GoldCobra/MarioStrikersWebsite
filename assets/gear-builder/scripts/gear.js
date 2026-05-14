import { Gear } from "./data.js";

const STATS_IMAGE_BASE_URL = new URL("../images/stats/", import.meta.url).href;
const PARTS = [
  { key: "head", buildIndex: 0, tableRow: 3 },
  { key: "arms", buildIndex: 1, tableRow: 4 },
  { key: "body", buildIndex: 2, tableRow: 5 },
  { key: "legs", buildIndex: 3, tableRow: 6 }
];
const STAT_CLASSES = ["str", "spe", "sho", "pas", "tec"];
const GEAR_BY_SLOT_AND_NAME = new Map(
  Gear.map((gear) => [gear.slot + ":" + gear.name, gear])
);

function getText(node) {
  return String(node?.textContent || "").trim();
}

function setCell(row, index, value) {
  if (row?.cells?.[index]) {
    row.cells[index].textContent = value;
  }
}

function getClickContext(button) {
  const part = PARTS.find((item) => button.classList.contains(item.key));
  const name = getText(button.querySelector(".btnname")) || getText(button);
  const gear = part ? GEAR_BY_SLOT_AND_NAME.get(part.key + ":" + name) : null;
  const pane = button.closest("div.tab-pane");

  return {
    gear,
    pane,
    part,
    buildCell: pane?.querySelector("td.buildcell[builddata]"),
    table: pane?.querySelector("table.gear-table")
  };
}

function replaceBuildDigit(build, index, digit) {
  const value = String(build || "0000").padEnd(4, "0").slice(0, 4);
  return value.slice(0, index) + digit + value.slice(index + 1);
}

function applyGearStats(table, part, gear) {
  const row = table.rows[part.tableRow];
  if (!row || row.cells.length < 6 || !Array.isArray(gear.stats)) {
    return false;
  }

  gear.stats.forEach((stat, index) => setCell(row, index + 1, stat));
  return true;
}

function updateTotals(table) {
  return STAT_CLASSES.map((_, statIndex) => {
    let total = 0;
    for (let rowIndex = 2; rowIndex <= 6; rowIndex += 1) {
      total += Number(table.rows[rowIndex]?.cells[statIndex + 1]?.textContent || 0);
    }

    const value = String(total);
    setCell(table.rows[1], statIndex + 1, value);
    return value;
  });
}

function updateCard(pane, build, totals) {
  const cardBuild = pane.querySelector(".cardbuild");
  if (cardBuild) {
    cardBuild.textContent = build;
  }

  STAT_CLASSES.forEach((statClass, index) => {
    const value = totals[index];
    const statNode = pane.querySelector(".cardstat .stat." + statClass);
    const barImage = pane.querySelector("img.bar." + statClass);

    if (statNode) {
      statNode.textContent = value;
    }
    if (barImage) {
      barImage.src = STATS_IMAGE_BASE_URL + value + ".png";
    }
  });

  const tooltip = pane.querySelector(".tooltip");
  if (tooltip) {
    const speed = Number(totals[1]);
    const tech = Number(totals[4]);
    let tipValue = Number(((speed * 0.39) + (tech * 0.1) - 3.15) * 2).toFixed(1);
    if (tipValue < 1) {
      tipValue = 1;
    }
    tooltip.textContent = "Speed with Ball: " + tipValue;
  }
}

function updateActiveButton(pane, button, part) {
  pane.querySelectorAll("." + part.key + ".button").forEach((slotButton) => {
    slotButton.classList.toggle("activebutton", slotButton === button);
  });
}

function handleGearButtonClick(button) {
  const { buildCell, gear, pane, part, table } = getClickContext(button);
  if (!buildCell || !gear || !pane || !part || !table || !applyGearStats(table, part, gear)) {
    return;
  }

  const build = replaceBuildDigit(
    buildCell.getAttribute("builddata"),
    part.buildIndex,
    String(gear.num)
  );
  buildCell.setAttribute("builddata", build);

  updateCard(pane, build, updateTotals(table));
  updateActiveButton(pane, button, part);
}

document.addEventListener("click", function(event) {
  const target = event.target?.closest ? event.target : event.target?.parentElement;
  const button = target?.closest("#msbl-gear-builder-host .button");
  if (button) {
    handleGearButtonClick(button);
  }
});
