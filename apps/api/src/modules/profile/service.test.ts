import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { UNKNOWN_MEMBER, type GuildMember } from "../../integrations/discord/members.ts";
import type { DiscordIdentity } from "./mappers.ts";
import {
  applyPlan,
  createProfileService,
  offeredCountries,
  planChanges,
  profileVersion,
  type CodeKey,
  type ProfileStore,
  type StoredFriendCode,
  type StoredProfile,
} from "./service.ts";

const IDENTITY: DiscordIdentity = {
  id: "709777875686916210",
  username: "goldcobra",
  globalName: "GoldCobra",
  nick: "Cobra",
};
const COUNTRIES = [
  { code: "de", name: "Germany" },
  { code: "us", name: "United States" },
  { code: "eu", name: "Europe is NOT a Country" },
  { code: "rocci", name: "Arg Matey!" },
  { code: "scotland", name: "Scotland" },
];

const sw = (code: string, lineSeq = 1): StoredFriendCode => ({ gameType: 3, region: "SW", lineSeq, label: "", code });
const msc = (region: string, lineSeq: number, label: string, code: string): StoredFriendCode => ({
  gameType: 1,
  region,
  lineSeq,
  label,
  code,
});

const TITLES: StoredProfile["titles"] = [
  {
    code: "legacy-legend",
    name: "LEGACY LEGEND",
    category: "legacy-rank",
    categoryName: "Legacy Ranks",
    style: "legacy",
  },
  { code: "og-player", name: "OG PLAYER", category: "free", categoryName: "Free Titles", style: "free" },
];

const PROFILE: StoredProfile = {
  playerId: 223,
  country: "de",
  codes: [sw("0012-0000-0340"), msc("NTSC", 1, "", "4444-5555-6666"), msc("PAL", 1, "Wii", "1111-2222-3333")],
  title: "",
  titles: TITLES,
};

interface Harness {
  store: ProfileStore & { saved: StoredProfile; writes: number; audits: string[] };
  service: ReturnType<typeof createProfileService>;
  changes: number;
}

function harness({
  profile = PROFILE,
  taken = [] as CodeKey[],
  member = { membership: "member", nick: "[CE] Cobra", username: "goldcobra", globalName: "GoldCobra" },
  failApply,
}: { profile?: StoredProfile; taken?: CodeKey[]; member?: GuildMember; failApply?: Error } = {}): Harness {
  const state = { changes: 0 };
  const store = {
    saved: profile,
    writes: 0,
    audits: [] as string[],
    ensurePlayer: () => Promise.resolve({ playerId: 223, created: false }),
    findPlayerId: () => Promise.resolve(223),
    readProfile() {
      return Promise.resolve(store.saved);
    },
    countries: () => Promise.resolve(COUNTRIES),
    saveProfile<T>(
      _playerId: number,
      codes: readonly CodeKey[],
      decide: (
        current: StoredProfile,
        taken: readonly CodeKey[],
      ) => { plan: Parameters<typeof applyPlan>[1] | null; audit: string; result: T },
    ) {
      const decision = decide(
        store.saved,
        taken.filter((key) => codes.some((code) => code.code === key.code)),
      );
      if (decision.plan) {
        if (failApply) return Promise.reject(failApply);
        store.saved = applyPlan(store.saved, decision.plan);
        store.writes += 1;
        store.audits.push(decision.audit);
      }
      return Promise.resolve(decision.result);
    },
  };
  const service = createProfileService({
    store,
    members: { getMember: () => Promise.resolve(member) },
    onChange: () => {
      state.changes += 1;
    },
  });
  return {
    store,
    service,
    get changes() {
      return state.changes;
    },
  };
}

function auditOf(h: Harness, index: number): { title?: unknown } {
  return JSON.parse(h.store.audits[index] ?? "{}") as { title?: unknown };
}

async function editable(h: Harness) {
  const profile = await h.service.getEditableProfile(IDENTITY);
  assert.ok(profile);
  return profile;
}

