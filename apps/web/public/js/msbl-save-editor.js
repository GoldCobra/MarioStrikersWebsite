(function (root) {
  "use strict";

  var contract = root.MsblSaveEditorContract || {};
  var documentRef = root.document || null;
  var MAX_COINS = 0xFFFFFFFF;
  var FALLBACK_FILENAME = contract.fileName || "strkrs.save";
  var GEAR_PRESET_XML_VERSION = "1";
  var GEAR_PRESET_ROOT_TAG = "msbl-gear-presets";

  var state = {
    loaded: false,
    fileName: FALLBACK_FILENAME,
    sourceBytes: null,
    workingBytes: null,
    entryCount: 0,
    charBlockCount: 0,
    coinValue: 0,
    dirty: false
  };

  function byId(id) {
    return documentRef ? documentRef.getElementById(id) : null;
  }

  var elements = {
    loadButton: byId("msbl-save-editor-load"),
    gearImportButton: byId("msbl-save-editor-gear-import"),
    completeCupsButton: byId("msbl-save-editor-complete-cups"),
    haveAllButton: byId("msbl-save-editor-have-all"),
    exportButton: byId("msbl-save-editor-export"),
    fileInput: byId("msbl-save-editor-file-input"),
    gearInput: byId("msbl-save-editor-gear-input"),
    downloadAnchor: byId("msbl-save-editor-download"),
    coinsInput: byId("msbl-save-editor-coins"),
    status: byId("msbl-save-editor-status")
  };

  function toUint32(value) {
    return Number(value) >>> 0;
  }

  function hashKey(value) {
    return String(toUint32(value));
  }

  function readU32LE(bytes, offset) {
    if (!bytes || offset < 0 || offset + 4 > bytes.length) {
      throw new Error("Cannot read u32 outside byte buffer.");
    }
    return (
      bytes[offset] +
      bytes[offset + 1] * 0x100 +
      bytes[offset + 2] * 0x10000 +
      bytes[offset + 3] * 0x1000000
    ) >>> 0;
  }

  function writeU32LE(bytes, offset, value) {
    if (!bytes || offset < 0 || offset + 4 > bytes.length) {
      throw new Error("Cannot write u32 outside byte buffer.");
    }
    var normalized = toUint32(value);
    bytes[offset] = normalized & 0xFF;
    bytes[offset + 1] = (normalized >>> 8) & 0xFF;
    bytes[offset + 2] = (normalized >>> 16) & 0xFF;
    bytes[offset + 3] = (normalized >>> 24) & 0xFF;
  }

  function cloneBytes(bytes) {
    if (bytes instanceof Uint8Array) {
      return new Uint8Array(bytes);
    }
    if (bytes instanceof ArrayBuffer) {
      return new Uint8Array(bytes);
    }
    throw new Error("Expected save bytes.");
  }

  function entryTag(entry) {
    return entry && entry.size >= 8 ? readU32LE(entry.raw, 0) : null;
  }

  function entryDlen(entry) {
    return entry && entry.size >= 8 ? readU32LE(entry.raw, 4) : null;
  }

  function entryPayloadLen(entry) {
    return entry.raw.length - entry.payloadOff;
  }

  function entryReadU32(entry, payloadIndex) {
    var offset = entry.payloadOff + (payloadIndex || 0);
    return readU32LE(entry.raw, offset);
  }

  function entryWriteU32(entry, payloadIndex, value) {
    var offset = entry.payloadOff + (payloadIndex || 0);
    writeU32LE(entry.raw, offset, value);
  }

  function parseSave(inputBytes) {
    var bytes = cloneBytes(inputBytes);
    if (bytes.length < 0x18) {
      throw new Error("Save too small.");
    }

    var magic = readU32LE(bytes, 0x0);
    var version = readU32LE(bytes, 0x4);
    var entryCount = readU32LE(bytes, 0x8);
    var tableStart = 0x18;
    var tableEnd = tableStart + entryCount * 12;
    if (tableEnd > bytes.length) {
      throw new Error("Entry table exceeds file size.");
    }

    var rows = [];
    var minNormalRel = null;
    var i;
    for (i = 0; i < entryCount; i += 1) {
      var rowOffset = tableStart + i * 12;
      var keyHash = readU32LE(bytes, rowOffset);
      var size = readU32LE(bytes, rowOffset + 4);
      var relOff = readU32LE(bytes, rowOffset + 8);
      rows.push({ keyHash: keyHash, size: size, relOff: relOff });
      if (size >= 4 && (minNormalRel === null || relOff < minNormalRel)) {
        minNormalRel = relOff;
      }
    }

    var base = tableEnd - (minNormalRel === null ? 0 : minNormalRel);
    var entries = [];
    var byHash = Object.create(null);
    for (i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var absOff = base + row.relOff;
      if (absOff < 0 || absOff + row.size > bytes.length) {
        throw new Error("Entry " + i + " out of bounds.");
      }
      var entry = {
        idx: i,
        keyHash: toUint32(row.keyHash),
        size: row.size,
        relOff: row.relOff,
        absOff: absOff,
        raw: bytes.slice(absOff, absOff + row.size),
        payloadOff: row.size >= 8 ? 8 : 0
      };
      entries.push(entry);

      var key = hashKey(entry.keyHash);
      if (!byHash[key]) {
        byHash[key] = [];
      }
      byHash[key].push(entry);
    }

    return {
      buf: bytes,
      magic: magic,
      version: version,
      entryCount: entryCount,
      entries: entries,
      byHash: byHash
    };
  }

  function saveToBytes(save) {
    var out = new Uint8Array(save.buf);
    for (var i = 0; i < save.entries.length; i += 1) {
      var entry = save.entries[i];
      out.set(entry.raw, entry.absOff);
    }
    return out;
  }

  function getFirst(save, keyHash) {
    var entries = save.byHash[hashKey(keyHash)];
    return entries && entries.length ? entries[0] : null;
  }

  function resolveCoinEntry(save) {
    var entry = getFirst(save, contract.knownCoinHash);
    if (!entry || entryPayloadLen(entry) < 4) {
      throw new Error("Coin entry not found.");
    }
    return entry;
  }

  function findCharacterBlocks(save) {
    var blocks = [];
    var entries = save.entries;
    var i = 0;
    while (i < entries.length) {
      var header = entries[i];
      if (
        entryTag(header) === toUint32(contract.tagCharHeader) &&
        entryDlen(header) === 1 &&
        entryPayloadLen(header) === 2
      ) {
        var fields = [];
        var j = i + 1;
        while (j < entries.length && fields.length < 12) {
          var field = entries[j];
          if (
            entryTag(field) !== toUint32(contract.tagCharField) ||
            entryDlen(field) !== 4 ||
            entryPayloadLen(field) !== 4
          ) {
            break;
          }
          fields.push(field);
          j += 1;
        }

        if (fields.length >= 10) {
          blocks.push({ fields: fields });
          i = j;
          continue;
        }
      }
      i += 1;
    }
    return blocks;
  }

  function loadEditable(bytes) {
    var save = parseSave(bytes);
    var coinEntry = resolveCoinEntry(save);
    var charBlocks = findCharacterBlocks(save);
    return {
      save: save,
      coinEntry: coinEntry,
      charBlocks: charBlocks
    };
  }

  function validateSupportedContext(context) {
    if (!context.charBlocks || context.charBlocks.length < 16) {
      throw new Error("Character blocks not found correctly (found " + (context.charBlocks ? context.charBlocks.length : 0) + ").");
    }
  }

  function bytesFromHex(hex) {
    var clean = String(hex || "").replace(/\s+/g, "");
    if (clean.length % 2 !== 0) {
      throw new Error("Invalid hex payload length.");
    }
    var out = new Uint8Array(clean.length / 2);
    for (var i = 0; i < clean.length; i += 2) {
      var byteValue = parseInt(clean.slice(i, i + 2), 16);
      if (!Number.isInteger(byteValue)) {
        throw new Error("Invalid hex payload.");
      }
      out[i / 2] = byteValue;
    }
    return out;
  }

  function payloadBytes(payloadSpec) {
    if (!payloadSpec._bytes) {
      payloadSpec._bytes = bytesFromHex(payloadSpec.payloadHex);
    }
    return payloadSpec._bytes;
  }

  function emptyCupRunBytes() {
    if (!contract._emptyCupRunBytes) {
      contract._emptyCupRunBytes = bytesFromHex(contract.emptyCupRunPayloadHex);
    }
    return contract._emptyCupRunBytes;
  }

  function bytesEqual(left, right) {
    if (!left || !right || left.length !== right.length) {
      return false;
    }
    for (var i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) {
        return false;
      }
    }
    return true;
  }

  function readPayload(entry) {
    return entry.raw.subarray(entry.payloadOff, entry.payloadOff + entryPayloadLen(entry));
  }

  function applyCoinsToSave(save, coinValue) {
    var entry = resolveCoinEntry(save);
    var current = entryReadU32(entry, 0);
    if (current === coinValue) {
      return false;
    }
    entryWriteU32(entry, 0, coinValue);
    return true;
  }

  function setPayloadExact(save, keyHash, label, payload) {
    var entry = getFirst(save, keyHash);
    if (!entry) {
      throw new Error(label + " entry not found.");
    }
    if (entryTag(entry) === toUint32(contract.tagCharField)) {
      throw new Error(label + " entry points to character data; refusing to modify it.");
    }
    if (entryPayloadLen(entry) !== payload.length) {
      throw new Error(label + " entry has unexpected size (" + entryPayloadLen(entry) + " != " + payload.length + ").");
    }
    if (bytesEqual(readPayload(entry), payload)) {
      return false;
    }
    entry.raw.set(payload, entry.payloadOff);
    return true;
  }

  function setCupDetailIfEmpty(save, keyHash, label, completedPayload) {
    var entry = getFirst(save, keyHash);
    if (!entry) {
      throw new Error(label + " entry not found.");
    }
    if (entryTag(entry) === toUint32(contract.tagCharField)) {
      throw new Error(label + " entry points to character data; refusing to modify it.");
    }
    if (entryPayloadLen(entry) !== completedPayload.length) {
      throw new Error(label + " entry has unexpected size (" + entryPayloadLen(entry) + " != " + completedPayload.length + ").");
    }

    var current = readPayload(entry);
    if (bytesEqual(current, completedPayload)) {
      return false;
    }
    if (!bytesEqual(current, emptyCupRunBytes())) {
      return false;
    }

    entry.raw.set(completedPayload, entry.payloadOff);
    return true;
  }

  function setCupsCompletedAndBushidoUnlocked(save) {
    var changed = false;
    var i;
    var payloadSpec;

    for (i = 0; i < contract.cupBattleProgressPayloads.length; i += 1) {
      payloadSpec = contract.cupBattleProgressPayloads[i];
      changed = setPayloadExact(save, payloadSpec.keyHash, payloadSpec.label, payloadBytes(payloadSpec)) || changed;
    }

    for (i = 0; i < contract.cupGlobalStatePayloads.length; i += 1) {
      payloadSpec = contract.cupGlobalStatePayloads[i];
      changed = setPayloadExact(save, payloadSpec.keyHash, payloadSpec.label, payloadBytes(payloadSpec)) || changed;
    }

    for (i = 0; i < contract.cupCompletedDetailPayloads.length; i += 1) {
      payloadSpec = contract.cupCompletedDetailPayloads[i];
      changed = setCupDetailIfEmpty(save, payloadSpec.keyHash, payloadSpec.label, payloadBytes(payloadSpec)) || changed;
    }

    changed = setPayloadExact(save, contract.bushidoUnlockHash, "Bushido unlock", new Uint8Array([1])) || changed;
    return changed;
  }

  function setAllGearOwnedForAllCharacters(context) {
    var changed = false;
    var parts = contract.parts || [];
    var byteIndexByPart = contract.byteIndexByPart || {};
    var setFieldPos = contract.setFieldPos || [];

    for (var blockIndex = 0; blockIndex < context.charBlocks.length; blockIndex += 1) {
      var block = context.charBlocks[blockIndex];
      for (var partIndex = 0; partIndex < parts.length; partIndex += 1) {
        var part = parts[partIndex];
        var byteIndex = byteIndexByPart[part];
        if (!Number.isInteger(byteIndex)) {
          throw new Error("Missing byte index for gear part " + part + ".");
        }
        for (var setIndex = 0; setIndex < setFieldPos.length; setIndex += 1) {
          var fieldPos = setFieldPos[setIndex];
          if (fieldPos >= block.fields.length) {
            continue;
          }
          var field = block.fields[fieldPos];
          var rawOffset = field.payloadOff + byteIndex;
          if (rawOffset < 0 || rawOffset >= field.raw.length) {
            throw new Error("Unexpected gear field size in character block " + (blockIndex + 1) + ".");
          }
          if (field.raw[rawOffset] !== 1) {
            field.raw[rawOffset] = 1;
            changed = true;
          }
        }
      }
    }

    return changed;
  }

  function getCharacterNameById(characterId) {
    var names = contract.charNames || [];
    return names[characterId - 1] || "Character " + characterId;
  }

  function loadoutEntryForCharacter(context, characterIndex) {
    var entry;
    if (characterIndex === 0) {
      entry = getFirst(context.save, contract.marioLoadoutHash);
    } else {
      var previousBlock = context.charBlocks[characterIndex - 1];
      entry = previousBlock && previousBlock.fields.length > 10 ? previousBlock.fields[10] : null;
    }

    if (!entry) {
      throw new Error("Equipped gear entry not found for " + getCharacterNameById(characterIndex + 1) + ".");
    }
    if (entryTag(entry) !== toUint32(contract.tagCharField) || entryPayloadLen(entry) !== 4) {
      throw new Error("Equipped gear entry has unexpected format for " + getCharacterNameById(characterIndex + 1) + ".");
    }
    return entry;
  }

  function writeGearPresetToCharacter(context, presetEntry) {
    var characterId = presetEntry.id;
    var characterIndex = characterId - 1;
    var block = context.charBlocks[characterIndex];
    if (!block) {
      throw new Error("Character block not found for id " + characterId + ".");
    }

    var loadoutEntry = loadoutEntryForCharacter(context, characterIndex);
    var parts = contract.parts || [];
    var byteIndexByPart = contract.byteIndexByPart || {};
    var setFieldPos = contract.setFieldPos || [];
    var loadoutIds = contract.builderGearDigitToLoadoutId || [];
    var changed = false;
    var usesBushido = false;

    for (var partIndex = 0; partIndex < parts.length; partIndex += 1) {
      var part = parts[partIndex];
      var digit = Number(presetEntry.build.charAt(partIndex));
      var byteIndex = byteIndexByPart[part];
      var loadoutId = loadoutIds[digit];
      if (!Number.isInteger(byteIndex) || !Number.isInteger(loadoutId)) {
        throw new Error("Gear preset import failed: unsupported gear digit.");
      }

      var loadoutOffset = loadoutEntry.payloadOff + byteIndex;
      if (loadoutEntry.raw[loadoutOffset] !== loadoutId) {
        loadoutEntry.raw[loadoutOffset] = loadoutId;
        changed = true;
      }

      if (digit === 0) {
        continue;
      }
      if (digit === 6) {
        usesBushido = true;
      }

      var fieldPos = setFieldPos[digit - 1];
      var purchaseField = block.fields[fieldPos];
      if (!purchaseField) {
        throw new Error("Purchase gear entry not found for " + getCharacterNameById(characterId) + ".");
      }
      var purchaseOffset = purchaseField.payloadOff + byteIndex;
      if (purchaseOffset < 0 || purchaseOffset >= purchaseField.raw.length) {
        throw new Error("Purchase gear entry has unexpected size for " + getCharacterNameById(characterId) + ".");
      }
      if (purchaseField.raw[purchaseOffset] !== 1) {
        purchaseField.raw[purchaseOffset] = 1;
        changed = true;
      }
    }

    return {
      changed: changed,
      usesBushido: usesBushido
    };
  }

  function applyGearPresetToSave(context, preset) {
    var changed = false;
    var usesBushido = false;
    for (var i = 0; i < preset.characters.length; i += 1) {
      var result = writeGearPresetToCharacter(context, preset.characters[i]);
      changed = result.changed || changed;
      usesBushido = result.usesBushido || usesBushido;
    }
    if (usesBushido) {
      changed = setCupsCompletedAndBushidoUnlocked(context.save) || changed;
    }
    return {
      changed: changed,
      characterCount: preset.characters.length,
      usesBushido: usesBushido
    };
  }

  function parseGearPresetXml(xmlText) {
    if (!xmlText || !String(xmlText).trim().length) {
      return { ok: false, error: "Gear preset import failed: file is empty." };
    }
    if (typeof root.DOMParser === "undefined") {
      return { ok: false, error: "Gear preset import failed: XML parser is unavailable." };
    }

    var parser = new root.DOMParser();
    var xmlDoc = parser.parseFromString(xmlText, "application/xml");
    var parseError = xmlDoc.getElementsByTagName("parsererror");
    if (parseError && parseError.length) {
      return { ok: false, error: "Gear preset import failed: invalid XML syntax." };
    }

    var rootElement = xmlDoc.documentElement;
    if (!rootElement || rootElement.tagName !== GEAR_PRESET_ROOT_TAG) {
      return { ok: false, error: "Gear preset import failed: root element must be <" + GEAR_PRESET_ROOT_TAG + ">." };
    }
    if (String(rootElement.getAttribute("version") || "") !== GEAR_PRESET_XML_VERSION) {
      return { ok: false, error: "Gear preset import failed: unsupported XML version." };
    }

    var characters = [];
    var seen = Object.create(null);
    for (var i = 0; i < rootElement.children.length; i += 1) {
      var node = rootElement.children[i];
      if (node.tagName !== "character") {
        return { ok: false, error: "Gear preset import failed: unexpected element <" + node.tagName + ">." };
      }

      var id = Number(String(node.getAttribute("id") || "").trim());
      var build = String(node.getAttribute("build") || "").trim();
      if (!Number.isInteger(id) || id < 1 || id > 16) {
        return { ok: false, error: "Gear preset import failed: character id must be 1-16." };
      }
      if (seen[String(id)]) {
        return { ok: false, error: "Gear preset import failed: duplicate character id " + id + "." };
      }
      if (!/^[0-9]{4}$/.test(build)) {
        return { ok: false, error: "Gear preset import failed: build must be four digits 0-9." };
      }

      seen[String(id)] = true;
      characters.push({
        id: id,
        name: String(node.getAttribute("name") || getCharacterNameById(id)),
        build: build
      });
    }

    if (!characters.length) {
      return { ok: false, error: "Gear preset import failed: XML contains no characters." };
    }

    return {
      ok: true,
      value: {
        version: GEAR_PRESET_XML_VERSION,
        characters: characters
      }
    };
  }

  function parseCoinsText(rawValue) {
    var raw = String(rawValue === undefined || rawValue === null ? "" : rawValue).trim();
    if (!/^\d+$/.test(raw)) {
      return { ok: false, error: "Coins must be an integer between 0 and 4294967295." };
    }
    var value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > MAX_COINS) {
      return { ok: false, error: "Coins must be an integer between 0 and 4294967295." };
    }
    return { ok: true, value: value };
  }

  function inspectBytes(bytes) {
    var context = loadEditable(bytes);
    return {
      size: cloneBytes(bytes).length,
      magic: context.save.magic,
      version: context.save.version,
      entryCount: context.save.entryCount,
      coins: entryReadU32(context.coinEntry, 0),
      charBlockCount: context.charBlocks.length
    };
  }

  function runPatch(bytes, patcher) {
    var context = loadEditable(bytes);
    validateSupportedContext(context);
    var patchResult = patcher(context);
    var changed = patchResult && typeof patchResult === "object" ? !!patchResult.changed : !!patchResult;
    return {
      bytes: saveToBytes(context.save),
      changed: changed,
      info: {
        entryCount: context.save.entryCount,
        charBlockCount: context.charBlocks.length,
        coins: entryReadU32(resolveCoinEntry(context.save), 0)
      }
    };
  }

  function patchCoins(bytes, coinValue) {
    return runPatch(bytes, function (context) {
      return applyCoinsToSave(context.save, coinValue);
    }).bytes;
  }

  function patchCompleteCups(bytes) {
    return runPatch(bytes, function (context) {
      return setCupsCompletedAndBushidoUnlocked(context.save);
    }).bytes;
  }

  function patchHaveAllGear(bytes) {
    return runPatch(bytes, function (context) {
      var changed = setAllGearOwnedForAllCharacters(context);
      changed = setCupsCompletedAndBushidoUnlocked(context.save) || changed;
      return changed;
    }).bytes;
  }

  function patchGearPreset(bytes, preset) {
    return runPatch(bytes, function (context) {
      return applyGearPresetToSave(context, preset);
    }).bytes;
  }

  function countUnownedGear(bytes) {
    var context = loadEditable(bytes);
    validateSupportedContext(context);
    var count = 0;
    var parts = contract.parts || [];
    var byteIndexByPart = contract.byteIndexByPart || {};
    var setFieldPos = contract.setFieldPos || [];

    for (var blockIndex = 0; blockIndex < context.charBlocks.length; blockIndex += 1) {
      var block = context.charBlocks[blockIndex];
      for (var partIndex = 0; partIndex < parts.length; partIndex += 1) {
        var part = parts[partIndex];
        var byteIndex = byteIndexByPart[part];
        for (var setIndex = 0; setIndex < setFieldPos.length; setIndex += 1) {
          var fieldPos = setFieldPos[setIndex];
          if (fieldPos >= block.fields.length) {
            continue;
          }
          var field = block.fields[fieldPos];
          if (field.raw[field.payloadOff + byteIndex] !== 1) {
            count += 1;
          }
        }
      }
    }
    return count;
  }

  function getCupStatus(bytes) {
    var context = loadEditable(bytes);
    var save = context.save;
    var exactPayloads = contract.cupBattleProgressPayloads.concat(contract.cupGlobalStatePayloads);
    var exactComplete = true;
    var detailsCompleted = true;
    var detailsEmptyCount = 0;
    var detailsProtectedCount = 0;
    var detailStatuses = [];
    var i;
    var payloadSpec;

    for (i = 0; i < exactPayloads.length; i += 1) {
      payloadSpec = exactPayloads[i];
      var exactEntry = getFirst(save, payloadSpec.keyHash);
      exactComplete = !!exactEntry && bytesEqual(readPayload(exactEntry), payloadBytes(payloadSpec)) && exactComplete;
    }

    for (i = 0; i < contract.cupCompletedDetailPayloads.length; i += 1) {
      payloadSpec = contract.cupCompletedDetailPayloads[i];
      var detailEntry = getFirst(save, payloadSpec.keyHash);
      var detailStatus = "missing";
      if (detailEntry) {
        var currentDetail = readPayload(detailEntry);
        if (bytesEqual(currentDetail, payloadBytes(payloadSpec))) {
          detailStatus = "completed";
        } else if (bytesEqual(currentDetail, emptyCupRunBytes())) {
          detailStatus = "empty";
          detailsEmptyCount += 1;
        } else {
          detailStatus = "protected";
          detailsProtectedCount += 1;
        }
      }
      detailStatuses.push({
        label: payloadSpec.label,
        status: detailStatus
      });
      detailsCompleted = detailStatus === "completed" && detailsCompleted;
    }

    var bushidoEntry = getFirst(save, contract.bushidoUnlockHash);
    var bushidoUnlocked = !!bushidoEntry && entryPayloadLen(bushidoEntry) >= 1 && readPayload(bushidoEntry)[0] === 1;

    return {
      exactComplete: exactComplete,
      detailsCompleted: detailsCompleted,
      detailsEmptyCount: detailsEmptyCount,
      detailsProtectedCount: detailsProtectedCount,
      detailStatuses: detailStatuses,
      bushidoUnlocked: bushidoUnlocked,
      applied: exactComplete && detailsEmptyCount === 0 && bushidoUnlocked,
      complete: exactComplete && detailsCompleted && bushidoUnlocked
    };
  }

  function setStatus(message, level) {
    if (!elements.status) {
      return;
    }

    elements.status.textContent = message || "";
    elements.status.classList.remove("is-warning", "is-error", "is-success");
    if (level === "warning") {
      elements.status.classList.add("is-warning");
    } else if (level === "error") {
      elements.status.classList.add("is-error");
    } else if (level === "success") {
      elements.status.classList.add("is-success");
    }
  }

  function getCurrentCoinInput() {
    return elements.coinsInput ? parseCoinsText(elements.coinsInput.value) : { ok: false, error: "Coins field is missing." };
  }

  function refreshButtons() {
    var coinState = state.loaded ? getCurrentCoinInput() : { ok: false };
    var enabled = state.loaded && coinState.ok;
    if (elements.completeCupsButton) {
      elements.completeCupsButton.disabled = !enabled;
    }
    if (elements.gearImportButton) {
      elements.gearImportButton.disabled = !state.loaded;
    }
    if (elements.haveAllButton) {
      elements.haveAllButton.disabled = !enabled;
    }
    if (elements.exportButton) {
      elements.exportButton.disabled = !enabled;
    }
    if (elements.coinsInput) {
      elements.coinsInput.disabled = !state.loaded;
    }
  }

  function syncStateFromBytes(bytes) {
    var context = loadEditable(bytes);
    validateSupportedContext(context);
    state.workingBytes = saveToBytes(context.save);
    state.entryCount = context.save.entryCount;
    state.charBlockCount = context.charBlocks.length;
    state.coinValue = entryReadU32(context.coinEntry, 0);
    if (elements.coinsInput) {
      elements.coinsInput.value = String(state.coinValue);
    }
  }

  function runUiTransaction(patcher, successMessage, unchangedMessage) {
    if (!state.loaded || !state.workingBytes) {
      setStatus("Import a save first.", "error");
      return false;
    }

    var coinState = getCurrentCoinInput();
    if (!coinState.ok) {
      setStatus(coinState.error, "error");
      refreshButtons();
      return false;
    }

    try {
      var patchMeta = {};
      var result = runPatch(state.workingBytes, function (context) {
        var changed = applyCoinsToSave(context.save, coinState.value);
        var patchResult = patcher(context);
        if (patchResult && typeof patchResult === "object") {
          patchMeta = patchResult;
          changed = !!patchResult.changed || changed;
        } else {
          changed = !!patchResult || changed;
        }
        return changed;
      });
      state.workingBytes = result.bytes;
      state.entryCount = result.info.entryCount;
      state.charBlockCount = result.info.charBlockCount;
      state.coinValue = result.info.coins;
      state.dirty = state.dirty || result.changed;
      if (elements.coinsInput) {
        elements.coinsInput.value = String(state.coinValue);
      }
      refreshButtons();
      setStatus(
        result.changed
          ? (typeof successMessage === "function" ? successMessage(patchMeta) : successMessage)
          : (typeof unchangedMessage === "function" ? unchangedMessage(patchMeta) : unchangedMessage),
        result.changed ? "success" : "warning"
      );
      return true;
    } catch (error) {
      setStatus(error && error.message ? error.message : "Patch failed.", "error");
      refreshButtons();
      return false;
    }
  }

  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var anchor = elements.downloadAnchor || documentRef.createElement("a");
    anchor.href = url;
    anchor.download = filename || FALLBACK_FILENAME;
    if (!anchor.parentNode && documentRef.body) {
      documentRef.body.appendChild(anchor);
    }
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleLoadedSaveBytes(bytes, filename) {
    try {
      state.loaded = true;
      state.fileName = filename && filename.length ? filename : FALLBACK_FILENAME;
      state.sourceBytes = cloneBytes(bytes);
      state.dirty = false;
      syncStateFromBytes(bytes);
      refreshButtons();
      setStatus("Save loaded.", "success");
    } catch (error) {
      state.loaded = false;
      state.fileName = FALLBACK_FILENAME;
      state.sourceBytes = null;
      state.workingBytes = null;
      state.dirty = false;
      if (elements.coinsInput) {
        elements.coinsInput.value = "";
      }
      refreshButtons();
      setStatus(error && error.message ? error.message : "Load failed.", "error");
    }
  }

  function onLoadClick() {
    if (elements.fileInput) {
      elements.fileInput.click();
    }
  }

  function onFilePicked(event) {
    var file = event && event.target && event.target.files ? event.target.files[0] : null;
    if (!file) {
      return;
    }

    file.arrayBuffer().then(function (buffer) {
      handleLoadedSaveBytes(new Uint8Array(buffer), file.name);
    }).catch(function () {
      setStatus("Failed to read file.", "error");
    }).finally(function () {
      if (elements.fileInput) {
        elements.fileInput.value = "";
      }
    });
  }

  function onGearImportClick() {
    if (!state.loaded) {
      setStatus("Import a save before importing a gear preset.", "warning");
      return;
    }
    if (elements.gearInput) {
      elements.gearInput.click();
    }
  }

  function onGearPresetPicked(event) {
    var file = event && event.target && event.target.files ? event.target.files[0] : null;
    if (!file) {
      return;
    }

    if (!state.loaded) {
      setStatus("Import a save before importing a gear preset.", "warning");
      if (elements.gearInput) {
        elements.gearInput.value = "";
      }
      return;
    }

    file.text().then(function (xmlText) {
      var parsed = parseGearPresetXml(xmlText);
      if (!parsed.ok) {
        setStatus(parsed.error, "error");
        return;
      }

      runUiTransaction(
        function (context) {
          return applyGearPresetToSave(context, parsed.value);
        },
        function (meta) {
          return "Gear preset applied: " + meta.characterCount + " characters. Export Save to download the patched file.";
        },
        function (meta) {
          return "Gear preset already matched the save: " + meta.characterCount + " characters.";
        }
      );
    }).catch(function () {
      setStatus("Gear preset import failed: unable to read file.", "error");
    }).finally(function () {
      if (elements.gearInput) {
        elements.gearInput.value = "";
      }
    });
  }

  function onCoinInput() {
    if (!state.loaded) {
      return;
    }
    state.dirty = true;
    refreshButtons();
    var coinState = getCurrentCoinInput();
    if (!coinState.ok) {
      setStatus(coinState.error, "error");
    } else {
      setStatus("Coins updated. Export Save to download the patched file.", "warning");
    }
  }

  function onCompleteCupsClick() {
    runUiTransaction(function (context) {
      return setCupsCompletedAndBushidoUnlocked(context.save);
    }, "Cups completed and Bushido Gear unlocked.", "Cups and Bushido Gear already unlocked/completed.");
  }

  function onHaveAllClick() {
    runUiTransaction(function (context) {
      var changed = setAllGearOwnedForAllCharacters(context);
      changed = setCupsCompletedAndBushidoUnlocked(context.save) || changed;
      return changed;
    }, "All Gear applied and Bushido Gear unlocked.", "Already have All Gear unlocked.");
  }

  function onExportClick() {
    if (!state.loaded || !state.workingBytes) {
      setStatus("Import a save first.", "error");
      return;
    }

    var coinState = getCurrentCoinInput();
    if (!coinState.ok) {
      setStatus(coinState.error, "error");
      refreshButtons();
      return;
    }

    try {
      var result = runPatch(state.workingBytes, function (context) {
        return applyCoinsToSave(context.save, coinState.value);
      });
      state.workingBytes = result.bytes;
      state.entryCount = result.info.entryCount;
      state.charBlockCount = result.info.charBlockCount;
      state.coinValue = result.info.coins;
      if (elements.coinsInput) {
        elements.coinsInput.value = String(state.coinValue);
      }
      refreshButtons();
      downloadBytes(state.workingBytes, state.fileName || FALLBACK_FILENAME);
      setStatus("Patched save exported.", "success");
    } catch (error) {
      setStatus(error && error.message ? error.message : "Export failed.", "error");
      refreshButtons();
    }
  }

  function boot() {
    refreshButtons();

    if (elements.loadButton) {
      elements.loadButton.addEventListener("click", onLoadClick);
    }
    if (elements.fileInput) {
      elements.fileInput.addEventListener("change", onFilePicked);
    }
    if (elements.gearImportButton) {
      elements.gearImportButton.addEventListener("click", onGearImportClick);
    }
    if (elements.gearInput) {
      elements.gearInput.addEventListener("change", onGearPresetPicked);
    }
    if (elements.coinsInput) {
      elements.coinsInput.addEventListener("input", onCoinInput);
    }
    if (elements.completeCupsButton) {
      elements.completeCupsButton.addEventListener("click", onCompleteCupsClick);
    }
    if (elements.haveAllButton) {
      elements.haveAllButton.addEventListener("click", onHaveAllClick);
    }
    if (elements.exportButton) {
      elements.exportButton.addEventListener("click", onExportClick);
    }
  }

  root.MsblSaveEditorCore = {
    parseSave: parseSave,
    saveToBytes: saveToBytes,
    inspectBytes: inspectBytes,
    parseCoinsText: parseCoinsText,
    parseGearPresetXml: parseGearPresetXml,
    patchCoins: patchCoins,
    patchCompleteCups: patchCompleteCups,
    patchHaveAllGear: patchHaveAllGear,
    patchGearPreset: patchGearPreset,
    countUnownedGear: countUnownedGear,
    getCupStatus: getCupStatus
  };

  if (!documentRef) {
    return;
  }

  if (documentRef.readyState === "loading") {
    documentRef.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
