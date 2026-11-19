import assert from "node:assert/strict";
import test from "node:test";
import type { ClubSettingsValue } from "@ms/shared/clubs";
import {
  NEW_CLUB_DRAFT,
  canAddLine,
  changedFields,
  checkNewClub,
  checkSettings,
  createDraft,
  errorsByField,
  rebaseDraft,
  settingsRequest,
  withoutBlankLines,
  type DraftCheck,
  type FieldErrors,
} from "./club-edit-state.ts";

const SAVED: ClubSettingsValue = {
  isOpen: true,
  regions: ["EU"],
  clubCodes: ["ABC1234"],
  firstUniform: "",
  secondUniform: "",
  stadium: "",
  discordUrl: "",
};

function errorsOf(check: DraftCheck): FieldErrors {
  if (check.ok) assert.fail("expected field errors");
  return check.errors;
}

function requestOf(check: DraftCheck): Record<string, unknown> {
  if (!check.ok) assert.fail(`unexpected errors: ${JSON.stringify([...check.errors])}`);
  return check.request;
}

test("a draft starts as saved; only lines with another value count as changed", () => {
  const draft = createDraft(SAVED);
  assert.deepEqual([...changedFields(draft, SAVED)], []);
  const added = { ...draft, regions: [...draft.regions, ""], codes: [" ABC1234 "] };
  assert.deepEqual([...changedFields(added, SAVED)], [], "a blank added line and spaces change nothing");
  const changed = { ...draft, isOpen: false, regions: ["EU", "NA"], firstUniform: "Red", secondUniform: "Blue" };
  assert.deepEqual([...changedFields(changed, SAVED)], ["status", "regions", "uniforms"]);
  assert.deepEqual(withoutBlankLines(added, "regions").regions, ["EU"]);
});

test("at most three regions and three club codes", () => {
  const draft = { ...createDraft(SAVED), regions: ["EU", "NA"], codes: ["ABC1234", "DEF5678", "GHI9012"] };
  assert.equal(canAddLine(draft, "regions"), true);
  assert.equal(canAddLine({ ...draft, regions: ["EU", "NA", "SA"] }, "regions"), false);
  assert.equal(canAddLine(draft, "codes"), false);
});

test("SAVE sends the settings checked by the shared rules, errors by line", () => {
  const draft = { ...createDraft(SAVED), codes: ["ABC1234", "short"], discordUrl: "https://example.com" };
  const errors = errorsOf(checkSettings(draft, SAVED));
  assert.deepEqual(errors.get("codes"), ["A club code has exactly 7 letters or digits."]);
  assert.deepEqual(errors.get("discord"), ["Enter a Discord invite link (discord.gg/…)."]);
  const fine = checkSettings({ ...createDraft(SAVED), regions: ["EU", ""], discordUrl: " discord.gg/abc " }, SAVED);
  assert.deepEqual(fine, {
    ok: true,
    request: {
      is_open: true,
      regions: ["EU"],
      club_codes: ["ABC1234"],
      first_uniform: "",
      second_uniform: "",
      stadium: "",
      discord_url: "discord.gg/abc",
    },
  });
});

test("an older uniform pair may stay while it is left unchanged", () => {
  const legacy = { ...SAVED, firstUniform: "Red", secondUniform: "Pink" };
  assert.equal(checkSettings(createDraft(legacy), legacy).ok, true);
  const changed = errorsOf(checkSettings({ ...createDraft(legacy), secondUniform: "Orange" }, legacy));
  assert.deepEqual(changed.get("uniforms"), ["Select one colour from each group."]);
});

test("a new club needs a name, a tag, a status, a region and a club code", () => {
  assert.deepEqual([...errorsOf(checkNewClub(NEW_CLUB_DRAFT)).keys()], ["name", "tag", "status", "regions", "codes"]);
  const blocked = errorsOf(
    checkNewClub({ ...NEW_CLUB_DRAFT, name: "Mods", tag: "mod", isOpen: false, regions: ["NA"] }),
  );
  assert.deepEqual(blocked.get("tag"), ["This tag cannot be used."]);
  const ok = checkNewClub({
    ...NEW_CLUB_DRAFT,
    name: " Hammer  Bros ",
    tag: "HB",
    isOpen: false,
    regions: ["NA"],
    codes: ["ABC1234"],
  });
  assert.equal(requestOf(ok).tag, "HB");
  assert.deepEqual(settingsRequest(NEW_CLUB_DRAFT).regions, []);
});

test("the API's field errors map to the lines", () => {
  const errors = errorsByField([
    { field: "club_codes.1", message: "This club code is entered twice." },
    { field: "club_codes.2", message: "This club code is entered twice." },
    { field: "request", message: "This request is not valid." },
  ]);
  assert.deepEqual([...errors], [["codes", ["This club code is entered twice."]]]);
});

test("a draft over settings saved meanwhile: own lines stay, the rest takes the new values, clashes are named", () => {
  const draft = { ...createDraft(SAVED), isOpen: false, stadium: "Crystal Canyon" };
  const now = { ...SAVED, isOpen: true, stadium: "The Battle Dome", discordUrl: "https://discord.gg/abc" };
  const { draft: rebased, conflicts } = rebaseDraft(draft, SAVED, now);
  assert.equal(rebased.isOpen, false, "changed here only: kept");
  assert.equal(rebased.stadium, "Crystal Canyon", "changed on both sides: kept and marked");
  assert.equal(rebased.discordUrl, "https://discord.gg/abc", "changed there only: taken over");
  assert.deepEqual([...conflicts], ["stadium"]);
});