function request(h: { version: string }, overrides: Record<string, unknown> = {}) {
  return {
    version: h.version,
    country: "de",
    switch_code: "0012-0000-0340",
    msc_codes: [
      { region: "PAL", platform: "Wii", code: "1111-2222-3333" },
      { region: "NTSC", platform: "Dolphin", code: "4444-5555-6666" },
    ],
    ...overrides,
  };
}

test("the editor shows the profile with current server names, sorted MSC codes and offered countries", async () => {
  const profile = await editable(harness());
  assert.deepEqual(profile.discord, {
    id: IDENTITY.id,
    serverName: "[CE] Cobra",
    username: "goldcobra",
    globalName: "GoldCobra",
    nick: "[CE] Cobra",
    membership: "member",
    source: "live",
  });
  assert.equal(profile.switchCode, "0012-0000-0340");
  assert.deepEqual(profile.mscCodes, [
    { region: "PAL", platform: "Wii", code: "1111-2222-3333" },
    { region: "NTSC", platform: "", code: "4444-5555-6666" },
  ]);
  assert.deepEqual(
    profile.countries.map((country) => country.code),
    ["de", "us", "scotland"],
  );
  assert.equal(profile.version, profileVersion(PROFILE));
});

test("names fall back to the login when Discord cannot be asked; a non-member is reported", async () => {
  const unknown = await editable(harness({ member: UNKNOWN_MEMBER }));
  assert.equal(unknown.discord.source, "login");
  assert.equal(unknown.discord.serverName, "Cobra");
  const noNick = await editable(
    harness({ member: { membership: "member", nick: "", username: "goldcobra", globalName: "" } }),
  );
  assert.equal(noNick.discord.serverName, "goldcobra");
  const left = await editable(harness({ member: { ...UNKNOWN_MEMBER, membership: "not_member" } }));
  assert.equal(left.discord.membership, "not_member");
});

test("a country that is no longer offered stays selectable while the profile has it", () => {
  assert.deepEqual(
    offeredCountries(COUNTRIES, "rocci").map((country) => country.code),
    ["de", "us", "scotland", "rocci"],
  );
  assert.deepEqual(offeredCountries(COUNTRIES, "xx").at(-1), { code: "xx", name: "xx" });
});

test("a save writes only what changed and keeps the bot's LineSeq numbering", async () => {
  const h = harness();
  const profile = await editable(h);
  const outcome = await h.service.saveEditableProfile(
    IDENTITY,
    request(profile, {
      country: "us",
      msc_codes: [
        { region: "NTSC", platform: "Dolphin", code: "4444-5555-6666" },
        { region: "NTSC", platform: "Wii U", code: "0000-0000-0001" },
      ],
    }),
  );
  assert.ok(outcome.kind === "saved");
  assert.equal(outcome.changed, true);
  assert.equal(h.changes, 1);
  assert.equal(h.store.saved.country, "us");
  assert.deepEqual(
    h.store.saved.codes.map((row) => `${row.gameType}:${row.region}:${row.lineSeq}:${row.label}:${row.code}`).sort(),
    ["1:NTSC:1:Dolphin:4444-5555-6666", "1:NTSC:2:Wii U:0000-0000-0001", "3:SW:1::0012-0000-0340"],
  );
  // The saved profile comes back with its new version; leading zeros are kept.
  assert.ok(outcome.profile.mscCodes.some((entry) => entry.code === "0000-0000-0001"));
  assert.notEqual(outcome.profile.version, profile.version);
});

test("saving what is saved already writes nothing, even with an old version (double click)", async () => {
  const h = harness();
  const profile = await editable(h);
  const first = await h.service.saveEditableProfile(IDENTITY, request(profile));
  assert.ok(first.kind === "saved" && first.changed);
  const again = await h.service.saveEditableProfile(IDENTITY, request(profile));
  assert.ok(again.kind === "saved");
  assert.equal(again.changed, false);
  assert.equal(h.store.writes, 1);
  assert.equal(h.changes, 1);
});

