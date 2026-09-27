(function () {
  "use strict";

  var FILE_SIZE = 35616;
  var FILE_MAGIC_BE = 0x00008b02;
  var FALLBACK_FILENAME = "Strikers2";
  var XML_VERSION = "1";
  var XML_ROOT_TAG = "msc-presets";
  var DEFAULT_CAPTAIN_UI = 1;
  var REGION_PROFILES = {
    PAL: { code: "R4QP01", label: "PAL" },
    NTSC_U: { code: "R4QE01", label: "NTSC-U" },
    NTSC_J: { code: "R4QJ01", label: "NTSC-J" },
    NTSC_K: { code: "R4QK01", label: "NTSC-K" },
    UNKNOWN: { code: "R4Q?01", label: "UNKNOWN" }
  };

  var CAPTAINS = [
    { id: 1, name: "Mario" },
    { id: 2, name: "Peach" },
    { id: 3, name: "DK" },
    { id: 4, name: "Waluigi" },
    { id: 5, name: "Luigi" },
    { id: 6, name: "Wario" },
    { id: 7, name: "Bowser" },
    { id: 8, name: "Yoshi" },
    { id: 9, name: "Daisy" },
    { id: 10, name: "Bowser Jr." },
    { id: 11, name: "Diddy Kong" },
    { id: 12, name: "Petey" }
  ];

  var SIDEKICKS = [
    { id: 1, name: "Koopa" },
    { id: 2, name: "Toad" },
    { id: 3, name: "Dry Bones" },
    { id: 4, name: "Boo" },
    { id: 5, name: "Birdo" },
    { id: 6, name: "Hammer Bros." },
    { id: 7, name: "Monty Mole" },
    { id: 8, name: "Shy Guy" }
  ];
  var CAPTAIN_KEYS = {
    1: "mario",
    2: "peach",
    3: "dk",
    4: "waluigi",
    5: "luigi",
    6: "wario",
    7: "bowser",
    8: "yoshi",
    9: "daisy",
    10: "bowserjr",
    11: "diddykong",
    12: "petey"
  };
  var SIDEKICK_KEYS = {
    1: "koopa",
    2: "toad",
    3: "drybones",
    4: "boo",
    5: "birdo",
    6: "hammerbros",
    7: "montymole",
    8: "shyguy"
  };
  var SIDEKICK_FOLDERS = {
    1: "01-koopa",
    2: "02-toad",
    3: "03-drybones",
    4: "04-boo",
    5: "05-birdo",
    6: "06-hammerbros",
    7: "07-montymole",
    8: "08-shyguy"
  };
  var FALLBACK_ICON = "../assets/favicon/blball.png";

  var contract = window.MscSaveEditorContract || null;

  var state = {
    loaded: false,
    fileName: FALLBACK_FILENAME,
    sourceBytes: null,
    workingBytes: null,
    applied: false,
    currentCaptainUi: DEFAULT_CAPTAIN_UI,
    draftsByCaptain: {},
    activeSlot: "captain",
    loadedRegion: REGION_PROFILES.UNKNOWN
  };

  var elements = {
    loadButton: document.getElementById("save-editor-load"),
    applyButton: document.getElementById("save-editor-apply"),
    xmlImportButton: document.getElementById("save-editor-xml-import"),
    xmlExportButton: document.getElementById("save-editor-xml-export"),
    saveButton: document.getElementById("save-editor-save"),
    fileInput: document.getElementById("save-editor-file-input"),
    xmlInput: document.getElementById("save-editor-xml-input"),
    downloadAnchor: document.getElementById("save-editor-download"),
    xmlDownloadAnchor: document.getElementById("save-editor-xml-download"),
    captainInput: document.getElementById("save-editor-captain"),
    topInput: document.getElementById("save-editor-top"),
    bottomInput: document.getElementById("save-editor-bottom"),
    backInput: document.getElementById("save-editor-back"),
    slotTopButton: document.getElementById("save-editor-slot-top"),
    slotBackButton: document.getElementById("save-editor-slot-back"),
    slotBottomButton: document.getElementById("save-editor-slot-bottom"),
    slotCaptainButton: document.getElementById("save-editor-slot-captain"),
    slotTopIcon: document.getElementById("save-editor-slot-top-icon"),
    slotBackIcon: document.getElementById("save-editor-slot-back-icon"),
    slotBottomIcon: document.getElementById("save-editor-slot-bottom-icon"),
    slotCaptainIcon: document.getElementById("save-editor-slot-captain-icon"),
    pickerGrid: document.getElementById("save-editor-picker-grid"),
    status: document.getElementById("save-editor-status")
  };

  function setStatus(message, level) {
    if (!elements.status) {
      return;
    }

    elements.status.textContent = message;
    elements.status.classList.remove("is-warning", "is-error", "is-success");

    if (level === "warning") {
      elements.status.classList.add("is-warning");
    } else if (level === "error") {
      elements.status.classList.add("is-error");
    } else if (level === "success") {
      elements.status.classList.add("is-success");
    }
  }

  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildCharacterOptions(items) {
    var options = [];
    for (var i = 0; i < items.length; i += 1) {
      options.push('<option value="' + items[i].id + '">' + items[i].name + "</option>");
    }
    return options.join("");
  }

  function initCharacterOptions() {
    if (elements.captainInput) {
      elements.captainInput.innerHTML = buildCharacterOptions(CAPTAINS);
    }
    if (elements.topInput) {
      elements.topInput.innerHTML = buildCharacterOptions(SIDEKICKS);
    }
    if (elements.bottomInput) {
      elements.bottomInput.innerHTML = buildCharacterOptions(SIDEKICKS);
    }
    if (elements.backInput) {
      elements.backInput.innerHTML = buildCharacterOptions(SIDEKICKS);
    }

    setSelectValue(elements.captainInput, DEFAULT_CAPTAIN_UI);
    setSelectValue(elements.topInput, 1);
    setSelectValue(elements.bottomInput, 1);
    setSelectValue(elements.backInput, 1);
  }

  function setSelectValue(selectElement, value) {
    if (!selectElement) {
      return;
    }

    var normalized = String(value);
    for (var i = 0; i < selectElement.options.length; i += 1) {
      if (selectElement.options[i].value === normalized) {
        selectElement.value = normalized;
        return;
      }
    }
  }

  function parseByteInput(element, label) {
    if (!element) {
      return { ok: false, error: label + " field is missing." };
    }

    var raw = String(element.value || "").trim();
    if (raw.length === 0) {
      return { ok: false, error: label + " is required." };
    }

    var value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 255) {
      return { ok: false, error: label + " must be an integer between 1 and 255." };
    }

    return { ok: true, value: value };
  }

  function parseRangedInput(element, label, min, max) {
    var parsed = parseByteInput(element, label);
    if (!parsed.ok) {
      return parsed;
    }

    if (parsed.value < min || parsed.value > max) {
      return { ok: false, error: label + " must be between " + min + " and " + max + "." };
    }

    return parsed;
  }

  function getCaptainName(captainUiId) {
    for (var i = 0; i < CAPTAINS.length; i += 1) {
      if (CAPTAINS[i].id === Number(captainUiId)) {
        return CAPTAINS[i].name;
      }
    }
    return "Captain " + captainUiId;
  }

  function getSidekickName(sidekickUiId) {
    for (var i = 0; i < SIDEKICKS.length; i += 1) {
      if (SIDEKICKS[i].id === Number(sidekickUiId)) {
        return SIDEKICKS[i].name;
      }
    }
    return "Sidekick " + sidekickUiId;
  }

  function asPositiveInt(value) {
    var parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return null;
    }
    return parsed;
  }

  function getLoadedRegionProfile() {
    return state.loadedRegion || REGION_PROFILES.UNKNOWN;
  }

  function formatLoadedRegionMessage(regionProfile) {
    var profile = regionProfile || REGION_PROFILES.UNKNOWN;
    return profile.code + " (" + profile.label + ") save loaded.";
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function getCaptainKey(captainUiId) {
    return CAPTAIN_KEYS[Number(captainUiId)] || "mario";
  }

  function getSidekickKey(sidekickUiId) {
    return SIDEKICK_KEYS[Number(sidekickUiId)] || "koopa";
  }

  function getSidekickFolder(sidekickUiId) {
    return SIDEKICK_FOLDERS[Number(sidekickUiId)] || "01-koopa";
  }

  function getCaptainIconPath(captainUiId) {
    var captainKey = getCaptainKey(captainUiId);
    var captainId = Number(captainUiId);
    var prefix = captainId < 10 ? "0" + captainId : String(captainId);
    return "../assets/msc-saveeditor/captains/" + prefix + "-" + captainKey + ".png";
  }

  function getSidekickFallbackIconPath(sidekickUiId) {
    var sidekickFolder = getSidekickFolder(sidekickUiId);
    var sidekickKey = getSidekickKey(sidekickUiId);
    return "../assets/msc-saveeditor/sidekicks/" + sidekickFolder + "/mario-" + sidekickKey + ".png";
  }

  function getSidekickIconPath(sidekickUiId, captainUiId) {
    var sidekickId = Number(sidekickUiId);
    var captainKey = getCaptainKey(captainUiId);
    var sidekickKey = getSidekickKey(sidekickId);
    var sidekickFolder = getSidekickFolder(sidekickId);
    var fileName = captainKey + "-" + sidekickKey + ".png";
    return "../assets/msc-saveeditor/sidekicks/" + sidekickFolder + "/" + fileName;
  }

  function resolveSlotInput(slotKey) {
    if (slotKey === "captain") {
      return elements.captainInput;
    }
    if (slotKey === "top") {
      return elements.topInput;
    }
    if (slotKey === "bottom") {
      return elements.bottomInput;
    }
    if (slotKey === "back") {
      return elements.backInput;
    }
    return null;
  }

  function resolveSlotButton(slotKey) {
    if (slotKey === "captain") {
      return elements.slotCaptainButton;
    }
    if (slotKey === "top") {
      return elements.slotTopButton;
    }
    if (slotKey === "bottom") {
      return elements.slotBottomButton;
    }
    if (slotKey === "back") {
      return elements.slotBackButton;
    }
    return null;
  }

  function setImageWithFallback(imageElement, primarySrc, fallbackSrc, altText) {
    if (!imageElement) {
      return;
    }

    imageElement.style.display = "";
    imageElement.alt = altText || "";
    imageElement.dataset.fallbackSrc = fallbackSrc || FALLBACK_ICON;
    imageElement.dataset.retried = "0";
    imageElement.onerror = function onImageError() {
      var fallback = imageElement.dataset.fallbackSrc || FALLBACK_ICON;
      var retried = imageElement.dataset.retried === "1";
      if (!retried && imageElement.src !== fallback) {
        imageElement.dataset.retried = "1";
        imageElement.src = fallback;
        return;
      }
      imageElement.onerror = null;
      imageElement.src = FALLBACK_ICON;
    };
    imageElement.src = primarySrc || fallbackSrc || FALLBACK_ICON;
  }

  function clearFormationIcon(imageElement) {
    if (!imageElement) {
      return;
    }
    imageElement.style.display = "none";
    imageElement.alt = "";
    imageElement.onerror = null;
    delete imageElement.dataset.fallbackSrc;
    delete imageElement.dataset.retried;
    imageElement.removeAttribute("src");
  }

  function clearFormationIcons() {
    clearFormationIcon(elements.slotTopIcon);
    clearFormationIcon(elements.slotBackIcon);
    clearFormationIcon(elements.slotBottomIcon);
    clearFormationIcon(elements.slotCaptainIcon);
  }

  function getCurrentCaptainUiValue() {
    if (!elements.captainInput) {
      return DEFAULT_CAPTAIN_UI;
    }
    return Number(elements.captainInput.value || DEFAULT_CAPTAIN_UI);
  }

  function syncSlotButtonStates() {
    var slotKeys = ["top", "back", "bottom", "captain"];
    for (var i = 0; i < slotKeys.length; i += 1) {
      var key = slotKeys[i];
      var button = resolveSlotButton(key);
      if (!button) {
        continue;
      }
      button.classList.toggle("is-active-slot", key === state.activeSlot);
      button.setAttribute("aria-pressed", key === state.activeSlot ? "true" : "false");
    }
  }

  function updateFormationIcons() {
    if (!state.loaded) {
      clearFormationIcons();
      return;
    }

    var captainUiValue = getCurrentCaptainUiValue();
    var captainName = getCaptainName(captainUiValue);

    setImageWithFallback(
      elements.slotCaptainIcon,
      getCaptainIconPath(captainUiValue),
      getCaptainIconPath(DEFAULT_CAPTAIN_UI),
      "Captain: " + captainName
    );

    var topUiValue = Number(elements.topInput && elements.topInput.value ? elements.topInput.value : 1);
    var bottomUiValue = Number(elements.bottomInput && elements.bottomInput.value ? elements.bottomInput.value : 1);
    var backUiValue = Number(elements.backInput && elements.backInput.value ? elements.backInput.value : 1);

    setImageWithFallback(
      elements.slotTopIcon,
      getSidekickIconPath(topUiValue, captainUiValue),
      getSidekickFallbackIconPath(topUiValue),
      "Top: " + getSidekickName(topUiValue)
    );
    setImageWithFallback(
      elements.slotBottomIcon,
      getSidekickIconPath(bottomUiValue, captainUiValue),
      getSidekickFallbackIconPath(bottomUiValue),
      "Bottom: " + getSidekickName(bottomUiValue)
    );
    setImageWithFallback(
      elements.slotBackIcon,
      getSidekickIconPath(backUiValue, captainUiValue),
      getSidekickFallbackIconPath(backUiValue),
      "Back: " + getSidekickName(backUiValue)
    );
  }

  function renderPickerGrid() {
    if (!elements.pickerGrid) {
      return;
    }

    if (!state.loaded) {
      elements.pickerGrid.classList.remove("is-captain-layout");
      elements.pickerGrid.innerHTML = "";
      return;
    }

    var activeSlot = state.activeSlot;
    var isCaptainSlot = activeSlot === "captain";
    elements.pickerGrid.classList.toggle("is-captain-layout", isCaptainSlot);
    var items = isCaptainSlot ? CAPTAINS : SIDEKICKS;
    var slotInput = resolveSlotInput(activeSlot);
    var selectedValue = Number(slotInput && slotInput.value ? slotInput.value : 0);
    var currentCaptain = getCurrentCaptainUiValue();

    var html = [];
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      var isSelected = Number(item.id) === selectedValue;
      var src = isCaptainSlot ? getCaptainIconPath(item.id) : getSidekickIconPath(item.id, currentCaptain);
      var fallback = isCaptainSlot ? getCaptainIconPath(DEFAULT_CAPTAIN_UI) : getSidekickFallbackIconPath(item.id);
      html.push(
        '<button class="save-editor-icon-option' + (isSelected ? " is-selected" : "") + '" data-picker-value="' + item.id + '" type="button" title="' + item.name + '" aria-label="' + item.name + '">' +
        '<img src="' + src + '" data-fallback-src="' + fallback + '" alt="' + item.name + '">' +
        "</button>"
      );
    }
    elements.pickerGrid.innerHTML = html.join("");

    var pickerImages = elements.pickerGrid.querySelectorAll("img[data-fallback-src]");
    for (var j = 0; j < pickerImages.length; j += 1) {
      (function wireFallback(imageElement) {
        imageElement.dataset.retried = "0";
        imageElement.onerror = function onPickerImageError() {
          var fallback = imageElement.getAttribute("data-fallback-src") || FALLBACK_ICON;
          var retried = imageElement.dataset.retried === "1";
          if (!retried) {
            imageElement.dataset.retried = "1";
            imageElement.src = fallback;
            return;
          }
          imageElement.onerror = null;
          imageElement.src = FALLBACK_ICON;
        };
      })(pickerImages[j]);
    }
  }

  function mapUiSidekickToSaveValue(uiValue) {
    if (contract && contract.valueMaps && contract.valueMaps.sidekicks && contract.valueMaps.sidekicks.uiToSave) {
      var mapped = contract.valueMaps.sidekicks.uiToSave[String(uiValue)];
      if (mapped !== undefined) {
        return Number(mapped);
      }
    }
    return Number(uiValue);
  }

  function mapSaveSidekickToUiValue(saveValue) {
    if (contract && contract.valueMaps && contract.valueMaps.sidekicks && contract.valueMaps.sidekicks.saveToUi) {
      var mapped = contract.valueMaps.sidekicks.saveToUi[String(saveValue)];
      if (mapped !== undefined) {
        return Number(mapped);
      }
    }
    return Number(saveValue);
  }

  function getGameSettingsConfig() {
    return contract && contract.gameSettings ? contract.gameSettings : null;
  }

  function hasCalibratedCameraConfig(settings) {
    if (!settings || !settings.maps || !settings.maps.cameraType) {
      return false;
    }
    return (
      Number.isInteger(Number(settings.cameraTypeOffset)) &&
      Number.isInteger(Number(settings.cameraValueOffset))
    );
  }

  function clampCameraLevel(level) {
    var n = Number(level);
    if (!Number.isFinite(n)) {
      return 1;
    }
    n = Math.round(n);
    if (n < 1) {
      return 1;
    }
    if (n > 5) {
      return 5;
    }
    return n;
  }

  function writeCameraLevelToBytes(bytes, settings, level) {
    var offset = Number(settings.cameraValueOffset);
    var format = String(settings.cameraValueFormat || "byte");
    var normalizedLevel = clampCameraLevel(level);

    if (format === "float32_be") {
      if (!bytes || offset < 0 || offset + 3 >= bytes.length) {
        return false;
      }
      var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      var raw = (normalizedLevel - 1) / 4;
      view.setFloat32(offset, raw, false);
      return true;
    }

    if (!bytes || offset < 0 || offset >= bytes.length) {
      return false;
    }
    bytes[offset] = normalizedLevel;
    return true;
  }

  function encodeGameType(modeKey) {
    var settings = getGameSettingsConfig();
    var map = settings && settings.maps ? settings.maps.gameType : null;
    if (!map || map[modeKey] === undefined) {
      return null;
    }
    return Number(map[modeKey]);
  }

  function encodeModeValue(modeKey, uiValue) {
    if (modeKey === "minutes") {
      return Number(uiValue) * 60;
    }
    if (modeKey === "goals") {
      return Number(uiValue);
    }
    return Number(uiValue);
  }

  function encodeMappedValue(selectedKey, map) {
    if (!map) {
      return null;
    }

    var key = String(selectedKey || "");
    if (key.indexOf("raw-") === 0) {
      return Number(key.slice(4));
    }
    if (map[key] === undefined) {
      return null;
    }
    return Number(map[key]);
  }

  function getDefaultCompetitiveSettingsRaw() {
    var settings = getGameSettingsConfig();
    if (!settings || !settings.maps) {
      return { ok: false, error: "Game settings mapping is not calibrated yet." };
    }

    var gameTypeRaw = encodeGameType("goals");
    if (gameTypeRaw === null) {
      return { ok: false, error: "Game Type mapping missing in contract." };
    }

    var envRaw = encodeMappedValue("secureStadia", settings.maps.environmentCheats);
    var powerRaw = encodeMappedValue("none", settings.maps.powerUpCheats);
    var playerRaw = encodeMappedValue("none", settings.maps.playerCheats);
    if (envRaw === null || powerRaw === null || playerRaw === null) {
      return { ok: false, error: "Default competitive settings mapping missing in contract." };
    }

    var cameraTypeRaw;
    var cameraValueRaw;
    if (hasCalibratedCameraConfig(settings)) {
      cameraTypeRaw = encodeMappedValue("static", settings.maps.cameraType);
      if (cameraTypeRaw === null) {
        return { ok: false, error: "Default camera mapping missing in contract." };
      }
      cameraValueRaw = clampCameraLevel(1);
    }

    return {
      ok: true,
      value: {
        skillLevelRaw: 3,
        seriesLengthRaw: 3,
        gameTypeRaw: gameTypeRaw,
        gameMode: "goals",
        gameValueRaw: encodeModeValue("goals", 10),
        environmentRaw: envRaw,
        powerUpRaw: powerRaw,
        playerRaw: playerRaw,
        cameraTypeRaw: cameraTypeRaw,
        cameraValueRaw: cameraValueRaw
      }
    };
  }

  function isValidByteOffset(bytes, offset) {
    return !!(
      bytes &&
      offset !== undefined &&
      offset !== null &&
      Number.isInteger(Number(offset)) &&
      Number(offset) >= 0 &&
      Number(offset) < bytes.length
    );
  }

  function writeGameSettingsBlockToBytes(bytes, settingsBlock, parsedSettings) {
    if (!settingsBlock || !bytes || !parsedSettings) {
      return false;
    }

    var minutesOffset = Number(settingsBlock.minutesValueOffset !== undefined ? settingsBlock.minutesValueOffset : settingsBlock.gameValueOffset);
    var goalsOffset = Number(settingsBlock.goalsValueOffset !== undefined ? settingsBlock.goalsValueOffset : settingsBlock.gameValueOffset);
    var activeValueOffset = parsedSettings.gameMode === "minutes" ? minutesOffset : goalsOffset;
    var requiredOffsets = [
      settingsBlock.skillLevelOffset,
      settingsBlock.gameTypeOffset,
      activeValueOffset,
      settingsBlock.seriesLengthOffset,
      settingsBlock.powerUpCheatOffset,
      settingsBlock.playerCheatOffset
    ];
    for (var i = 0; i < requiredOffsets.length; i += 1) {
      if (!isValidByteOffset(bytes, requiredOffsets[i])) {
        return false;
      }
    }

    bytes[Number(settingsBlock.skillLevelOffset)] = parsedSettings.skillLevelRaw;
    bytes[Number(settingsBlock.gameTypeOffset)] = parsedSettings.gameTypeRaw;
    if (parsedSettings.gameMode === "minutes") {
      bytes[minutesOffset] = parsedSettings.gameValueRaw;
    } else {
      bytes[goalsOffset] = parsedSettings.gameValueRaw;
    }
    bytes[Number(settingsBlock.seriesLengthOffset)] = parsedSettings.seriesLengthRaw;

    if (settingsBlock.environmentCheatOffset !== undefined) {
      if (!isValidByteOffset(bytes, settingsBlock.environmentCheatOffset)) {
        return false;
      }
      bytes[Number(settingsBlock.environmentCheatOffset)] = parsedSettings.environmentRaw;
    }
    bytes[Number(settingsBlock.powerUpCheatOffset)] = parsedSettings.powerUpRaw;
    bytes[Number(settingsBlock.playerCheatOffset)] = parsedSettings.playerRaw;

    if (hasCalibratedCameraConfig(settingsBlock)) {
      if (!isValidByteOffset(bytes, settingsBlock.cameraTypeOffset)) {
        return false;
      }
      bytes[Number(settingsBlock.cameraTypeOffset)] = Number(parsedSettings.cameraTypeRaw);
      if (!writeCameraLevelToBytes(bytes, settingsBlock, parsedSettings.cameraValueRaw)) {
        return false;
      }
    }

    return true;
  }

  function writeGameSettingsToBytes(bytes, parsedSettings) {
    var settings = getGameSettingsConfig();
    if (!settings || !bytes || !parsedSettings) {
      return false;
    }

    if (!writeGameSettingsBlockToBytes(bytes, settings, parsedSettings)) {
      return false;
    }

    var mirroredBlocks = Array.isArray(settings.mirroredBlocks) ? settings.mirroredBlocks : [];
    for (var i = 0; i < mirroredBlocks.length; i += 1) {
      if (!writeGameSettingsBlockToBytes(bytes, mirroredBlocks[i], parsedSettings)) {
        return false;
      }
    }

    return true;
  }

  function enforceDefaultCameraSettings(bytes) {
    if (!bytes) {
      return false;
    }

    var settings = getGameSettingsConfig() || {};
    var cameraTypeOffset = Number.isInteger(Number(settings.cameraTypeOffset)) ? Number(settings.cameraTypeOffset) : 36;
    var cameraValueOffset = Number.isInteger(Number(settings.cameraValueOffset)) ? Number(settings.cameraValueOffset) : 40;
    var cameraValueFormat = String(settings.cameraValueFormat || "float32_be");
    var staticValue = 0;

    if (settings.maps && settings.maps.cameraType && settings.maps.cameraType.static !== undefined) {
      staticValue = Number(settings.maps.cameraType.static);
    }

    if (!Number.isInteger(cameraTypeOffset) || cameraTypeOffset < 0 || cameraTypeOffset >= bytes.length) {
      return false;
    }
    if (!Number.isInteger(cameraValueOffset) || cameraValueOffset < 0 || cameraValueOffset >= bytes.length) {
      return false;
    }

    bytes[cameraTypeOffset] = staticValue;

    var writeOk = writeCameraLevelToBytes(
      bytes,
      {
        cameraValueOffset: cameraValueOffset,
        cameraValueFormat: cameraValueFormat
      },
      1
    );
    return !!writeOk;
  }

  function getCaptainPresetMapping(captainUiValue) {
    if (!contract || !contract.teamPresets) {
      return null;
    }

    var mapping = contract.teamPresets[String(captainUiValue)];
    return mapping || null;
  }

  function getDraftForCaptain(captainUiValue) {
    if (!state.draftsByCaptain) {
      return null;
    }
    var draft = state.draftsByCaptain[String(captainUiValue)];
    return draft || null;
  }

  function readCurrentSidekickDraft() {
    var top = parseRangedInput(elements.topInput, "Top", 1, 8);
    if (!top.ok) {
      return top;
    }

    var bottom = parseRangedInput(elements.bottomInput, "Bottom", 1, 8);
    if (!bottom.ok) {
      return bottom;
    }

    var back = parseRangedInput(elements.backInput, "Back", 1, 8);
    if (!back.ok) {
      return back;
    }

    return {
      ok: true,
      value: {
        top: top.value,
        bottom: bottom.value,
        back: back.value
      }
    };
  }

  function writeDraftForCaptain(captainUiValue) {
    var parsed = readCurrentSidekickDraft();
    if (!parsed.ok) {
      return parsed;
    }

    state.draftsByCaptain[String(captainUiValue)] = parsed.value;
    return { ok: true };
  }

  function getMappedCaptainsText() {
    if (!contract || !contract.teamPresets) {
      return "none";
    }

    var keys = Object.keys(contract.teamPresets);
    if (!keys.length) {
      return "none";
    }

    var names = [];
    for (var i = 0; i < keys.length; i += 1) {
      names.push(getCaptainName(Number(keys[i])));
    }
    return names.join(", ");
  }

  function validateMappingOffsets(mapping, bytesLength) {
    var requiredOffsets = ["topOffset", "bottomOffset", "backOffset"];
    for (var i = 0; i < requiredOffsets.length; i += 1) {
      var key = requiredOffsets[i];
      var offset = Number(mapping[key]);
      if (!Number.isInteger(offset) || offset < 0 || offset >= bytesLength) {
        return { ok: false, error: "Invalid contract offset: " + key };
      }
    }
    return { ok: true };
  }

  function readTeamValues(bytes, mapping) {
    if (!bytes || !mapping) {
      return null;
    }

    var offsetsCheck = validateMappingOffsets(mapping, bytes.length);
    if (!offsetsCheck.ok) {
      return null;
    }

    return {
      top: mapSaveSidekickToUiValue(bytes[Number(mapping.topOffset)]),
      bottom: mapSaveSidekickToUiValue(bytes[Number(mapping.bottomOffset)]),
      back: mapSaveSidekickToUiValue(bytes[Number(mapping.backOffset)])
    };
  }

  function applySidekickValuesToEditors(values) {
    if (!values) {
      return;
    }

    setSelectValue(elements.topInput, values.top);
    setSelectValue(elements.bottomInput, values.bottom);
    setSelectValue(elements.backInput, values.back);
  }

  function getPresetValuesForCaptain(captainUiValue) {
    var draft = getDraftForCaptain(captainUiValue);
    if (draft) {
      return {
        top: Number(draft.top),
        bottom: Number(draft.bottom),
        back: Number(draft.back)
      };
    }

    var mapping = getCaptainPresetMapping(captainUiValue);
    if (!mapping || !state.workingBytes) {
      return null;
    }

    return readTeamValues(state.workingBytes, mapping);
  }

  function buildPresetSnapshotFromState() {
    if (!state.loaded || !state.workingBytes) {
      return { ok: false, error: "Load a save before exporting XML presets." };
    }

    var snapshot = {};
    for (var i = 0; i < CAPTAINS.length; i += 1) {
      var captainId = Number(CAPTAINS[i].id);
      var values = getPresetValuesForCaptain(captainId);
      if (!values) {
        return { ok: false, error: "Failed to resolve preset values for " + getCaptainName(captainId) + "." };
      }

      var top = asPositiveInt(values.top);
      var bottom = asPositiveInt(values.bottom);
      var back = asPositiveInt(values.back);
      if (!top || !bottom || !back || top > 8 || bottom > 8 || back > 8) {
        return { ok: false, error: "Preset values for " + getCaptainName(captainId) + " are invalid." };
      }

      snapshot[String(captainId)] = {
        top: top,
        bottom: bottom,
        back: back
      };
    }

    return { ok: true, value: snapshot };
  }

  function buildPresetXml(snapshot) {
    var region = getLoadedRegionProfile().code;
    var lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<' + XML_ROOT_TAG + ' version="' + escapeXml(XML_VERSION) + '" region="' + escapeXml(region) + '">'
    ];

    for (var i = 0; i < CAPTAINS.length; i += 1) {
      var captainId = Number(CAPTAINS[i].id);
      var entry = snapshot[String(captainId)];
      lines.push(
        '  <captain id="' + captainId + '" name="' + escapeXml(getCaptainName(captainId)) +
        '" top="' + entry.top + '" bottom="' + entry.bottom + '" back="' + entry.back + '" />'
      );
    }

    lines.push('</' + XML_ROOT_TAG + '>');
    return lines.join("\n");
  }

  function parseAndValidatePresetXml(xmlText) {
    if (!xmlText || !String(xmlText).trim().length) {
      return { ok: false, error: "XML import failed: file is empty." };
    }

    var parser = new DOMParser();
    var xmlDoc = parser.parseFromString(xmlText, "application/xml");
    var parseError = xmlDoc.getElementsByTagName("parsererror");
    if (parseError && parseError.length) {
      return { ok: false, error: "XML import failed: invalid XML syntax." };
    }

    var root = xmlDoc.documentElement;
    if (!root || root.tagName !== XML_ROOT_TAG) {
      return { ok: false, error: "XML import failed: root element must be <" + XML_ROOT_TAG + ">." };
    }

    var versionAttr = String(root.getAttribute("version") || "");
    if (versionAttr !== XML_VERSION) {
      return { ok: false, error: "XML import failed: unsupported XML version." };
    }

    for (var n = 0; n < root.childNodes.length; n += 1) {
      var node = root.childNodes[n];
      if (node.nodeType === 1 && node.tagName !== "captain") {
        return { ok: false, error: "XML import failed: unexpected element <" + node.tagName + ">." };
      }
    }

    var captainNodes = [];
    for (var c = 0; c < root.children.length; c += 1) {
      if (root.children[c].tagName === "captain") {
        captainNodes.push(root.children[c]);
      }
    }

    if (captainNodes.length !== CAPTAINS.length) {
      return { ok: false, error: "XML import failed: expected exactly 12 captain entries." };
    }

    var imported = {};
    var seen = {};
    for (var i = 0; i < captainNodes.length; i += 1) {
      var captainNode = captainNodes[i];
      var captainId = asPositiveInt(captainNode.getAttribute("id"));
      var top = asPositiveInt(captainNode.getAttribute("top"));
      var bottom = asPositiveInt(captainNode.getAttribute("bottom"));
      var back = asPositiveInt(captainNode.getAttribute("back"));

      if (!captainId || captainId < 1 || captainId > 12) {
        return { ok: false, error: "XML import failed: captain id must be 1-12." };
      }
      if (seen[String(captainId)]) {
        return { ok: false, error: "XML import failed: duplicate captain id " + captainId + "." };
      }
      if (!top || top > 8 || !bottom || bottom > 8 || !back || back > 8) {
        return { ok: false, error: "XML import failed: sidekick values must be integers 1-8." };
      }

      seen[String(captainId)] = true;
      imported[String(captainId)] = {
        top: top,
        bottom: bottom,
        back: back
      };
    }

    for (var k = 1; k <= 12; k += 1) {
      if (!imported[String(k)]) {
        return { ok: false, error: "XML import failed: missing captain id " + k + "." };
      }
    }

    return { ok: true, value: imported };
  }

  function loadCaptainPresetFromSave(captainUiValue, silent) {
    if (!state.loaded || !state.workingBytes) {
      return false;
    }

    var mapping = getCaptainPresetMapping(captainUiValue);
    if (!mapping) {
      if (!silent) {
        setStatus("No mapping for " + getCaptainName(captainUiValue) + ". Mapped captains: " + getMappedCaptainsText() + ".", "warning");
      }
      return false;
    }

    var values = readTeamValues(state.workingBytes, mapping);
    if (!values) {
      if (!silent) {
        setStatus("Captain mapping exists but offsets are invalid.", "error");
      }
      return false;
    }

    applySidekickValuesToEditors(values);

    if (!silent) {
      setStatus("Loaded current " + getCaptainName(captainUiValue) + " preset from save.", "success");
    }

    return true;
  }

  function loadCaptainEditorValues(captainUiValue, silent) {
    var draft = getDraftForCaptain(captainUiValue);
    if (draft) {
      applySidekickValuesToEditors(draft);
      if (!silent) {
        setStatus("Loaded unsaved draft for " + getCaptainName(captainUiValue) + ".", "warning");
      }
      return true;
    }

    return loadCaptainPresetFromSave(captainUiValue, silent);
  }

  function getContractStatus() {
    var readReady = !!(contract && contract.teamPresets && Object.keys(contract.teamPresets).length > 0);
    var writeReady = false;
    var message = "";

    if (!readReady) {
      message = "Captain mapping is not calibrated yet.";
    } else if (!contract.integrity || contract.integrity.mode !== "known") {
      message = "Read mapping ready, but WRITE is blocked until integrity recalculation is calibrated.";
    } else if (typeof contract.applyIntegrity !== "function") {
      message = "Read mapping ready, but integrity function is missing.";
    } else {
      writeReady = true;
      message = "Contract ready.";
    }

    return {
      readReady: readReady,
      writeReady: writeReady,
      message: message
    };
  }

  function refreshButtons() {
    var contractState = getContractStatus();

    if (elements.applyButton) {
      elements.applyButton.disabled = !(state.loaded && contractState.writeReady);
    }
    if (elements.xmlImportButton) {
      elements.xmlImportButton.disabled = !(state.loaded && contractState.readReady);
    }
    if (elements.xmlExportButton) {
      elements.xmlExportButton.disabled = !(state.loaded && contractState.readReady);
    }

    if (elements.saveButton) {
      elements.saveButton.disabled = !(state.loaded && contractState.writeReady);
    }
  }

  function resetLoadedState() {
    state.loaded = false;
    state.sourceBytes = null;
    state.workingBytes = null;
    state.applied = false;
    state.loadedRegion = REGION_PROFILES.UNKNOWN;
    state.draftsByCaptain = {};
    refreshButtons();
    updateFormationIcons();
    renderPickerGrid();
  }

  function validateLoadedFile(bytes) {
    if (!bytes) {
      return {
        ok: false,
        error: "Failed to read file bytes."
      };
    }

    if (bytes.length === 0) {
      return {
        ok: false,
        error: "This file is empty. Please select the raw Strikers2 save file (35616 bytes), not the region marker file."
      };
    }

    if (bytes.length !== FILE_SIZE) {
      return {
        ok: false,
        error: "Unsupported file size (" + bytes.length + "). Expected a raw Strikers2 file (35616 bytes)."
      };
    }

    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var magic = view.getUint32(0, false);
    if (magic !== FILE_MAGIC_BE) {
      return {
        ok: false,
        error: "Invalid Strikers2 header. This does not look like a supported raw save."
      };
    }

    var trailerByteA = bytes[0x8b00];
    var trailerByteB = bytes[0x8b01];
    var regionProfile = REGION_PROFILES.UNKNOWN;
    var regionKnown = false;

    if (trailerByteA === 0xff && trailerByteB === 0xff) {
      var ntscUOffsets = [35535, 35543, 35547, 35551, 35555, 35563];
      var ntscUHits = 0;
      for (var i = 0; i < ntscUOffsets.length; i += 1) {
        if (bytes[ntscUOffsets[i]] === 0x03) {
          ntscUHits += 1;
        }
      }
      regionProfile = ntscUHits >= 4 ? REGION_PROFILES.NTSC_U : REGION_PROFILES.PAL;
      regionKnown = true;
    } else if (trailerByteA === 0x10 && trailerByteB === 0x00) {
      regionProfile = bytes[135] === 0x65 ? REGION_PROFILES.NTSC_K : REGION_PROFILES.NTSC_J;
      regionKnown = true;
    }

    return {
      ok: true,
      regionProfile: regionProfile,
      regionKnown: regionKnown
    };
  }

  function onSlotClick(event) {
    var slotKey = event && event.currentTarget ? event.currentTarget.getAttribute("data-slot") : "";
    if (!slotKey) {
      return;
    }

    state.activeSlot = slotKey;
    syncSlotButtonStates();
    renderPickerGrid();

    if (!state.loaded) {
      setStatus("Load a Strikers2 save file first.", "warning");
    }
  }

  function onPickerClick(event) {
    if (!elements.pickerGrid) {
      return;
    }

    var pickerButton = event.target && event.target.closest ? event.target.closest("button[data-picker-value]") : null;
    if (!pickerButton) {
      return;
    }

    if (!state.loaded) {
      setStatus("Load a save before editing presets.", "warning");
      return;
    }

    var pickedValue = Number(pickerButton.getAttribute("data-picker-value"));
    var activeSlot = state.activeSlot;

    if (activeSlot === "captain") {
      if (!elements.captainInput) {
        return;
      }
      if (Number(elements.captainInput.value) === pickedValue) {
        return;
      }
      elements.captainInput.value = String(pickedValue);
      onCaptainChange();
      return;
    }

    var slotInput = resolveSlotInput(activeSlot);
    if (!slotInput) {
      return;
    }

    if (Number(slotInput.value) === pickedValue) {
      return;
    }

    slotInput.value = String(pickedValue);
    onSidekickChange();
  }

  function onXmlImportClick() {
    if (!state.loaded) {
      setStatus("Load a Strikers2 save file before importing XML presets.", "warning");
      return;
    }
    if (elements.xmlInput) {
      elements.xmlInput.click();
    }
  }

  function onXmlImportPicked(event) {
    var file = event && event.target && event.target.files ? event.target.files[0] : null;
    if (!file) {
      return;
    }

    if (!state.loaded) {
      setStatus("Load a Strikers2 save file before importing XML presets.", "warning");
      if (elements.xmlInput) {
        elements.xmlInput.value = "";
      }
      return;
    }

    file.text().then(function (xmlText) {
      var parsed = parseAndValidatePresetXml(xmlText);
      if (!parsed.ok) {
        setStatus(parsed.error, "error");
        return;
      }

      state.draftsByCaptain = parsed.value;
      state.applied = false;
      refreshButtons();

      var currentCaptain = Number(elements.captainInput && elements.captainInput.value ? elements.captainInput.value : DEFAULT_CAPTAIN_UI);
      state.currentCaptainUi = currentCaptain;
      loadCaptainEditorValues(currentCaptain, true);
      updateFormationIcons();
      renderPickerGrid();
      syncSlotButtonStates();

      setStatus("XML presets imported successfully. Export Save will apply them.", "success");
    }).catch(function () {
      setStatus("XML import failed: unable to read file.", "error");
    }).finally(function () {
      if (elements.xmlInput) {
        elements.xmlInput.value = "";
      }
    });
  }

  function onXmlExportClick() {
    if (!state.loaded) {
      setStatus("Load a Strikers2 save file before exporting XML presets.", "warning");
      return;
    }
    if (!elements.xmlDownloadAnchor) {
      setStatus("XML export failed: download target is missing.", "error");
      return;
    }

    var snapshot = buildPresetSnapshotFromState();
    if (!snapshot.ok) {
      setStatus(snapshot.error, "error");
      return;
    }

    var xmlText = buildPresetXml(snapshot.value);
    var region = getLoadedRegionProfile().code.toLowerCase();
    var fileName = "msc-presets-" + region + ".xml";
    var blob = new Blob([xmlText], { type: "application/xml;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    elements.xmlDownloadAnchor.href = url;
    elements.xmlDownloadAnchor.download = fileName;
    elements.xmlDownloadAnchor.click();
    URL.revokeObjectURL(url);
    setStatus("XML presets exported: " + fileName, "success");
  }

  function onLoadClick() {
    if (elements.fileInput) {
      elements.fileInput.click();
    }
  }

  function handleLoadedSaveBytes(bytes, filename) {
    var check = validateLoadedFile(bytes);
    if (!check.ok) {
      resetLoadedState();
      setStatus(check.error, "error");
      return;
    }

    state.loaded = true;
    state.fileName = filename && filename.length ? filename : FALLBACK_FILENAME;
    state.sourceBytes = bytes;
    state.workingBytes = new Uint8Array(bytes);
    state.applied = false;
    state.draftsByCaptain = {};
    state.currentCaptainUi = Number(elements.captainInput && elements.captainInput.value ? elements.captainInput.value : DEFAULT_CAPTAIN_UI);
    state.activeSlot = "captain";
    state.loadedRegion = check.regionProfile || REGION_PROFILES.UNKNOWN;

    refreshButtons();
    syncSlotButtonStates();

    var selectedCaptain = state.currentCaptainUi;
    loadCaptainEditorValues(selectedCaptain, true);
    updateFormationIcons();
    renderPickerGrid();
    setStatus(formatLoadedRegionMessage(state.loadedRegion), check.regionKnown ? "success" : "warning");
  }

  function onFilePicked(event) {
    var file = event && event.target && event.target.files ? event.target.files[0] : null;
    if (!file) {
      return;
    }

    file.arrayBuffer().then(function (buffer) {
      handleLoadedSaveBytes(new Uint8Array(buffer), file.name);
    }).catch(function () {
      resetLoadedState();
      setStatus("Failed to read file.", "error");
    }).finally(function () {
      if (elements.fileInput) {
        elements.fileInput.value = "";
      }
    });
  }

  function onCaptainChange() {
    if (!elements.captainInput || !state.loaded) {
      return;
    }

    var previousCaptain = Number(state.currentCaptainUi);
    if (Number.isInteger(previousCaptain) && previousCaptain >= 1 && previousCaptain <= 12) {
      writeDraftForCaptain(previousCaptain);
      state.applied = false;
    }

    var chosenCaptain = Number(elements.captainInput.value);
    state.currentCaptainUi = chosenCaptain;
    loadCaptainEditorValues(chosenCaptain, false);
    updateFormationIcons();
    renderPickerGrid();
    syncSlotButtonStates();
    refreshButtons();
  }

  function onSidekickChange() {
    if (!state.loaded) {
      return;
    }

    var currentCaptain = Number(state.currentCaptainUi);
    if (!Number.isInteger(currentCaptain) || currentCaptain < 1 || currentCaptain > 12) {
      return;
    }

    writeDraftForCaptain(currentCaptain);
    state.applied = false;
    updateFormationIcons();
    renderPickerGrid();
    syncSlotButtonStates();
    refreshButtons();
  }

  function applyCurrentDraftsToWorkingBytes() {
    if (!state.loaded || !state.workingBytes) {
      return { ok: false, error: "Load a save first." };
    }

    var contractState = getContractStatus();
    if (!contractState.writeReady) {
      return { ok: false, error: "WRITE blocked: " + contractState.message };
    }

    var currentCaptain = parseRangedInput(elements.captainInput, "Captain", 1, 12);
    if (!currentCaptain.ok) {
      return { ok: false, error: currentCaptain.error };
    }

    // Persist currently visible editor values before applying.
    var draftWrite = writeDraftForCaptain(currentCaptain.value);
    if (!draftWrite.ok) {
      return { ok: false, error: draftWrite.error };
    }

    var defaultSettings = getDefaultCompetitiveSettingsRaw();
    if (!defaultSettings.ok) {
      return { ok: false, error: defaultSettings.error };
    }

    var nextBytes = new Uint8Array(state.workingBytes);
    var draftKeys = Object.keys(state.draftsByCaptain || {});

    var appliedCaptains = 0;
    for (var i = 0; i < draftKeys.length; i += 1) {
      var captainUiValue = Number(draftKeys[i]);
      var draft = state.draftsByCaptain[draftKeys[i]];
      if (!draft) {
        continue;
      }

      var mapping = getCaptainPresetMapping(captainUiValue);
      if (!mapping) {
        continue;
      }

      var offsetsCheck = validateMappingOffsets(mapping, nextBytes.length);
      if (!offsetsCheck.ok) {
        return { ok: false, error: offsetsCheck.error };
      }

      nextBytes[Number(mapping.topOffset)] = mapUiSidekickToSaveValue(draft.top);
      nextBytes[Number(mapping.bottomOffset)] = mapUiSidekickToSaveValue(draft.bottom);
      nextBytes[Number(mapping.backOffset)] = mapUiSidekickToSaveValue(draft.back);
      appliedCaptains += 1;
    }

    var wroteSettings = writeGameSettingsToBytes(nextBytes, defaultSettings.value);
    var wroteCameraDefault = enforceDefaultCameraSettings(nextBytes);
    if (!appliedCaptains && !wroteSettings) {
      return { ok: false, warning: true, error: "No mapped captain drafts or settings to write." };
    }
    if (!wroteCameraDefault) {
      return { ok: false, error: "WRITE blocked: camera default could not be written." };
    }

    try {
      var integrityResult = contract.applyIntegrity(nextBytes, {
        captains: appliedCaptains
      });

      if (integrityResult === false) {
        return { ok: false, error: "WRITE blocked: integrity recalculation failed." };
      }
    } catch (error) {
      return { ok: false, error: "WRITE blocked: integrity recalculation failed." };
    }

    state.workingBytes = nextBytes;
    state.applied = true;
    return {
      ok: true,
      appliedCaptains: appliedCaptains,
      wroteSettings: wroteSettings
    };
  }

  function onApplyClick() {
    var applyResult = applyCurrentDraftsToWorkingBytes();
    if (!applyResult.ok) {
      state.applied = false;
      refreshButtons();
      setStatus(applyResult.error, applyResult.warning ? "warning" : "error");
      return;
    }

    refreshButtons();
    setStatus("Wrote changes to save.", "success");
  }

  function onSaveClick() {
    var applyResult = applyCurrentDraftsToWorkingBytes();
    if (!applyResult.ok) {
      state.applied = false;
      refreshButtons();
      setStatus(applyResult.error, applyResult.warning ? "warning" : "error");
      return;
    }

    refreshButtons();
    downloadBytes(state.workingBytes, state.fileName || FALLBACK_FILENAME);
    setStatus("Patched save exported.", "success");
  }

  function boot() {
    initCharacterOptions();
    refreshButtons();
    updateFormationIcons();
    syncSlotButtonStates();
    renderPickerGrid();

    if (elements.loadButton) {
      elements.loadButton.addEventListener("click", onLoadClick);
    }
    if (elements.fileInput) {
      elements.fileInput.addEventListener("change", onFilePicked);
    }
    if (elements.xmlImportButton) {
      elements.xmlImportButton.addEventListener("click", onXmlImportClick);
    }
    if (elements.xmlInput) {
      elements.xmlInput.addEventListener("change", onXmlImportPicked);
    }
    if (elements.xmlExportButton) {
      elements.xmlExportButton.addEventListener("click", onXmlExportClick);
    }
    if (elements.applyButton) {
      elements.applyButton.addEventListener("click", onApplyClick);
    }
    if (elements.saveButton) {
      elements.saveButton.addEventListener("click", onSaveClick);
    }
    if (elements.captainInput) {
      elements.captainInput.addEventListener("change", onCaptainChange);
    }
    if (elements.topInput) {
      elements.topInput.addEventListener("change", onSidekickChange);
    }
    if (elements.bottomInput) {
      elements.bottomInput.addEventListener("change", onSidekickChange);
    }
    if (elements.backInput) {
      elements.backInput.addEventListener("change", onSidekickChange);
    }
    if (elements.slotTopButton) {
      elements.slotTopButton.addEventListener("click", onSlotClick);
    }
    if (elements.slotBackButton) {
      elements.slotBackButton.addEventListener("click", onSlotClick);
    }
    if (elements.slotBottomButton) {
      elements.slotBottomButton.addEventListener("click", onSlotClick);
    }
    if (elements.slotCaptainButton) {
      elements.slotCaptainButton.addEventListener("click", onSlotClick);
    }
    if (elements.pickerGrid) {
      elements.pickerGrid.addEventListener("click", onPickerClick);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
