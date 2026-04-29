(function () {
  "use strict";

  var REGION_LABELS = {
    R4QP: "PAL",
    R4QE: "NTSC-U",
    R4QJ: "NTSC-J",
    R4QK: "NTSC-K"
  };
  var FALLBACK_ONLINE_FILENAME = "Online";
  var FRIEND_TYPE_BUDDY = 0x00003800;
  var FRIEND_TYPE_PROFILE_ID = 0x00001800;
  var FRIEND_TYPE_FRIEND_KEY = 0x00001000;
  var VALID_FRIEND_TYPES = {
    0x00003800: true,
    0x00001800: true,
    0x00001000: true
  };
  var HEADER_CRC_OFFSET = 0x04;
  var HEADER_CRC_START = 0x08;
  var FRIEND_DATA_OFFSET = 0x1c;
  var FRIEND_NAME_OFFSET = 0x31c;
  var FRIEND_NAME_WRITE_LIMIT = 0xa20;
  var PROFILE_NAME_OFFSETS = [0xa84, 0xa9c];
  var DWC_USER_DATA_SIZE = 0x40;
  var DWC_USER_DATA_PROFILE_ID_OFFSET = 0x1c;
  var DWC_USER_DATA_GAME_ID_OFFSET = 0x24;
  var FRIEND_RECORD_SIZE = 12;
  var MAX_FRIEND_RECORDS = (FRIEND_NAME_OFFSET - FRIEND_DATA_OFFSET) / FRIEND_RECORD_SIZE;
  var NAME_SCAN_LIMIT = 0x800;
  var UINT32_SIZE = 0x100000000;

  var state = {
    profiles: [],
    selectedProfileIndex: 0,
    profileMenuOpen: false,
    addPopupOpen: false,
    deletePopupOpen: false,
    fileName: FALLBACK_ONLINE_FILENAME,
    sourceBytes: null,
    workingBytes: null,
    dirty: false
  };

  var elements = {
    panel: document.querySelector(".save-editor-panel"),
    modeButtons: document.querySelectorAll("[data-editor-mode-target]"),
    actionGroups: document.querySelectorAll("[data-editor-actions]"),
    modePanels: document.querySelectorAll("[data-editor-view]"),
    loadButton: document.getElementById("online-editor-load"),
    addButton: document.getElementById("online-editor-add"),
    deleteButton: document.getElementById("online-editor-delete"),
    exportButton: document.getElementById("online-editor-export"),
    fileInput: document.getElementById("online-editor-file-input"),
    downloadAnchor: document.getElementById("online-editor-download"),
    profileLabel: document.getElementById("online-editor-profile-label"),
    profileTrigger: document.getElementById("online-editor-profile-trigger"),
    profileTriggerName: document.getElementById("online-editor-profile-trigger-name"),
    profileTriggerMeta: document.getElementById("online-editor-profile-trigger-meta"),
    profileMenu: document.getElementById("online-editor-profile-menu"),
    profileSelect: document.getElementById("online-editor-profile"),
    results: document.getElementById("online-editor-results"),
    status: document.getElementById("online-editor-status"),
    addPopup: document.getElementById("online-editor-add-popup"),
    addBackdrop: document.getElementById("online-editor-add-backdrop"),
    addCloseButton: document.getElementById("online-editor-add-close"),
    addCancelButton: document.getElementById("online-editor-add-cancel"),
    addForm: document.getElementById("online-editor-add-form"),
    friendCodeInput: document.getElementById("online-editor-friend-code"),
    addError: document.getElementById("online-editor-add-error"),
    deletePopup: document.getElementById("online-editor-delete-popup"),
    deleteBackdrop: document.getElementById("online-editor-delete-backdrop"),
    deleteCloseButton: document.getElementById("online-editor-delete-close"),
    deleteCancelButton: document.getElementById("online-editor-delete-cancel"),
    deleteForm: document.getElementById("online-editor-delete-form"),
    deleteList: document.getElementById("online-editor-delete-list"),
    deleteError: document.getElementById("online-editor-delete-error")
  };

  function readU16BE(bytes, offset) {
    return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
  }

  function readU32BE(bytes, offset) {
    return (
      ((bytes[offset] << 24) >>> 0) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    ) >>> 0;
  }

  function writeU32BE(bytes, offset, value) {
    var normalized = value >>> 0;
    bytes[offset] = (normalized >>> 24) & 0xff;
    bytes[offset + 1] = (normalized >>> 16) & 0xff;
    bytes[offset + 2] = (normalized >>> 8) & 0xff;
    bytes[offset + 3] = normalized & 0xff;
  }

  function writeU16BE(bytes, offset, value) {
    var normalized = value >>> 0;
    bytes[offset] = (normalized >>> 8) & 0xff;
    bytes[offset + 1] = normalized & 0xff;
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function setProfileMenuOpen(isOpen) {
    state.profileMenuOpen = !!isOpen;

    if (elements.profileMenu) {
      elements.profileMenu.hidden = !state.profileMenuOpen;
    }
    if (elements.profileTrigger) {
      elements.profileTrigger.setAttribute("aria-expanded", state.profileMenuOpen ? "true" : "false");
    }
  }

  function refreshActionButtons() {
    var hasOnlineFile = !!(state.workingBytes && state.profiles.length);
    var profile = state.profiles[state.selectedProfileIndex];

    if (elements.addButton) {
      elements.addButton.disabled = !hasOnlineFile;
    }
    if (elements.deleteButton) {
      elements.deleteButton.disabled = !(hasOnlineFile && profile && profile.players.length);
    }
    if (elements.exportButton) {
      elements.exportButton.disabled = !(hasOnlineFile && state.dirty);
    }
  }

  function refreshPopupBodyState() {
    document.body.classList.toggle("popup-open", state.addPopupOpen || state.deletePopupOpen);
  }

  function setAddError(message) {
    if (elements.addError) {
      elements.addError.textContent = message || "";
    }
  }

  function setDeleteError(message) {
    if (elements.deleteError) {
      elements.deleteError.textContent = message || "";
    }
  }

  function setAddPopupOpen(isOpen) {
    if (isOpen && state.deletePopupOpen) {
      setDeletePopupOpen(false);
    }

    state.addPopupOpen = !!isOpen;

    if (elements.addPopup) {
      elements.addPopup.hidden = !state.addPopupOpen;
      elements.addPopup.setAttribute("aria-hidden", state.addPopupOpen ? "false" : "true");
    }

    refreshPopupBodyState();

    if (state.addPopupOpen) {
      setAddError("");
      if (elements.friendCodeInput) {
        elements.friendCodeInput.value = "";
        window.setTimeout(function focusFriendCodeInput() {
          elements.friendCodeInput.focus();
        }, 0);
      }
    }
  }

  function setDeletePopupOpen(isOpen) {
    if (isOpen && state.addPopupOpen) {
      setAddPopupOpen(false);
    }

    state.deletePopupOpen = !!isOpen;

    if (elements.deletePopup) {
      elements.deletePopup.hidden = !state.deletePopupOpen;
      elements.deletePopup.setAttribute("aria-hidden", state.deletePopupOpen ? "false" : "true");
    }

    refreshPopupBodyState();

    if (state.deletePopupOpen) {
      setDeleteError("");
      renderDeleteList();
      window.setTimeout(function focusDeleteCheckbox() {
        var firstCheckbox = elements.deleteList ? elements.deleteList.querySelector("input[type='checkbox']") : null;
        if (firstCheckbox) {
          firstCheckbox.focus();
        }
      }, 0);
    }
  }

  function setMode(mode) {
    var activeMode = mode === "friendlist" ? "friendlist" : "save";

    if (elements.panel) {
      elements.panel.setAttribute("data-editor-mode", activeMode);
    }

    for (var i = 0; i < elements.modeButtons.length; i += 1) {
      var button = elements.modeButtons[i];
      var isActive = button.getAttribute("data-editor-mode-target") === activeMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    }

    for (var a = 0; a < elements.actionGroups.length; a += 1) {
      var actions = elements.actionGroups[a];
      var showActions = actions.getAttribute("data-editor-actions") === activeMode;
      actions.hidden = !showActions;
      actions.classList.toggle("is-active", showActions);
    }

    for (var p = 0; p < elements.modePanels.length; p += 1) {
      var panel = elements.modePanels[p];
      var showPanel = panel.getAttribute("data-editor-view") === activeMode;
      panel.hidden = !showPanel;
      panel.classList.toggle("is-active", showPanel);
    }
  }

  function findProfileHeaders(bytes) {
    var headers = [];
    for (var offset = 0; offset <= bytes.length - 4; offset += 1) {
      var gameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      if (REGION_LABELS[gameId]) {
        headers.push({
          offset: offset,
          gameId: gameId,
          region: REGION_LABELS[gameId]
        });
      }
    }
    return headers;
  }

  function readGameId(bytes, offset) {
    if (!bytes || offset < 0 || offset + 4 > bytes.length) {
      return "";
    }
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }

  function isValidFriendType(value) {
    return !!VALID_FRIEND_TYPES[value >>> 0];
  }

  function parseFriendRecords(bytes, blockStart, blockEnd) {
    var records = [];
    var offset = blockStart + FRIEND_DATA_OFFSET;
    var maxOffset = Math.min(blockEnd, bytes.length);

    for (var count = 0; count < MAX_FRIEND_RECORDS && offset + FRIEND_RECORD_SIZE <= maxOffset; count += 1) {
      var word0 = readU32BE(bytes, offset);
      var word1 = readU32BE(bytes, offset + 4);
      var word2 = readU32BE(bytes, offset + 8);

      if (word0 === 0 && word1 === 0 && word2 === 0) {
        break;
      }

      if (!isValidFriendType(word0) || word1 === 0) {
        break;
      }

      records.push({
        type: word0,
        profileId: word1,
        checkValue: word2,
        offset: offset
      });
      offset += FRIEND_RECORD_SIZE;
    }

    return records;
  }

  function isAllowedStringCode(code) {
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xffef);
  }

  function hasLetter(value) {
    for (var i = 0; i < value.length; i += 1) {
      var code = value.charCodeAt(i);
      var ch = value.charAt(i);
      if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
        return true;
      }
      if (code >= 0x00c0 && code !== 0x2122) {
        return true;
      }
    }
    return false;
  }

  function isPlayerNameCandidate(value) {
    var text = String(value || "").trim();
    return text.length > 0 && text.length <= 32 && hasLetter(text);
  }

  function isPendingFriendLabel(value) {
    return /^\d{6} \d{6}$/.test(String(value || "").trim());
  }

  function isFriendNameBlockEntry(value) {
    return isPlayerNameCandidate(value) || isPendingFriendLabel(value);
  }

  function readUtf16BEStringAt(bytes, offset, maxChars) {
    if (!bytes || offset < 0 || offset + 1 >= bytes.length) {
      return "";
    }

    var limit = Math.max(1, Number(maxChars) || 0);
    var chars = [];
    for (var i = 0; i < limit && offset + 1 < bytes.length; i += 1, offset += 2) {
      var code = readU16BE(bytes, offset);
      if (code === 0 || !isAllowedStringCode(code)) {
        break;
      }
      chars.push(String.fromCharCode(code));
    }
    return chars.join("").trim();
  }

  function readUtf16BEStrings(bytes, start, end) {
    var strings = [];
    var offset = start;
    var maxOffset = Math.min(end, bytes.length, start + NAME_SCAN_LIMIT);

    while (offset + 1 < maxOffset) {
      var zeroRun = 0;
      while (offset + 1 < maxOffset && readU16BE(bytes, offset) === 0) {
        zeroRun += 1;
        offset += 2;
      }
      if (strings.length > 0 && zeroRun >= 8) {
        break;
      }

      var chars = [];
      while (offset + 1 < maxOffset) {
        var code = readU16BE(bytes, offset);
        if (code === 0) {
          break;
        }
        if (!isAllowedStringCode(code)) {
          chars = [];
          break;
        }
        chars.push(String.fromCharCode(code));
        offset += 2;
      }

      var value = chars.join("").trim();
      if (isPlayerNameCandidate(value)) {
        strings.push(value);
      }

      offset += 2;
    }

    return strings;
  }

  function readFriendNameEntries(bytes, start, end) {
    var entries = [];
    var offset = start;
    var maxOffset = Math.min(end, bytes.length, start + NAME_SCAN_LIMIT);

    while (offset + 1 < maxOffset) {
      var zeroRun = 0;
      while (offset + 1 < maxOffset && readU16BE(bytes, offset) === 0) {
        zeroRun += 1;
        offset += 2;
      }
      if (entries.length > 0 && zeroRun >= 8) {
        break;
      }

      var stringOffset = offset;
      var chars = [];
      while (offset + 1 < maxOffset) {
        var code = readU16BE(bytes, offset);
        if (code === 0) {
          break;
        }
        if (!isAllowedStringCode(code)) {
          chars = [];
          break;
        }
        chars.push(String.fromCharCode(code));
        offset += 2;
      }

      var value = chars.join("").trim();
      if (isFriendNameBlockEntry(value)) {
        entries.push({
          value: value,
          offset: stringOffset,
          endOffset: offset + 2
        });
      }

      offset += 2;
    }

    return entries;
  }

  function writeUtf16BEStringAt(bytes, offset, value) {
    var text = String(value || "");
    for (var i = 0; i < text.length; i += 1) {
      writeU16BE(bytes, offset + i * 2, text.charCodeAt(i));
    }
    writeU16BE(bytes, offset + text.length * 2, 0);
  }

  function formatPendingFriendLabel(friendCode) {
    var digits = String(friendCode || "").replace(/\D/g, "");
    return digits.length === 12 ? digits.slice(0, 6) + " " + digits.slice(6) : "";
  }

  function findFriendNameAppendOffset(bytes, profile) {
    var start = profile.offset + FRIEND_NAME_OFFSET;
    var maxOffset = Math.min(profile.endOffset, bytes.length, profile.offset + FRIEND_NAME_WRITE_LIMIT);
    var offset = start;
    var appendOffset = start;

    while (offset + 1 < maxOffset) {
      var zeroRun = 0;
      while (offset + 1 < maxOffset && readU16BE(bytes, offset) === 0) {
        zeroRun += 1;
        offset += 2;
      }
      if (zeroRun >= 8) {
        return appendOffset;
      }

      var sawChars = false;
      while (offset + 1 < maxOffset) {
        var code = readU16BE(bytes, offset);
        if (code === 0) {
          break;
        }
        if (!isAllowedStringCode(code)) {
          return null;
        }
        sawChars = true;
        offset += 2;
      }

      if (!sawChars || offset + 1 >= maxOffset) {
        return null;
      }

      appendOffset = offset + 2;
      offset += 2;
    }

    return null;
  }

  function writePendingFriendLabel(bytes, profile, friendCode) {
    var label = formatPendingFriendLabel(friendCode);
    var offset = findFriendNameAppendOffset(bytes, profile);
    var requiredBytes = (label.length + 1) * 2;
    var maxOffset = Math.min(profile.endOffset, bytes.length, profile.offset + FRIEND_NAME_WRITE_LIMIT);

    if (!label || offset === null || offset + requiredBytes > maxOffset) {
      return false;
    }

    writeUtf16BEStringAt(bytes, offset, label);
    return true;
  }

  function readProfileName(bytes, blockStart) {
    for (var i = 0; i < PROFILE_NAME_OFFSETS.length; i += 1) {
      var value = readUtf16BEStringAt(bytes, blockStart + PROFILE_NAME_OFFSETS[i], 16);
      if (isPlayerNameCandidate(value)) {
        return value;
      }
    }
    return "";
  }

  function readOwnProfileId(bytes, headerOffset) {
    var userDataOffset = headerOffset - DWC_USER_DATA_GAME_ID_OFFSET;
    if (!bytes || userDataOffset < 0 || userDataOffset + DWC_USER_DATA_SIZE > bytes.length) {
      return 0;
    }
    if (readU32BE(bytes, userDataOffset) !== DWC_USER_DATA_SIZE) {
      return 0;
    }
    return readU32BE(bytes, userDataOffset + DWC_USER_DATA_PROFILE_ID_OFFSET);
  }

  function calculateFriendKeyCheck(profileId, gameId) {
    var reversedGameId = gameId.split("").reverse().join("");
    var input = [
      profileId & 0xff,
      (profileId >>> 8) & 0xff,
      (profileId >>> 16) & 0xff,
      (profileId >>> 24) & 0xff,
      reversedGameId.charCodeAt(0),
      reversedGameId.charCodeAt(1),
      reversedGameId.charCodeAt(2),
      reversedGameId.charCodeAt(3)
    ];
    return crc8(input) & 0x7f;
  }

  function formatFriendKeyFromParts(profileId, checkValue) {
    var raw = String((checkValue >>> 0) * UINT32_SIZE + (profileId >>> 0)).padStart(12, "0");
    return raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8);
  }

  function formatFriendCode(profileId, gameId) {
    return formatFriendKeyFromParts(profileId, calculateFriendKeyCheck(profileId, gameId));
  }

  function parseProfile(bytes, header, endOffset, index) {
    var friends = parseFriendRecords(bytes, header.offset, endOffset);
    var nameEntries = readFriendNameEntries(bytes, header.offset + FRIEND_NAME_OFFSET, endOffset);
    var profileName = readProfileName(bytes, header.offset);
    var ownProfileId = readOwnProfileId(bytes, header.offset);
    var ownFriendCode = ownProfileId ? formatFriendCode(ownProfileId, header.gameId) : "";
    var players = [];

    for (var i = 0; i < friends.length; i += 1) {
      var nameEntry = nameEntries[i] || null;
      var storedLabel = nameEntry ? nameEntry.value : "";
      var name = storedLabel && !isPendingFriendLabel(storedLabel)
        ? storedLabel
        : (friends[i].type === FRIEND_TYPE_FRIEND_KEY ? "Pending Friend" : "Player " + (i + 1));
      players.push({
        name: name,
        storedLabel: storedLabel,
        nameOffset: nameEntry ? nameEntry.offset : null,
        nameEndOffset: nameEntry ? nameEntry.endOffset : null,
        type: friends[i].type,
        profileId: friends[i].profileId,
        checkValue: friends[i].checkValue,
        recordOffset: friends[i].offset,
        friendCode: friends[i].type === FRIEND_TYPE_FRIEND_KEY
          ? formatFriendKeyFromParts(friends[i].profileId, friends[i].checkValue)
          : formatFriendCode(friends[i].profileId, header.gameId)
      });
    }

    return {
      index: index,
      gameId: header.gameId,
      region: header.region,
      offset: header.offset,
      endOffset: endOffset,
      ownProfileId: ownProfileId,
      ownFriendCode: ownFriendCode,
      profileName: profileName || "Profile " + index,
      players: players
    };
  }

  function parseOnlineFile(bytes) {
    if (!bytes || bytes.length === 0) {
      return { ok: false, error: "Online file is empty." };
    }

    var headers = findProfileHeaders(bytes);
    if (!headers.length) {
      return { ok: false, error: "no valid profiles found" };
    }

    var profiles = [];
    for (var i = 0; i < headers.length; i += 1) {
      var endOffset = i + 1 < headers.length ? headers[i + 1].offset : bytes.length;
      if (headers[i].offset + FRIEND_DATA_OFFSET + 8 > endOffset) {
        continue;
      }
      profiles.push(parseProfile(bytes, headers[i], endOffset, profiles.length + 1));
    }

    if (!profiles.length) {
      return { ok: false, error: "no valid profiles found" };
    }

    return { ok: true, profiles: profiles };
  }

  function renderProfileOptions() {
    if (!elements.profileSelect || !elements.profileMenu || !elements.profileTriggerName || !elements.profileTriggerMeta || !elements.profileTrigger) {
      return;
    }

    if (!state.profiles.length) {
      elements.profileSelect.innerHTML = '<option value="">Load an Online file first</option>';
      elements.profileSelect.disabled = true;
      elements.profileTrigger.disabled = true;
      elements.profileTriggerName.textContent = "Load an Online file first";
      elements.profileTriggerMeta.textContent = "";
      elements.profileMenu.innerHTML = "";
      setProfileMenuOpen(false);
      return;
    }

    var html = [];
    for (var i = 0; i < state.profiles.length; i += 1) {
      var profile = state.profiles[i];
      var selected = i === state.selectedProfileIndex ? " selected" : "";
      var ownCodeLabel = profile.ownFriendCode || "Friend Code unavailable";
      html.push(
        '<option value="' + i + '"' + selected + ">" + escapeHtml(profile.profileName) +
        " (" + escapeHtml(ownCodeLabel) + ")</option>"
      );
    }
    elements.profileSelect.innerHTML = html.join("");
    elements.profileSelect.disabled = false;
    elements.profileTrigger.disabled = false;
    updateProfileTrigger();
    renderProfileMenu();
  }

  function updateProfileTrigger() {
    if (!elements.profileTriggerName || !elements.profileTriggerMeta) {
      return;
    }

    var profile = state.profiles[state.selectedProfileIndex];
    if (!profile) {
      elements.profileTriggerName.textContent = "Load an Online file first";
      elements.profileTriggerMeta.textContent = "";
      return;
    }

    elements.profileTriggerName.textContent = profile.profileName;
    elements.profileTriggerMeta.textContent = "(" + (profile.ownFriendCode || "Friend Code unavailable") + ")";
  }

  function renderProfileMenu() {
    if (!elements.profileMenu) {
      return;
    }

    if (!state.profiles.length) {
      elements.profileMenu.innerHTML = "";
      return;
    }

    var html = [];
    for (var i = 0; i < state.profiles.length; i += 1) {
      var profile = state.profiles[i];
      var selectedClass = i === state.selectedProfileIndex ? " is-selected" : "";
      var ownCodeLabel = profile.ownFriendCode || "Friend Code unavailable";
      html.push(
        '<button class="online-editor-profile-option' + selectedClass + '" data-profile-index="' + i + '" type="button" role="option" aria-selected="' + (i === state.selectedProfileIndex ? "true" : "false") + '">' +
        '<span class="online-editor-profile-option-name">' + escapeHtml(profile.profileName) + "</span>" +
        '<span class="online-editor-profile-option-meta">(' + escapeHtml(ownCodeLabel) + ')</span>' +
        "</button>"
      );
    }
    elements.profileMenu.innerHTML = html.join("");
  }

  function renderProfileLabel() {
    if (!elements.profileLabel) {
      return;
    }

    var profile = state.profiles[state.selectedProfileIndex];
    if (!profile) {
      elements.profileLabel.textContent = "PROFILE";
      return;
    }

    elements.profileLabel.textContent = "PROFILE (" + profile.region + ")";
  }

  function renderSelectedProfile() {
    if (!elements.results) {
      return;
    }

    var profile = state.profiles[state.selectedProfileIndex];
    if (!profile) {
      renderProfileLabel();
      elements.results.innerHTML = '<p class="online-editor-empty">No Online file loaded.</p>';
      return;
    }

    renderProfileLabel();

    if (!profile.players.length) {
      elements.results.innerHTML = '<p class="online-editor-empty">This profile has no friends.</p>';
      return;
    }

    var rows = [];
    for (var i = 0; i < profile.players.length; i += 1) {
      rows.push(
        '<tr class="online-editor-separator-row" aria-hidden="true">' +
        '<td colspan="2"><span class="online-editor-row-separator"></span></td>' +
        "</tr>"
      );

      var player = profile.players[i];
      rows.push(
        "<tr>" +
        '<td><span class="online-editor-roster-name">' + escapeHtml(player.name) + "</span></td>" +
        '<td><span class="online-editor-roster-code">' + escapeHtml(player.friendCode) + "</span></td>" +
        "</tr>"
      );
    }

    elements.results.innerHTML = [
      '<table class="online-editor-table">',
      '<thead><tr><th><span class="online-editor-roster-name"><span class="online-editor-roster-header-muted">Friend Roster </span><span class="online-editor-roster-count">' + profile.players.length + '</span><span class="online-editor-roster-header-muted">/' + MAX_FRIEND_RECORDS + '</span></span></th><th><span class="online-editor-roster-code online-editor-roster-header-muted">Friend Code</span></th></tr></thead>',
      "<tbody>",
      rows.join(""),
      "</tbody>",
      "</table>"
    ].join("");
  }

  function renderDeleteList() {
    if (!elements.deleteList) {
      return;
    }

    var profile = state.profiles[state.selectedProfileIndex];
    if (!profile || !profile.players.length) {
      elements.deleteList.innerHTML = '<p class="online-editor-empty">This profile has no friends.</p>';
      return;
    }

    var rows = [];
    for (var i = 0; i < profile.players.length; i += 1) {
      var player = profile.players[i];
      rows.push(
        '<label class="online-editor-delete-row">' +
        '<input class="online-editor-delete-checkbox" type="checkbox" name="online-editor-delete-entry" value="' + i + '">' +
        '<span class="online-editor-delete-name">' + escapeHtml(player.name) + "</span>" +
        '<span class="online-editor-delete-code">' + escapeHtml(player.friendCode) + "</span>" +
        "</label>"
      );
    }

    elements.deleteList.innerHTML = rows.join("");
  }

  function applyParsedProfiles(parsed, selectedIndex) {
    state.profiles = parsed.profiles;
    state.selectedProfileIndex = Math.min(Math.max(Number(selectedIndex) || 0, 0), state.profiles.length - 1);
    renderProfileOptions();
    renderProfileLabel();
    renderSelectedProfile();
    refreshActionButtons();
  }

  function resetLoadedOnlineFile() {
    state.profiles = [];
    state.selectedProfileIndex = 0;
    state.fileName = FALLBACK_ONLINE_FILENAME;
    state.sourceBytes = null;
    state.workingBytes = null;
    state.dirty = false;
    renderProfileOptions();
    renderProfileLabel();
    renderSelectedProfile();
    refreshActionButtons();
  }

  function handleParsedFile(parsed, bytes, fileName) {
    if (!parsed.ok) {
      resetLoadedOnlineFile();
      setStatus(parsed.error, "error");
      return;
    }

    state.fileName = fileName || FALLBACK_ONLINE_FILENAME;
    state.sourceBytes = new Uint8Array(bytes);
    state.workingBytes = new Uint8Array(bytes);
    state.dirty = false;
    applyParsedProfiles(parsed, 0);
    setStatus("Online file loaded.", "success");
  }

  function onOnlineFilePicked(event) {
    var file = event && event.target && event.target.files ? event.target.files[0] : null;
    if (!file) {
      return;
    }

    file.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      handleParsedFile(parseOnlineFile(bytes), bytes, file.name || FALLBACK_ONLINE_FILENAME);
    }).catch(function () {
      handleParsedFile({ ok: false, error: "Failed to read Online file." }, null, null);
    }).finally(function () {
      if (elements.fileInput) {
        elements.fileInput.value = "";
      }
    });
  }

  function onProfileChange() {
    var value = elements.profileSelect ? Number(elements.profileSelect.value) : 0;
    state.selectedProfileIndex = Number.isInteger(value) && value >= 0 ? value : 0;
    updateProfileTrigger();
    renderProfileMenu();
    renderSelectedProfile();
    refreshActionButtons();
  }

  function parseFriendCodeInput(rawValue, profile) {
    var raw = String(rawValue || "").trim();
    var acceptedFormat = /^(\d{4}-\d{4}-\d{4}|\d{12}|\d{6} \d{6})$/;

    if (!raw) {
      return { ok: false, error: "Enter a friend code." };
    }
    if (/[A-Za-z]/.test(raw)) {
      return { ok: false, error: "Friend codes can only contain numbers." };
    }

    var digits = raw.replace(/[- ]/g, "");
    if (digits.length !== 12) {
      return { ok: false, error: "Friend code must contain exactly 12 numbers." };
    }
    if (!acceptedFormat.test(raw)) {
      return { ok: false, error: "Use 1234-5678-9012, 123456789012, or 123456 789012." };
    }

    var friendKey = BigInt(digits);
    if (friendKey === 0n) {
      return { ok: false, error: "Friend code is invalid." };
    }

    var profileId = Number(friendKey & 0xffffffffn) >>> 0;
    var checkValue = Number(friendKey >> 32n) >>> 0;
    var expectedCheckValue = calculateFriendKeyCheck(profileId, profile.gameId);
    if (checkValue !== expectedCheckValue) {
      return { ok: false, error: "Friend code checksum does not match " + profile.region + "." };
    }

    return {
      ok: true,
      profileId: profileId,
      checkValue: checkValue,
      friendCode: formatFriendKeyFromParts(profileId, checkValue)
    };
  }

  function parseFriendCodeBatchInput(rawValue, profile) {
    var lines = String(rawValue || "").split(/\r?\n/);
    var entries = [];
    var seenBatchProfileIds = new Set();
    var skipped = {
      own: 0,
      existing: 0,
      duplicate: 0
    };
    var nonEmptyLineCount = 0;

    for (var i = 0; i < lines.length; i += 1) {
      var rawLine = String(lines[i] || "").trim();
      var parsed;

      if (!rawLine) {
        continue;
      }

      nonEmptyLineCount += 1;
      parsed = parseFriendCodeInput(rawLine, profile);
      if (!parsed.ok) {
        return { ok: false, error: "Line " + (i + 1) + ": " + parsed.error };
      }

      if (profile.ownProfileId && parsed.profileId === profile.ownProfileId) {
        skipped.own += 1;
        continue;
      }
      if (profileHasFriend(profile, parsed.profileId)) {
        skipped.existing += 1;
        continue;
      }
      if (seenBatchProfileIds.has(parsed.profileId)) {
        skipped.duplicate += 1;
        continue;
      }

      seenBatchProfileIds.add(parsed.profileId);
      entries.push(parsed);
    }

    if (!nonEmptyLineCount) {
      return { ok: false, error: "Enter at least one friend code." };
    }

    return {
      ok: true,
      entries: entries,
      skipped: skipped
    };
  }

  function getSkippedFriendCodeCount(skipped) {
    return skipped.own + skipped.existing + skipped.duplicate;
  }

  function buildSkippedFriendCodeDetails(skipped) {
    var parts = [];

    if (skipped.own) {
      parts.push(skipped.own + " own");
    }
    if (skipped.existing) {
      parts.push(skipped.existing + " already present");
    }
    if (skipped.duplicate) {
      parts.push(skipped.duplicate + " duplicate in batch");
    }

    return parts.join(", ");
  }

  function buildBatchAddStatus(addedCount, skipped) {
    var skippedCount = getSkippedFriendCodeCount(skipped);
    var skippedDetails = buildSkippedFriendCodeDetails(skipped);
    var message;

    if (addedCount > 0) {
      message = addedCount + " code" + (addedCount === 1 ? "" : "s") + " added.";
      if (skippedCount > 0) {
        message += " " + skippedCount + " skipped (" + skippedDetails + ").";
      }
      message += " Export Online to save the patched file.";
      return message;
    }

    return "No codes added. " + skippedCount + " skipped (" + skippedDetails + ").";
  }

  function profileHasFriend(profile, profileId) {
    for (var i = 0; i < profile.players.length; i += 1) {
      if ((profile.players[i].profileId >>> 0) === (profileId >>> 0)) {
        return true;
      }
    }
    return false;
  }

  function findFreeFriendSlots(profile, requiredCount) {
    var bytes = state.workingBytes;
    var offset = profile.offset + FRIEND_DATA_OFFSET;
    var maxOffset = Math.min(profile.endOffset, bytes.length, offset + MAX_FRIEND_RECORDS * FRIEND_RECORD_SIZE);
    var offsets = [];
    var foundFreeSlot = false;

    if (!requiredCount) {
      return { ok: true, offsets: offsets };
    }

    for (var count = 0; count < MAX_FRIEND_RECORDS && offset + FRIEND_RECORD_SIZE <= maxOffset; count += 1) {
      var word0 = readU32BE(bytes, offset);
      var word1 = readU32BE(bytes, offset + 4);
      var word2 = readU32BE(bytes, offset + 8);

      if (word0 === 0 && word1 === 0 && word2 === 0) {
        foundFreeSlot = true;
        offsets.push(offset);
        if (offsets.length === requiredCount) {
          return { ok: true, offsets: offsets };
        }
      } else {
        if (foundFreeSlot) {
          return { ok: false, error: "Friend list contains data after a free slot." };
        }
        if (!isValidFriendType(word0) || word1 === 0) {
          return { ok: false, error: "Friend list contains unsupported data before a free slot." };
        }
      }

      offset += FRIEND_RECORD_SIZE;
    }

    return { ok: false, error: "This profile has no free friend slots." };
  }

  function getFriendNameWriteLabel(player) {
    var storedLabel = String(player.storedLabel || "").trim();
    var displayName = String(player.name || "").trim();

    if (storedLabel && isPlayerNameCandidate(storedLabel)) {
      return storedLabel;
    }
    if (player.type === FRIEND_TYPE_FRIEND_KEY) {
      return formatPendingFriendLabel(player.friendCode);
    }
    if (displayName && !/^Player \d+$/.test(displayName) && displayName !== "Pending Friend" && isPlayerNameCandidate(displayName)) {
      return displayName;
    }
    return "";
  }

  function rebuildFriendNameBlock(bytes, profile, players) {
    var start = profile.offset + FRIEND_NAME_OFFSET;
    var maxOffset = Math.min(profile.endOffset, bytes.length, profile.offset + FRIEND_NAME_WRITE_LIMIT);
    var oldEnd = findFriendNameAppendOffset(bytes, profile);
    var labels = [];
    var totalBytes = 0;
    var cursor;
    var clearEnd;
    var i;

    if (oldEnd === null || oldEnd < start || oldEnd > maxOffset) {
      return { ok: false, error: "Friend name block could not be rebuilt." };
    }

    for (i = 0; i < players.length; i += 1) {
      var label = getFriendNameWriteLabel(players[i]);
      if (!label) {
        return { ok: false, error: "Friend name block contains an unsupported player name." };
      }
      labels.push(label);
      totalBytes += (label.length + 1) * 2;
    }

    if (start + totalBytes > maxOffset) {
      return { ok: false, error: "Friend name block is too small for the remaining roster." };
    }

    clearEnd = Math.min(maxOffset, Math.max(oldEnd, start + totalBytes + 16));
    for (i = start; i < clearEnd; i += 1) {
      bytes[i] = 0;
    }

    cursor = start;
    for (i = 0; i < labels.length; i += 1) {
      writeUtf16BEStringAt(bytes, cursor, labels[i]);
      cursor += (labels[i].length + 1) * 2;
    }

    return { ok: true };
  }

  function rewriteFriendRecords(bytes, profile, players) {
    var start = profile.offset + FRIEND_DATA_OFFSET;
    var maxOffset = Math.min(profile.endOffset, bytes.length);
    var offset;
    var i;

    if (start + MAX_FRIEND_RECORDS * FRIEND_RECORD_SIZE > maxOffset) {
      return false;
    }

    for (i = 0; i < MAX_FRIEND_RECORDS; i += 1) {
      offset = start + i * FRIEND_RECORD_SIZE;
      if (i < players.length) {
        writeU32BE(bytes, offset, players[i].type);
        writeU32BE(bytes, offset + 4, players[i].profileId);
        writeU32BE(bytes, offset + 8, players[i].checkValue);
      } else {
        writeU32BE(bytes, offset, 0);
        writeU32BE(bytes, offset + 4, 0);
        writeU32BE(bytes, offset + 8, 0);
      }
    }

    return true;
  }

  function getSelectedDeleteIndices() {
    var indices = [];
    var seen = {};
    var checkboxes = elements.deleteList
      ? elements.deleteList.querySelectorAll("input[name='online-editor-delete-entry']:checked")
      : [];

    for (var i = 0; i < checkboxes.length; i += 1) {
      var index = Number(checkboxes[i].value);
      if (Number.isInteger(index) && index >= 0 && !seen[index]) {
        seen[index] = true;
        indices.push(index);
      }
    }

    indices.sort(function sortNumeric(a, b) {
      return a - b;
    });
    return indices;
  }

  function doPlayersMatch(expectedPlayers, actualPlayers) {
    if (!actualPlayers || actualPlayers.length !== expectedPlayers.length) {
      return false;
    }

    for (var i = 0; i < expectedPlayers.length; i += 1) {
      if (
        (actualPlayers[i].type >>> 0) !== (expectedPlayers[i].type >>> 0) ||
        (actualPlayers[i].profileId >>> 0) !== (expectedPlayers[i].profileId >>> 0) ||
        (actualPlayers[i].checkValue >>> 0) !== (expectedPlayers[i].checkValue >>> 0)
      ) {
        return false;
      }
    }

    return true;
  }

  function deleteFriendCodesFromSelectedProfile(indices) {
    var selectedIndex = state.selectedProfileIndex;
    var profile = state.profiles[selectedIndex];
    var deleteSet = {};
    var remainingPlayers = [];
    var previousBytes;
    var nameResult;
    var parsed;
    var updatedProfile;
    var i;

    if (!state.workingBytes || !profile) {
      return { ok: false, error: "Load an Online file first." };
    }
    if (!indices || !indices.length) {
      return { ok: false, error: "Select at least one friend code." };
    }

    for (i = 0; i < indices.length; i += 1) {
      if (!Number.isInteger(indices[i]) || indices[i] < 0 || indices[i] >= profile.players.length) {
        return { ok: false, error: "Selected friend code is no longer available." };
      }
      deleteSet[indices[i]] = true;
    }

    for (i = 0; i < profile.players.length; i += 1) {
      if (!deleteSet[i]) {
        remainingPlayers.push(profile.players[i]);
      }
    }

    previousBytes = state.workingBytes.slice(0);

    if (!rewriteFriendRecords(state.workingBytes, profile, remainingPlayers)) {
      state.workingBytes.set(previousBytes);
      return { ok: false, error: "Friend roster could not be rewritten safely." };
    }

    nameResult = rebuildFriendNameBlock(state.workingBytes, profile, remainingPlayers);
    if (!nameResult.ok) {
      state.workingBytes.set(previousBytes);
      return nameResult;
    }

    applyHeaderCrc32(state.workingBytes);

    parsed = parseOnlineFile(state.workingBytes);
    if (!parsed.ok || state.workingBytes.length !== previousBytes.length) {
      state.workingBytes.set(previousBytes);
      return { ok: false, error: "Patched Online file could not be parsed." };
    }

    updatedProfile = parsed.profiles[selectedIndex];
    if (!updatedProfile || !doPlayersMatch(remainingPlayers, updatedProfile.players)) {
      state.workingBytes.set(previousBytes);
      return { ok: false, error: "Patched friend roster failed validation." };
    }

    state.dirty = true;
    applyParsedProfiles(parsed, selectedIndex);
    return { ok: true, deletedCount: indices.length };
  }

  function addFriendCodesToSelectedProfile(parsedCodes) {
    var selectedIndex = state.selectedProfileIndex;
    var profile = state.profiles[selectedIndex];
    var slotResult;
    var previousBytes;
    var parsed;
    var i;

    if (!state.workingBytes || !profile) {
      return { ok: false, error: "Load an Online file first." };
    }
    if (!parsedCodes || !parsedCodes.length) {
      return { ok: true, addedCount: 0 };
    }

    if (profile.players.length + parsedCodes.length > MAX_FRIEND_RECORDS) {
      return { ok: false, error: "Adding " + parsedCodes.length + " new codes would exceed " + MAX_FRIEND_RECORDS + " friends for this profile." };
    }

    slotResult = findFreeFriendSlots(profile, parsedCodes.length);
    if (!slotResult.ok) {
      return slotResult;
    }

    previousBytes = state.workingBytes.slice(0);

    for (i = 0; i < parsedCodes.length; i += 1) {
      writeU32BE(state.workingBytes, slotResult.offsets[i], FRIEND_TYPE_FRIEND_KEY);
      writeU32BE(state.workingBytes, slotResult.offsets[i] + 4, parsedCodes[i].profileId);
      writeU32BE(state.workingBytes, slotResult.offsets[i] + 8, parsedCodes[i].checkValue);

      if (!writePendingFriendLabel(state.workingBytes, profile, parsedCodes[i].friendCode)) {
        state.workingBytes.set(previousBytes);
        return { ok: false, error: "This profile has no free friend label slot." };
      }
    }

    applyHeaderCrc32(state.workingBytes);

    parsed = parseOnlineFile(state.workingBytes);
    if (!parsed.ok) {
      state.workingBytes.set(previousBytes);
      return { ok: false, error: "Patched Online file could not be parsed." };
    }

    state.dirty = true;
    applyParsedProfiles(parsed, selectedIndex);
    return { ok: true, addedCount: parsedCodes.length };
  }

  function onAddButtonClick() {
    if (!state.workingBytes || !state.profiles.length) {
      setStatus("Load an Online file first.", "warning");
      return;
    }
    setProfileMenuOpen(false);
    setAddPopupOpen(true);
  }

  function onAddFormSubmit(event) {
    event.preventDefault();

    var profile = state.profiles[state.selectedProfileIndex];
    var parsedBatch;
    var added;
    var skippedCount;
    if (!profile) {
      setAddError("Load an Online file first.");
      return;
    }

    parsedBatch = parseFriendCodeBatchInput(elements.friendCodeInput ? elements.friendCodeInput.value : "", profile);
    if (!parsedBatch.ok) {
      setAddError(parsedBatch.error);
      return;
    }

    if (profile.players.length + parsedBatch.entries.length > MAX_FRIEND_RECORDS) {
      setAddError("Adding " + parsedBatch.entries.length + " new codes would exceed " + MAX_FRIEND_RECORDS + " friends for this profile.");
      return;
    }

    skippedCount = getSkippedFriendCodeCount(parsedBatch.skipped);
    if (!parsedBatch.entries.length) {
      setAddPopupOpen(false);
      setStatus(buildBatchAddStatus(0, parsedBatch.skipped), "warning");
      return;
    }

    added = addFriendCodesToSelectedProfile(parsedBatch.entries);
    if (!added.ok) {
      setAddError(added.error);
      return;
    }

    setAddPopupOpen(false);
    setStatus(buildBatchAddStatus(added.addedCount, parsedBatch.skipped), added.addedCount > 0 ? "success" : (skippedCount > 0 ? "warning" : "success"));
  }

  function onDeleteButtonClick() {
    var profile = state.profiles[state.selectedProfileIndex];

    if (!state.workingBytes || !profile) {
      setStatus("Load an Online file first.", "warning");
      return;
    }
    if (!profile.players.length) {
      setStatus("This profile has no friend codes to delete.", "warning");
      return;
    }

    setProfileMenuOpen(false);
    setDeletePopupOpen(true);
  }

  function onDeleteFormSubmit(event) {
    event.preventDefault();

    var selectedIndices = getSelectedDeleteIndices();
    var result;

    if (!selectedIndices.length) {
      setDeleteError("Select at least one friend code.");
      return;
    }

    result = deleteFriendCodesFromSelectedProfile(selectedIndices);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }

    setDeletePopupOpen(false);
    setStatus(result.deletedCount + " code" + (result.deletedCount === 1 ? "" : "s") + " deleted. Export Online to save the patched file.", "success");
  }

  function onExportOnlineClick() {
    if (!state.workingBytes || !state.dirty) {
      setStatus("Patch Online before exporting Online.", "warning");
      return;
    }

    applyHeaderCrc32(state.workingBytes);
    downloadBytes(state.workingBytes, state.fileName || FALLBACK_ONLINE_FILENAME);
    setStatus("Patched Online file exported.", "success");
  }

  function boot() {
    for (var i = 0; i < elements.modeButtons.length; i += 1) {
      elements.modeButtons[i].addEventListener("click", function onModeClick(event) {
        setMode(event.currentTarget.getAttribute("data-editor-mode-target"));
      });
    }

    if (elements.loadButton && elements.fileInput) {
      elements.loadButton.addEventListener("click", function onLoadClick() {
        elements.fileInput.click();
      });
      elements.fileInput.addEventListener("change", onOnlineFilePicked);
    }

    if (elements.addButton) {
      elements.addButton.addEventListener("click", onAddButtonClick);
    }
    if (elements.deleteButton) {
      elements.deleteButton.addEventListener("click", onDeleteButtonClick);
    }
    if (elements.exportButton) {
      elements.exportButton.addEventListener("click", onExportOnlineClick);
    }
    if (elements.addForm) {
      elements.addForm.addEventListener("submit", onAddFormSubmit);
    }
    if (elements.addBackdrop) {
      elements.addBackdrop.addEventListener("click", function onAddBackdropClick() {
        setAddPopupOpen(false);
      });
    }
    if (elements.addCloseButton) {
      elements.addCloseButton.addEventListener("click", function onAddCloseClick() {
        setAddPopupOpen(false);
      });
    }
    if (elements.addCancelButton) {
      elements.addCancelButton.addEventListener("click", function onAddCancelClick() {
        setAddPopupOpen(false);
      });
    }
    if (elements.deleteForm) {
      elements.deleteForm.addEventListener("submit", onDeleteFormSubmit);
    }
    if (elements.deleteBackdrop) {
      elements.deleteBackdrop.addEventListener("click", function onDeleteBackdropClick() {
        setDeletePopupOpen(false);
      });
    }
    if (elements.deleteCloseButton) {
      elements.deleteCloseButton.addEventListener("click", function onDeleteCloseClick() {
        setDeletePopupOpen(false);
      });
    }
    if (elements.deleteCancelButton) {
      elements.deleteCancelButton.addEventListener("click", function onDeleteCancelClick() {
        setDeletePopupOpen(false);
      });
    }

    if (elements.profileTrigger) {
      elements.profileTrigger.addEventListener("click", function onProfileTriggerClick() {
        if (!state.profiles.length || elements.profileTrigger.disabled) {
          return;
        }
        setProfileMenuOpen(!state.profileMenuOpen);
      });
    }

    if (elements.profileMenu) {
      elements.profileMenu.addEventListener("click", function onProfileMenuClick(event) {
        var option = event.target && event.target.closest ? event.target.closest("[data-profile-index]") : null;
        if (!option || !elements.profileSelect) {
          return;
        }
        elements.profileSelect.value = option.getAttribute("data-profile-index");
        setProfileMenuOpen(false);
        onProfileChange();
      });
    }

    if (elements.profileSelect) {
      elements.profileSelect.addEventListener("change", onProfileChange);
    }

    document.addEventListener("click", function onDocumentClick(event) {
      if (!state.profileMenuOpen) {
        return;
      }
      if (
        (elements.profileTrigger && elements.profileTrigger.contains(event.target)) ||
        (elements.profileMenu && elements.profileMenu.contains(event.target))
      ) {
        return;
      }
      setProfileMenuOpen(false);
    });

    document.addEventListener("keydown", function onDocumentKeydown(event) {
      if (event.key === "Escape" && state.deletePopupOpen) {
        setDeletePopupOpen(false);
      } else if (event.key === "Escape" && state.addPopupOpen) {
        setAddPopupOpen(false);
      }
    });

    renderProfileOptions();
    renderProfileLabel();
    renderSelectedProfile();
    refreshActionButtons();
    setMode("save");
  }

  function crc8(inputBytes) {
    var crc = 0;
    for (var i = 0; i < inputBytes.length; i += 1) {
      crc ^= inputBytes[i] & 0xff;
      for (var bit = 0; bit < 8; bit += 1) {
        if (crc & 0x80) {
          crc = ((crc << 1) ^ 0x07) & 0xff;
        } else {
          crc = (crc << 1) & 0xff;
        }
      }
    }
    return crc;
  }

  function applyHeaderCrc32(bytes) {
    if (!bytes || bytes.length <= HEADER_CRC_START) {
      return false;
    }

    var table = applyHeaderCrc32._crcTable;
    if (!table) {
      table = new Uint32Array(256);
      for (var i = 0; i < 256; i += 1) {
        var c = i;
        for (var k = 0; k < 8; k += 1) {
          c = (c & 1) ? ((0xedb88320 ^ (c >>> 1)) >>> 0) : (c >>> 1);
        }
        table[i] = c >>> 0;
      }
      applyHeaderCrc32._crcTable = table;
    }

    var crc = 0xffffffff;
    for (var offset = HEADER_CRC_START; offset < bytes.length; offset += 1) {
      crc = (table[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    writeU32BE(bytes, HEADER_CRC_OFFSET, crc);
    return true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