test("a profile changed elsewhere since it was loaded is not overwritten", async () => {
  const h = harness();
  const profile = await editable(h);
  // Meanwhile the bot adds a code.
  h.store.saved = { ...h.store.saved, codes: [...h.store.saved.codes, msc("PAL", 2, "Dolphin", "7777-8888-9999")] };
  const outcome = await h.service.saveEditableProfile(IDENTITY, request(profile, { country: "us" }));
  assert.ok(outcome.kind === "conflict");
  assert.ok(outcome.current.mscCodes.some((entry) => entry.code === "7777-8888-9999"));
  assert.equal(h.store.writes, 0);
});

test("codes other profiles have are refused, also when the race reaches the unique index", async () => {
  const taken = harness({ taken: [{ gameType: 3, code: "5555-5555-5555" }] });
  const profile = await editable(taken);
  const outcome = await taken.service.saveEditableProfile(
    IDENTITY,
    request(profile, { switch_code: "5555-5555-5555" }),
  );
  assert.deepEqual(outcome.kind === "taken" && outcome.errors.map((error) => `${error.field}:${error.code}`), [
    "switch_code:TAKEN",
  ]);

  const race = harness({ failApply: Object.assign(new Error("duplicate key"), { number: 2601 }) });
  const raced = await race.service.saveEditableProfile(
    IDENTITY,
    request(await editable(race), { switch_code: "5555-5555-5555" }),
  );
  assert.deepEqual(raced.kind === "taken" && raced.errors.map((error) => error.field), ["switch_code"]);
  const broken = harness({ failApply: new Error("Connection is closed.") });
  await assert.rejects(
    broken.service.saveEditableProfile(IDENTITY, request(await editable(broken), { country: "us" })),
    /Connection is closed/,
  );
});

test("invalid requests and former members change nothing", async () => {
  const h = harness();
  const profile = await editable(h);
  const invalid = await h.service.saveEditableProfile(IDENTITY, request(profile, { switch_code: "0012-0000-034" }));
  assert.deepEqual(invalid.kind === "invalid" && invalid.errors.map((error) => error.code), ["INCOMPLETE"]);
  const noPlatform = await h.service.saveEditableProfile(
    IDENTITY,
    request(profile, { msc_codes: [{ region: "PAL", platform: "", code: "1111-2222-3333" }] }),
  );
  assert.deepEqual(noPlatform.kind === "invalid" && noPlatform.errors.map((error) => error.code), [
    "PLATFORM_REQUIRED",
  ]);
  const hidden = await h.service.saveEditableProfile(IDENTITY, request(profile, { country: "eu" }));
  assert.deepEqual(hidden.kind === "invalid" && hidden.errors.map((error) => error.code), ["UNKNOWN_COUNTRY"]);

  const left = harness({ member: { ...UNKNOWN_MEMBER, membership: "not_member" } });
  assert.deepEqual(await left.service.saveEditableProfile(IDENTITY, request(profile, { country: "us" })), {
    kind: "not_member",
  });
  assert.equal(h.store.writes + left.store.writes, 0);
});

test("an older MSC code without a platform stays as it is while other parts change", async () => {
  const h = harness();
  const kept = [
    { region: "PAL", platform: "Wii", code: "1111-2222-3333" },
    { region: "NTSC", platform: "", code: "4444-5555-6666" },
  ];
  const saved = await h.service.saveEditableProfile(
    IDENTITY,
    request(await editable(h), { country: "us", msc_codes: kept }),
  );
  assert.ok(saved.kind === "saved" && saved.changed);
  assert.equal(h.store.saved.country, "us");
  assert.equal(h.store.saved.codes.find((row) => row.code === "4444-5555-6666")?.label, "");
  const moved = await h.service.saveEditableProfile(
    IDENTITY,
    request(await editable(h), { msc_codes: [kept[0], { region: "PAL", platform: "", code: "4444-5555-6666" }] }),
  );
  assert.deepEqual(moved.kind === "invalid" && moved.errors.map((error) => error.code), ["PLATFORM_REQUIRED"]);
});

