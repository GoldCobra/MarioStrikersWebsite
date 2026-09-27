const BUILD_CHUNK_FILES = {
  Mario: "mario.json",
  Luigi: "luigi.json",
  Bowser: "bowser.json",
  Peach: "peach.json",
  Rosalina: "rosalina.json",
  Toad: "toad.json",
  Yoshi: "yoshi.json",
  DK: "dk.json",
  Wario: "wario.json",
  Waluigi: "waluigi.json",
  "Shy Guy": "shy-guy.json",
  Daisy: "daisy.json",
  Pauline: "pauline.json",
  "Diddy Kong": "diddy-kong.json",
  "Bowser Jr": "bowser-jr.json",
  Birdo: "birdo.json"
};

const buildChunkCache = new Map();
const buildChunkRequests = new Map();

function getSubmitButton() {
  return document.querySelector(".submit");
}

function setSubmitBusy(isBusy) {
  const submitButton = getSubmitButton();
  if (!submitButton) {
    return;
  }

  submitButton.disabled = Boolean(isBusy);
  submitButton.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function setResultsMessage(message) {
  const resultsNode = document.getElementById("results");
  if (resultsNode) {
    resultsNode.textContent = message || "";
  }
}

function clearResultsTable() {
  $("#table-b tbody tr").remove();
}

function getSelectedCharacters() {
  const checkedBoxes = document.querySelectorAll("#mySelectOptions input.checkbox:checked");
  return Array.from(
    new Set(
      Array.from(checkedBoxes)
        .map((checkbox) => String(checkbox.value || "").trim())
        .filter((value) => Boolean(BUILD_CHUNK_FILES[value]))
    )
  );
}

function readFilters() {
  return {
    strMin: Number(document.getElementById("range1").value),
    strMax: Number(document.getElementById("range2").value),
    spdMin: Number(document.getElementById("range3").value),
    spdMax: Number(document.getElementById("range4").value),
    shotMin: Number(document.getElementById("range5").value),
    shotMax: Number(document.getElementById("range6").value),
    passMin: Number(document.getElementById("range7").value),
    passMax: Number(document.getElementById("range8").value),
    techMin: Number(document.getElementById("range9").value),
    techMax: Number(document.getElementById("range10").value)
  };
}

function buildMatchesFilters(build, filters) {
  return (
    Number(build.Str) >= filters.strMin &&
    Number(build.Str) <= filters.strMax &&
    Number(build.Spd) >= filters.spdMin &&
    Number(build.Spd) <= filters.spdMax &&
    Number(build.Shot) >= filters.shotMin &&
    Number(build.Shot) <= filters.shotMax &&
    Number(build.Pass) >= filters.passMin &&
    Number(build.Pass) <= filters.passMax &&
    Number(build.Tech) >= filters.techMin &&
    Number(build.Tech) <= filters.techMax
  );
}

async function loadBuildChunk(character) {
  if (buildChunkCache.has(character)) {
    return buildChunkCache.get(character);
  }

  if (buildChunkRequests.has(character)) {
    return buildChunkRequests.get(character);
  }

  const chunkFile = BUILD_CHUNK_FILES[character];
  if (!chunkFile) {
    throw new Error(`Unknown build chunk requested for character: ${character}`);
  }

  const chunkRequest = fetch(new URL(`../builds/${chunkFile}`, import.meta.url).href)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load build data for ${character}.`);
      }
      return response.json();
    })
    .then((rows) => {
      buildChunkCache.set(character, rows);
      buildChunkRequests.delete(character);
      return rows;
    })
    .catch((error) => {
      buildChunkRequests.delete(character);
      throw error;
    });

  buildChunkRequests.set(character, chunkRequest);
  return chunkRequest;
}

async function loadSelectedBuilds(selectedCharacters) {
  const uniqueCharacters = Array.from(new Set(selectedCharacters));
  await Promise.all(uniqueCharacters.map(loadBuildChunk));
  return uniqueCharacters.flatMap((character) => buildChunkCache.get(character) || []);
}

function renderBuildRows(rows) {
  const tableBody = document.getElementById("table-b").getElementsByTagName("tbody")[0];
  const MAX_ROWS = 50;
  const visibleRows = rows.slice(0, MAX_ROWS);

  setResultsMessage(
    rows.length === 0
      ? "No results found."
      : `Showing ${visibleRows.length} of ${rows.length} results`
  );

  visibleRows.forEach((build) => {
    const tr = tableBody.insertRow(-1);

    let td = tr.insertCell();
    td.className = "addcell";
    td.textContent = build.Char;

    td = tr.insertCell();
    td.className = "addcell";
    td.textContent = build.Gear;

    td = tr.insertCell();
    td.className = "copycell";
    td.textContent = build.Str;

    td = tr.insertCell();
    td.className = "copycell";
    td.textContent = build.Spd;

    td = tr.insertCell();
    td.className = "copycell";
    td.textContent = build.Shot;

    td = tr.insertCell();
    td.className = "copycell";
    td.textContent = build.Pass;

    td = tr.insertCell();
    td.className = "copycell";
    td.textContent = build.Tech;
  });
}

$(document).ready(function () {
  $(".submit").on("pointerup", async function (event) {
    event.preventDefault();

    clearResultsTable();

    const selectedCharacters = getSelectedCharacters();
    if (!selectedCharacters.length) {
      setResultsMessage("Select at least one character.");
      return;
    }

    setSubmitBusy(true);
    setResultsMessage("Loading builds...");

    try {
      const builds = await loadSelectedBuilds(selectedCharacters);
      const filters = readFilters();
      const rows = builds.filter((build) => buildMatchesFilters(build, filters));
      renderBuildRows(rows);
    } catch (error) {
      console.error("Failed to load build chunks:", error);
      setResultsMessage("Failed to load build data.");
    } finally {
      setSubmitBusy(false);
    }
  });
});
