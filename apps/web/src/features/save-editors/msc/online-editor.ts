// The FRIENDLIST mode of the MSC save editor, and the switch between the SAVE and FRIENDLIST modes:
// loads an Online file, shows each profile's friend roster, adds and deletes friend codes and exports
// the patched file.

import { escapeHtml } from "@ms/shared/html";
import { downloadFile, elementById, pickedFile, showStatus, type StatusLevel } from "../shared/editor-ui.ts";
import {
  MAX_FRIENDS,
  addFriendCodes,
  batchAddStatus,
  deleteFriends,
  parseFriendCodeBatch,
  parseOnlineFile,
  skippedCount,
  type Profile,
} from "./online-core.ts";

const FILE_NAME = "Online";

export function initMscOnlineEditor(): void {
  const panel = document.querySelector(".save-editor-panel");
  const modeButtons = Array.from(document.querySelectorAll<HTMLElement>("[data-editor-mode-target]"));
  const actionGroups = Array.from(document.querySelectorAll<HTMLElement>("[data-editor-actions]"));
  const modePanels = Array.from(document.querySelectorAll<HTMLElement>("[data-editor-view]"));
  const loadButton = elementById("online-editor-load", HTMLElement);
  const addButton = elementById("online-editor-add", HTMLButtonElement);
  const deleteButton = elementById("online-editor-delete", HTMLButtonElement);
  const exportButton = elementById("online-editor-export", HTMLButtonElement);
  const fileInput = elementById("online-editor-file-input", HTMLInputElement);
  const profileLabel = elementById("online-editor-profile-label", HTMLElement);
  const profileTrigger = elementById("online-editor-profile-trigger", HTMLButtonElement);
  const profileTriggerName = elementById("online-editor-profile-trigger-name", HTMLElement);
  const profileTriggerMeta = elementById("online-editor-profile-trigger-meta", HTMLElement);
  const profileMenu = elementById("online-editor-profile-menu", HTMLElement);
  const profileSelect = elementById("online-editor-profile", HTMLSelectElement);
  const results = elementById("online-editor-results", HTMLElement);
  const status = elementById("online-editor-status", HTMLElement);
  const addPopup = elementById("online-editor-add-popup", HTMLElement);
  const addForm = elementById("online-editor-add-form", HTMLFormElement);
  const friendCodeInput = elementById("online-editor-friend-code", HTMLTextAreaElement);
  const addError = elementById("online-editor-add-error", HTMLElement);
  const deletePopup = elementById("online-editor-delete-popup", HTMLElement);
  const deleteForm = elementById("online-editor-delete-form", HTMLFormElement);
  const deleteList = elementById("online-editor-delete-list", HTMLElement);
  const deleteError = elementById("online-editor-delete-error", HTMLElement);

  let profiles: Profile[] = [];
  let selectedIndex = 0;
  let menuOpen = false;
  let addOpen = false;
  let deleteOpen = false;
  let fileName = FILE_NAME;
  let workingBytes: Uint8Array | null = null;
  let dirty = false;

  const setStatus = (message: string, level?: StatusLevel): void => {
    showStatus(status, message, level);
  };
  const selectedProfile = (): Profile | undefined => profiles[selectedIndex];
  const ownCodeLabel = (profile: Profile): string => profile.ownFriendCode || "Friend Code unavailable";

  const setMenuOpen = (open: boolean): void => {
    menuOpen = open;
    if (profileMenu) profileMenu.hidden = !menuOpen;
    profileTrigger?.setAttribute("aria-expanded", menuOpen ? "true" : "false");
  };

  const refreshButtons = (): void => {
    const hasFile = Boolean(workingBytes && profiles.length);
    if (addButton) addButton.disabled = !hasFile;
    if (deleteButton) deleteButton.disabled = !(hasFile && selectedProfile()?.players.length);
    if (exportButton) exportButton.disabled = !(hasFile && dirty);
  };

  const refreshBodyState = (): void => {
    document.body.classList.toggle("popup-open", addOpen || deleteOpen);
  };

  const setAddError = (message: string): void => {
    if (addError) addError.textContent = message;
  };
  const setDeleteError = (message: string): void => {
    if (deleteError) deleteError.textContent = message;
  };

  const renderDeleteList = (): void => {
    if (!deleteList) return;
    const profile = selectedProfile();
    if (!profile?.players.length) {
      deleteList.innerHTML = '<p class="online-editor-empty">This profile has no friends.</p>';
      return;
    }
    deleteList.innerHTML = profile.players
      .map(
        (player, index) =>
          '<label class="online-editor-delete-row">' +
          `<input class="online-editor-delete-checkbox" type="checkbox" name="online-editor-delete-entry" value="${index}">` +
          `<span class="online-editor-delete-name">${escapeHtml(player.name)}</span>` +
          `<span class="online-editor-delete-code">${escapeHtml(player.friendCode)}</span>` +
          "</label>",
      )
      .join("");
  };

  // The two dialogs never show together.
  const setAddOpen = (open: boolean): void => {
    if (open && deleteOpen) setDeleteOpen(false);
    addOpen = open;
    if (addPopup) {
      addPopup.hidden = !addOpen;
      addPopup.setAttribute("aria-hidden", addOpen ? "false" : "true");
    }
    refreshBodyState();
    if (addOpen) {
      setAddError("");
      if (friendCodeInput) {
        friendCodeInput.value = "";
        window.setTimeout(() => {
          friendCodeInput.focus();
        }, 0);
      }
    }
  };

  function setDeleteOpen(open: boolean): void {
    if (open && addOpen) setAddOpen(false);
    deleteOpen = open;
    if (deletePopup) {
      deletePopup.hidden = !deleteOpen;
      deletePopup.setAttribute("aria-hidden", deleteOpen ? "false" : "true");
    }
    refreshBodyState();
    if (deleteOpen) {
      setDeleteError("");
      renderDeleteList();
      window.setTimeout(() => {
        deleteList?.querySelector<HTMLInputElement>("input[type='checkbox']")?.focus();
      }, 0);
    }
  }

  const setMode = (mode: string | null): void => {
    const active = mode === "friendlist" ? "friendlist" : "save";
    panel?.setAttribute("data-editor-mode", active);
    for (const button of modeButtons) {
      const isActive = button.getAttribute("data-editor-mode-target") === active;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    for (const group of actionGroups) {
      const show = group.getAttribute("data-editor-actions") === active;
      group.hidden = !show;
      group.classList.toggle("is-active", show);
    }
    for (const view of modePanels) {
      const show = view.getAttribute("data-editor-view") === active;
      view.hidden = !show;
      view.classList.toggle("is-active", show);
    }
  };

  const updateTrigger = (): void => {
    if (!profileTriggerName || !profileTriggerMeta) return;
    const profile = selectedProfile();
    profileTriggerName.textContent = profile ? profile.profileName : "Load an Online file first";
    profileTriggerMeta.textContent = profile ? `(${ownCodeLabel(profile)})` : "";
  };

  const renderMenu = (): void => {
    if (!profileMenu) return;
    profileMenu.innerHTML = profiles
      .map((profile, index) => {
        const isSelected = index === selectedIndex;
        return (
          `<button class="online-editor-profile-option${isSelected ? " is-selected" : ""}" data-profile-index="${index}" type="button" role="option" aria-selected="${isSelected ? "true" : "false"}">` +
          `<span class="online-editor-profile-option-name">${escapeHtml(profile.profileName)}</span>` +
          `<span class="online-editor-profile-option-meta">(${escapeHtml(ownCodeLabel(profile))})</span>` +
          "</button>"
        );
      })
      .join("");
  };

  const renderOptions = (): void => {
    if (!profileSelect || !profileMenu || !profileTriggerName || !profileTriggerMeta || !profileTrigger) return;
    if (!profiles.length) {
      profileSelect.innerHTML = '<option value="">Load an Online file first</option>';
      profileSelect.disabled = true;
      profileTrigger.disabled = true;
      profileTriggerName.textContent = "Load an Online file first";
      profileTriggerMeta.textContent = "";
      profileMenu.innerHTML = "";
      setMenuOpen(false);
      return;
    }
    profileSelect.innerHTML = profiles
      .map(
        (profile, index) =>
          `<option value="${index}"${index === selectedIndex ? " selected" : ""}>${escapeHtml(profile.profileName)} (${escapeHtml(ownCodeLabel(profile))})</option>`,
      )
      .join("");
    profileSelect.disabled = false;
    profileTrigger.disabled = false;
    updateTrigger();
    renderMenu();
  };

  const renderLabel = (): void => {
    if (!profileLabel) return;
    const profile = selectedProfile();
    profileLabel.textContent = profile ? `PROFILE (${profile.region})` : "PROFILE";
  };

  const renderRoster = (): void => {
    if (!results) return;
    const profile = selectedProfile();
    renderLabel();
    if (!profile) {
      results.innerHTML = '<p class="online-editor-empty">No Online file loaded.</p>';
      return;
    }
    if (!profile.players.length) {
      results.innerHTML = '<p class="online-editor-empty">This profile has no friends.</p>';
      return;
    }
    const rows = profile.players
      .map(
        (player) =>
          '<tr class="online-editor-separator-row" aria-hidden="true"><td colspan="2"><span class="online-editor-row-separator"></span></td></tr>' +
          `<tr><td><span class="online-editor-roster-name">${escapeHtml(player.name)}</span></td><td><span class="online-editor-roster-code">${escapeHtml(player.friendCode)}</span></td></tr>`,
      )
      .join("");
    results.innerHTML = [
      '<table class="online-editor-table">',
      `<thead><tr><th><span class="online-editor-roster-name"><span class="online-editor-roster-header-muted">Friend Roster </span><span class="online-editor-roster-count">${profile.players.length}</span><span class="online-editor-roster-header-muted">/${MAX_FRIENDS}</span></span></th><th><span class="online-editor-roster-code online-editor-roster-header-muted">Friend Code</span></th></tr></thead>`,
      "<tbody>",
      rows,
      "</tbody>",
      "</table>",
    ].join("");
  };

  const showProfiles = (next: Profile[], index: number): void => {
    profiles = next;
    selectedIndex = Math.min(Math.max(index || 0, 0), profiles.length - 1);
    renderOptions();
    renderLabel();
    renderRoster();
    refreshButtons();
  };

  const resetFile = (): void => {
    profiles = [];
    selectedIndex = 0;
    fileName = FILE_NAME;
    workingBytes = null;
    dirty = false;
    renderOptions();
    renderLabel();
    renderRoster();
    refreshButtons();
  };

  const onProfileChange = (): void => {
    const value = profileSelect ? Number(profileSelect.value) : 0;
    selectedIndex = Number.isInteger(value) && value >= 0 ? value : 0;
    updateTrigger();
    renderMenu();
    renderRoster();
    refreshButtons();
  };

  const onFilePicked = (event: Event): void => {
    const file = pickedFile(event);
    if (!file) return;
    file
      .arrayBuffer()
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        const parsed = parseOnlineFile(bytes);
        if (!parsed.ok) {
          resetFile();
          setStatus(parsed.error, "error");
          return;
        }
        fileName = file.name || FILE_NAME;
        workingBytes = new Uint8Array(bytes);
        dirty = false;
        showProfiles(parsed.profiles, 0);
        setStatus("Online file loaded.", "success");
      })
      .catch(() => {
        resetFile();
        setStatus("Failed to read Online file.", "error");
      })
      .finally(() => {
        if (fileInput) fileInput.value = "";
      });
  };

  const onAddSubmit = (event: Event): void => {
    event.preventDefault();
    const profile = selectedProfile();
    if (!profile) {
      setAddError("Load an Online file first.");
      return;
    }
    const batch = parseFriendCodeBatch(friendCodeInput?.value ?? "", profile);
    if (!batch.ok) {
      setAddError(batch.error);
      return;
    }
    if (profile.players.length + batch.entries.length > MAX_FRIENDS) {
      setAddError(`Adding ${batch.entries.length} new codes would exceed ${MAX_FRIENDS} friends for this profile.`);
      return;
    }
    if (!batch.entries.length) {
      setAddOpen(false);
      setStatus(batchAddStatus(0, batch.skipped), "warning");
      return;
    }
    if (!workingBytes) {
      setAddError("Load an Online file first.");
      return;
    }
    const added = addFriendCodes(workingBytes, profile, batch.entries);
    if (!added.ok) {
      setAddError(added.error);
      return;
    }
    workingBytes = added.bytes;
    dirty = true;
    showProfiles(added.profiles, selectedIndex);
    setAddOpen(false);
    const count = batch.entries.length;
    setStatus(
      batchAddStatus(count, batch.skipped),
      count > 0 ? "success" : skippedCount(batch.skipped) > 0 ? "warning" : "success",
    );
  };

  const onDeleteSubmit = (event: Event): void => {
    event.preventDefault();
    const checked = Array.from(
      deleteList?.querySelectorAll<HTMLInputElement>("input[name='online-editor-delete-entry']:checked") ?? [],
    );
    const indices = [
      ...new Set(checked.map((box) => Number(box.value)).filter((index) => Number.isInteger(index) && index >= 0)),
    ].sort((a, b) => a - b);
    if (!indices.length) {
      setDeleteError("Select at least one friend code.");
      return;
    }
    const profile = selectedProfile();
    if (!workingBytes || !profile) {
      setDeleteError("Load an Online file first.");
      return;
    }
    const result = deleteFriends(workingBytes, profile, selectedIndex, indices);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    workingBytes = result.bytes;
    dirty = true;
    showProfiles(result.profiles, selectedIndex);
    setDeleteOpen(false);
    setStatus(
      `${indices.length} code${indices.length === 1 ? "" : "s"} deleted. Export Online to save the patched file.`,
      "success",
    );
  };

  for (const button of modeButtons) {
    button.addEventListener("click", (event) => {
      setMode((event.currentTarget as HTMLElement).getAttribute("data-editor-mode-target"));
    });
  }
  if (loadButton && fileInput) {
    loadButton.addEventListener("click", () => {
      fileInput.click();
    });
    fileInput.addEventListener("change", onFilePicked);
  }
  addButton?.addEventListener("click", () => {
    if (!workingBytes || !profiles.length) {
      setStatus("Load an Online file first.", "warning");
      return;
    }
    setMenuOpen(false);
    setAddOpen(true);
  });
  deleteButton?.addEventListener("click", () => {
    const profile = selectedProfile();
    if (!workingBytes || !profile) {
      setStatus("Load an Online file first.", "warning");
      return;
    }
    if (!profile.players.length) {
      setStatus("This profile has no friend codes to delete.", "warning");
      return;
    }
    setMenuOpen(false);
    setDeleteOpen(true);
  });
  exportButton?.addEventListener("click", () => {
    if (!workingBytes || !dirty) {
      setStatus("Patch Online before exporting Online.", "warning");
      return;
    }
    downloadFile(workingBytes, "application/octet-stream", fileName || FILE_NAME);
    setStatus("Patched Online file exported.", "success");
  });
  addForm?.addEventListener("submit", onAddSubmit);
  for (const id of ["online-editor-add-backdrop", "online-editor-add-close", "online-editor-add-cancel"]) {
    elementById(id, HTMLElement)?.addEventListener("click", () => {
      setAddOpen(false);
    });
  }
  deleteForm?.addEventListener("submit", onDeleteSubmit);
  for (const id of ["online-editor-delete-backdrop", "online-editor-delete-close", "online-editor-delete-cancel"]) {
    elementById(id, HTMLElement)?.addEventListener("click", () => {
      setDeleteOpen(false);
    });
  }
  profileTrigger?.addEventListener("click", () => {
    if (profiles.length && !profileTrigger.disabled) setMenuOpen(!menuOpen);
  });
  profileMenu?.addEventListener("click", (event) => {
    const option = event.target instanceof Element ? event.target.closest("[data-profile-index]") : null;
    if (!option || !profileSelect) return;
    profileSelect.value = option.getAttribute("data-profile-index") ?? "";
    setMenuOpen(false);
    onProfileChange();
  });
  profileSelect?.addEventListener("change", onProfileChange);
  document.addEventListener("click", (event) => {
    if (!menuOpen) return;
    const target = event.target instanceof Node ? event.target : null;
    if (profileTrigger?.contains(target) || profileMenu?.contains(target)) return;
    setMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && deleteOpen) setDeleteOpen(false);
    else if (event.key === "Escape" && addOpen) setAddOpen(false);
  });

  renderOptions();
  renderLabel();
  renderRoster();
  refreshButtons();
  setMode("save");
}