test("the plan keeps rows of unchanged codes and renumbers the rest from 1", () => {
  const current: StoredProfile = {
    playerId: 1,
    country: "",
    codes: [
      msc("PAL", 1, "Wii", "1111-1111-1111"),
      msc("PAL", 2, "", "2222-2222-2222"),
      msc("PAL", 3, "Wii", "3333-3333-3333"),
    ],
    title: "",
    titles: [],
  };
  const plan = planChanges(current, "", [
    msc("PAL", 0, "Wii", "3333-3333-3333"),
    msc("PAL", 0, "Dolphin", "2222-2222-2222"),
    msc("NTSC", 0, "Wii U", "4444-4444-4444"),
  ]);
  assert.ok(plan);
  assert.deepEqual(plan.deletes, [current.codes[0]]);
  assert.deepEqual(
    plan.updates.map((update) => [update.row.lineSeq, update.lineSeq, update.label]),
    [
      [2, 1, "Dolphin"],
      [3, 2, "Wii"],
    ],
  );
  assert.deepEqual(plan.inserts, [msc("NTSC", 1, "Wii U", "4444-4444-4444")]);
  assert.equal(plan.country, null);
  assert.equal(planChanges(current, "", current.codes), null);
  assert.equal(planChanges({ ...current, country: "DE" }, "de", current.codes), null);
});

test("applying a plan leaves exactly the requested rows", () => {
  const plan = planChanges(PROFILE, "", [sw("9999-0000-0001")]);
  assert.ok(plan);
  assert.deepEqual(applyPlan(PROFILE, plan), { ...PROFILE, country: "", codes: [sw("9999-0000-0001")] });
});

test("the editor offers the player's titles; one of them is selected and saved, none removes it", async () => {
  const h = harness();
  const profile = await editable(h);
  assert.equal(profile.title, "");
  assert.deepEqual(
    profile.titles.map((title) => title.code),
    ["legacy-legend", "og-player"],
  );
  const selected = await h.service.saveEditableProfile(IDENTITY, request(profile, { title: "LEGACY-LEGEND" }));
  assert.ok(selected.kind === "saved" && selected.changed);
  assert.equal(h.store.saved.title, "legacy-legend");
  assert.equal(selected.profile.title, "legacy-legend");
  assert.deepEqual(auditOf(h, 0).title, { from: "", to: "legacy-legend" });
  // The selected title is part of the version, so a save from an older page is refused.
  assert.notEqual(selected.profile.version, profile.version);

  const removed = await h.service.saveEditableProfile(IDENTITY, request(selected.profile, { title: "" }));
  assert.ok(removed.kind === "saved" && removed.changed);
  assert.equal(h.store.saved.title, "");
});

test("the version has the title only when one is selected, so versions from before titles stay valid", () => {
  const rows = PROFILE.codes
    .map((row) => JSON.stringify([row.gameType, row.region, row.lineSeq, row.label, row.code]))
    .sort();
  const before = createHash("sha256")
    .update(JSON.stringify(["de", rows]))
    .digest("base64url");
  assert.equal(profileVersion(PROFILE), before);
  assert.notEqual(profileVersion({ ...PROFILE, title: "og-player" }), before);
});

test("a request without a title leaves it; a title the player cannot select is refused", async () => {
  const h = harness({ profile: { ...PROFILE, title: "og-player" } });
  const profile = await editable(h);
  const other = await h.service.saveEditableProfile(IDENTITY, request(profile, { country: "us" }));
  assert.ok(other.kind === "saved" && other.changed);
  assert.equal(h.store.saved.title, "og-player");
  assert.equal(auditOf(h, 0).title, undefined);

  const refused = await h.service.saveEditableProfile(
    IDENTITY,
    request(await editable(h), { title: "msl-2023-world-champion" }),
  );
  assert.deepEqual(refused.kind === "invalid" && refused.errors.map((error) => `${error.field}:${error.code}`), [
    "title:UNKNOWN_TITLE",
  ]);
  assert.equal(h.store.writes, 1);
});

test("the plan changes the title only when asked for another one", () => {
  const withTitle = { ...PROFILE, title: "og-player" };
  assert.equal(planChanges(withTitle, "de", withTitle.codes), null);
  assert.equal(planChanges(withTitle, "de", withTitle.codes, "og-player"), null);
  assert.equal(planChanges(withTitle, "de", withTitle.codes, "")?.title, "");
  assert.equal(planChanges(PROFILE, "de", PROFILE.codes, "og-player")?.title, "og-player");
});
