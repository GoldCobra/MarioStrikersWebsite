// The signed-in player's own profile. A profile is created at the first login and reused afterwards,
// whether the website, futbot or robotic_nightmare created it: dbo.Player.DiscordID is unique.
//
// The editor changes the country and the friend codes in the tables robotic_nightmare's /profile
// commands use, in their exact form: codes "1234-5678-9012" (GameType 3 / region "SW" for Switch,
// GameType 1 with region and platform for MSC), LineSeq numbered 1..n per player, game and region. One
// save is one transaction. It is refused when the profile changed since the editor loaded it (version),
// so a change made in Discord meanwhile is never overwritten unseen; a code another profile has is refused.

import { createHash } from "node:crypto";
import {
  FIELD_ERROR_MESSAGES,
  validateEditableProfile,
  type EditableProfileInput,
  type FieldError,
  type MscCodeInput,
} from "@ms/shared/friend-codes";
import { normalizeText } from "@ms/shared/text";
import { HttpError } from "../../http/errors.ts";
import type { GuildMemberLookup, Membership } from "../../integrations/discord/members.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import { isUniqueViolation } from "../../lib/sql-errors.ts";
import { playerNameFromDiscord, type DiscordIdentity } from "./mappers.ts";

export const SWITCH_GAME_TYPE = 3;
export const MSC_GAME_TYPE = 1;
const SWITCH_REGION = "SW";
const MSC_REGION_ORDER: Readonly<Record<string, number>> = { PAL: 1, NTSC: 2, JPN: 3, KOR: 4 };

/** dbo.Enumeration country rows that are no country; the bot's /profile set-flag leaves out the same. */
export const NON_COUNTRY_CODES: ReadonlySet<string> = new Set(["eu", "united_nations", "rocci"]);

export interface EnsuredPlayer {
  readonly playerId: number;
  /** True when this call created the profile. */
  readonly created: boolean;
}

/** One dbo.FriendCodes row. */
export interface StoredFriendCode {
  readonly gameType: number;
  readonly region: string;
  readonly lineSeq: number;
  readonly label: string;
  readonly code: string;
}

export interface StoredProfile {
  readonly playerId: number;
  /** dbo.Player.Country; "" for none. */
  readonly country: string;
  readonly codes: readonly StoredFriendCode[];
}

export interface CountryOption {
  readonly code: string;
  readonly name: string;
}

export interface CodeKey {
  readonly gameType: number;
  readonly code: string;
}

/** The writes of one save. Kept rows are updated in ascending LineSeq order, so no key collides. */
export interface ChangePlan {
  /** The new country, or null when it stays. */
  readonly country: string | null;
  readonly deletes: readonly StoredFriendCode[];
  readonly updates: readonly { readonly row: StoredFriendCode; readonly label: string; readonly lineSeq: number }[];
  readonly inserts: readonly StoredFriendCode[];
}

export interface SaveDecision<T> {
  readonly plan: ChangePlan | null;
  /** dbo.CommandLog parameters of the change. */
  readonly audit: string;
  readonly result: T;
}

/** Where profiles are kept: the database (repository.ts) or the memory of the fixtures. */
export interface ProfileStore {
  /** The player of this Discord id; one with this name is created when there is none. */
  ensurePlayer(discordId: string, name: string): Promise<EnsuredPlayer>;
  findPlayerId(discordId: string): Promise<number | null>;
  readProfile(playerId: number): Promise<StoredProfile>;
  /** dbo.Enumeration's countries, code in lower case, every row. */
  countries(): Promise<readonly CountryOption[]>;
  /**
   * One transaction: reads the profile under update locks and which of `codes` other players have,
   * applies the plan `decide` returns and answers its result.
   */
  saveProfile<T>(
    playerId: number,
    codes: readonly CodeKey[],
    decide: (current: StoredProfile, taken: readonly CodeKey[]) => SaveDecision<T>,
  ): Promise<T>;
}

export interface DiscordNames {
  readonly id: string;
  /** What others see on the server: nickname, else global name, else username. */
  readonly serverName: string;
  readonly username: string;
  readonly globalName: string;
  readonly nick: string;
  readonly membership: Membership;
  /** "live" from Discord now, "login" from the session when Discord could not be asked. */
  readonly source: "live" | "login";
}

export interface EditableProfile {
  readonly playerId: number;
  readonly version: string;
  readonly discord: DiscordNames;
  readonly country: string;
  readonly switchCode: string;
  readonly mscCodes: readonly MscCodeInput[];
  /** The selectable countries, plus the profile's own when it is no longer offered. */
  readonly countries: readonly CountryOption[];
}

export type SaveOutcome =
  | { readonly kind: "saved"; readonly changed: boolean; readonly profile: EditableProfile }
  | { readonly kind: "invalid"; readonly errors: readonly FieldError[] }
  | { readonly kind: "conflict"; readonly current: EditableProfile }
  | { readonly kind: "taken"; readonly errors: readonly FieldError[] }
  | { readonly kind: "not_member" };

export interface ProfileService {
  ensurePlayer(identity: DiscordIdentity): Promise<EnsuredPlayer>;
  /** null when the member has no player profile yet. */
  getEditableProfile(identity: DiscordIdentity): Promise<EditableProfile | null>;
  saveEditableProfile(identity: DiscordIdentity, body: unknown): Promise<SaveOutcome>;
}

export interface ProfileServiceOptions {
  readonly store: ProfileStore;
  readonly members: GuildMemberLookup;
  /** Runs after a save changed something, e.g. to refresh the cached player list. */
  readonly onChange?: () => void;
}

// ---------------------------------------------------------------------------------------------------
// Pure helpers, exported for tests

/** A hash of everything the editor shows of the profile; any change by anyone gives a new one. */
export function profileVersion(profile: StoredProfile): string {
  const codes = profile.codes
    .map((row) =>
      JSON.stringify([row.gameType, row.region.trim().toUpperCase(), row.lineSeq, row.label.trim(), row.code.trim()]),
    )
    .sort();
  return createHash("sha256")
    .update(JSON.stringify([profile.country.trim().toLowerCase(), codes]))
    .digest("base64url");
}

function compareMscRows(a: StoredFriendCode, b: StoredFriendCode): number {
  const order = (row: StoredFriendCode): number => MSC_REGION_ORDER[row.region.trim().toUpperCase()] ?? 9;
  return order(a) - order(b) || a.lineSeq - b.lineSeq;
}

/** The selectable countries: every dbo.Enumeration country but the ones that are none, plus the current one. */
export function offeredCountries(all: readonly CountryOption[], current: string): CountryOption[] {
  const offered = all.filter((country) => country.code && !NON_COUNTRY_CODES.has(country.code));
  if (current && !offered.some((country) => country.code === current)) {
    offered.push(all.find((country) => country.code === current) ?? { code: current, name: current });
  }
  return offered;
}

interface DesiredCode extends StoredFriendCode {
  /** The request field it came from, for errors. */
  readonly field: string;
}

/** The rows a valid request asks for (LineSeq is assigned by the plan). */
export function desiredCodes(request: EditableProfileInput): DesiredCode[] {
  const codes: DesiredCode[] = [];
  if (request.switch_code) {
    codes.push({
      gameType: SWITCH_GAME_TYPE,
      region: SWITCH_REGION,
      lineSeq: 0,
      label: "",
      code: request.switch_code,
      field: "switch_code",
    });
  }
  request.msc_codes.forEach((entry, index) => {
    codes.push({
      gameType: MSC_GAME_TYPE,
      region: entry.region,
      lineSeq: 0,
      label: entry.platform,
      code: entry.code,
      field: `msc_codes.${index}.code`,
    });
  });
  return codes;
}

/**
 * The writes that turn `current` into the requested profile, or null when they are equal. Codes are
 * matched within their game and region, so an unchanged code keeps its row; per group the kept rows
 * keep their order, new codes follow, and LineSeq becomes 1..n like the bot's procedures leave it.
 */
export function planChanges(
  current: StoredProfile,
  country: string,
  desired: readonly StoredFriendCode[],
): ChangePlan | null {
  const groupKey = (row: StoredFriendCode): string => `${row.gameType}|${row.region.trim().toUpperCase()}`;
  const groups = new Set([...current.codes.map(groupKey), ...desired.map(groupKey)]);
  const deletes: StoredFriendCode[] = [];
  const updates: { row: StoredFriendCode; label: string; lineSeq: number }[] = [];
  const inserts: StoredFriendCode[] = [];
  for (const group of groups) {
    const rows = current.codes.filter((row) => groupKey(row) === group).sort((a, b) => a.lineSeq - b.lineSeq);
    const wanted = desired.filter((row) => groupKey(row) === group);
    const kept = new Map<StoredFriendCode, string>();
    const added: StoredFriendCode[] = [];
    for (const want of wanted) {
      const match = rows.find((row) => !kept.has(row) && row.code.trim() === want.code);
      if (match) kept.set(match, want.label);
      else added.push(want);
    }
    for (const row of rows) if (!kept.has(row)) deletes.push(row);
    let lineSeq = 0;
    for (const row of rows) {
      const label = kept.get(row);
      if (label === undefined) continue;
      lineSeq += 1;
      if (row.lineSeq !== lineSeq || row.label.trim() !== label) updates.push({ row, label, lineSeq });
    }
    for (const row of added) {
      lineSeq += 1;
      inserts.push({ gameType: row.gameType, region: row.region, lineSeq, label: row.label, code: row.code });
    }
  }
  const countryChange = country !== current.country.trim().toLowerCase() ? country : null;
  if (countryChange === null && !deletes.length && !updates.length && !inserts.length) return null;
  return { country: countryChange, deletes, updates, inserts };
}

/** The profile a plan leaves behind: what the database holds after the writes of buildApplyQuery. */
export function applyPlan(current: StoredProfile, plan: ChangePlan): StoredProfile {
  const same = (a: StoredFriendCode, b: StoredFriendCode): boolean =>
    a.gameType === b.gameType && a.region === b.region && a.lineSeq === b.lineSeq;
  const codes = current.codes
    .filter((row) => !plan.deletes.some((deleted) => same(deleted, row)))
    .map((row) => {
      const update = plan.updates.find((entry) => same(entry.row, row));
      return update ? { ...row, label: update.label, lineSeq: update.lineSeq } : row;
    });
  return { playerId: current.playerId, country: plan.country ?? current.country, codes: [...codes, ...plan.inserts] };
}

function fieldError(field: string, code: "TAKEN"): FieldError {
  return { field, code, message: FIELD_ERROR_MESSAGES[code] };
}

function requestedCodeKeys(body: unknown): CodeKey[] {
  const record = (body ?? {}) as { switch_code?: unknown; msc_codes?: unknown };
  const keys: CodeKey[] = [];
  if (typeof record.switch_code === "string" && record.switch_code.trim()) {
    keys.push({ gameType: SWITCH_GAME_TYPE, code: record.switch_code.trim() });
  }
  if (Array.isArray(record.msc_codes)) {
    for (const entry of record.msc_codes as unknown[]) {
      const code = (entry as { code?: unknown } | null)?.code;
      if (typeof code === "string" && code.trim()) keys.push({ gameType: MSC_GAME_TYPE, code: code.trim() });
    }
  }
  // Only well-formed codes can be stored, so only they are looked up (at most 1 + 3 of them).
  return keys.filter((key) => /^\d{4}-\d{4}-\d{4}$/.test(key.code)).slice(0, 8);
}

function audit(identity: DiscordIdentity, current: StoredProfile, plan: ChangePlan): string {
  const describe = (row: StoredFriendCode): string =>
    `${row.gameType === SWITCH_GAME_TYPE ? "SW" : row.region}${row.label ? ` (${row.label})` : ""} ${row.code}`;
  return JSON.stringify({
    player_id: current.playerId,
    discord_id: identity.id,
    source: "website profile editor",
    country: plan.country === null ? undefined : { from: current.country, to: plan.country },
    removed: plan.deletes.map(describe),
    added: plan.inserts.map(describe),
    changed: plan.updates
      .filter((update) => update.label !== update.row.label.trim())
      .map((update) => describe({ ...update.row, label: update.label })),
  }).slice(0, 4000);
}

// ---------------------------------------------------------------------------------------------------

export function createProfileService({ store, members, onChange }: ProfileServiceOptions): ProfileService {
  async function discordNames(identity: DiscordIdentity): Promise<DiscordNames> {
    const member = await members.getMember(identity.id);
    const live = member.membership === "member";
    const username = (live ? member.username : "") || identity.username;
    const globalName = live ? member.globalName : identity.globalName;
    const nick = live ? member.nick : identity.nick;
    return {
      id: identity.id,
      serverName: nick || globalName || username,
      username,
      globalName,
      nick,
      membership: member.membership,
      source: live ? "live" : "login",
    };
  }

  function toEditable(
    stored: StoredProfile,
    names: DiscordNames,
    countries: readonly CountryOption[],
  ): EditableProfile {
    const country = normalizeText(stored.country).toLowerCase();
    const switchRow = stored.codes
      .filter((row) => row.gameType === SWITCH_GAME_TYPE)
      .sort((a, b) => a.lineSeq - b.lineSeq)[0];
    const mscCodes = stored.codes
      .filter((row) => row.gameType === MSC_GAME_TYPE)
      .sort(compareMscRows)
      .map((row) => ({ region: row.region.trim().toUpperCase(), platform: row.label.trim(), code: row.code.trim() }));
    return {
      playerId: stored.playerId,
      version: profileVersion(stored),
      discord: names,
      country,
      switchCode: switchRow ? switchRow.code.trim() : "",
      mscCodes,
      countries: offeredCountries(countries, country),
    };
  }

  function playerDiscordId(identity: DiscordIdentity): string {
    const discordId = normalizeDiscordId(identity.id);
    if (!discordId) throw new HttpError(400, "BAD_REQUEST", "Invalid Discord user id.");
    return discordId;
  }

  type Decided =
    | { readonly kind: "saved"; readonly changed: boolean; readonly current: StoredProfile }
    | { readonly kind: "invalid"; readonly errors: readonly FieldError[] }
    | { readonly kind: "taken"; readonly errors: readonly FieldError[] }
    | { readonly kind: "conflict"; readonly current: StoredProfile };

  return {
    async ensurePlayer(identity) {
      return store.ensurePlayer(playerDiscordId(identity), playerNameFromDiscord(identity));
    },

    async getEditableProfile(identity) {
      const playerId = await store.findPlayerId(playerDiscordId(identity));
      if (playerId === null) return null;
      const [stored, names, countries] = await Promise.all([
        store.readProfile(playerId),
        discordNames(identity),
        store.countries(),
      ]);
      return toEditable(stored, names, countries);
    },

    async saveEditableProfile(identity, body) {
      const discordId = playerDiscordId(identity);
      const names = await discordNames(identity);
      // Membership was checked at login; a member who has left since cannot change the profile.
      if (names.membership === "not_member") return { kind: "not_member" };
      const requestedVersion = (body as { version?: unknown } | null)?.version;
      const version = typeof requestedVersion === "string" ? requestedVersion : "";
      const countries = await store.countries();
      const { playerId } = await store.ensurePlayer(discordId, playerNameFromDiscord(identity));
      let added: readonly DesiredCode[] = [];

      const decide = (current: StoredProfile, taken: readonly CodeKey[]): SaveDecision<Decided> => {
        const currentCountry = normalizeText(current.country).toLowerCase();
        const allowed = new Set(offeredCountries(countries, currentCountry).map((country) => country.code));
        const stored = new Map(
          current.codes
            .filter((row) => row.gameType === MSC_GAME_TYPE)
            .map((row) => [`${row.region.trim().toUpperCase()}:${row.code.trim()}`, row.label.trim()]),
        );
        const checked = validateEditableProfile(body, {
          isAllowedCountry: (code) => allowed.has(code),
          storedPlatform: (region, code) => stored.get(`${region}:${code}`) ?? null,
        });
        if (!checked.ok) return { plan: null, audit: "", result: { kind: "invalid", errors: checked.errors } };
        const desired = desiredCodes(checked.value);
        const plan = planChanges(current, checked.value.country, desired);
        // Asking for what is saved already succeeds, also with an old version (a double click).
        if (!plan) return { plan: null, audit: "", result: { kind: "saved", changed: false, current } };
        if (version !== profileVersion(current))
          return { plan: null, audit: "", result: { kind: "conflict", current } };
        const takenKeys = new Set(taken.map((key) => `${key.gameType}:${key.code}`));
        const takenErrors = desired
          .filter((row) => takenKeys.has(`${row.gameType}:${row.code}`))
          .map((row) => fieldError(row.field, "TAKEN"));
        if (takenErrors.length) return { plan: null, audit: "", result: { kind: "taken", errors: takenErrors } };
        added = desired.filter((row) =>
          plan.inserts.some((insert) => insert.gameType === row.gameType && insert.code === row.code),
        );
        return { plan, audit: audit(identity, current, plan), result: { kind: "saved", changed: true, current } };
      };

      let decided: Decided;
      try {
        decided = await store.saveProfile(playerId, requestedCodeKeys(body), decide);
      } catch (error) {
        // Another profile saved the same code between the check and the insert (unique index).
        if (isUniqueViolation(error) && added.length) {
          return { kind: "taken", errors: added.map((row) => fieldError(row.field, "TAKEN")) };
        }
        throw error;
      }

      if (decided.kind === "invalid" || decided.kind === "taken") return { kind: decided.kind, errors: decided.errors };
      if (decided.kind === "conflict")
        return { kind: "conflict", current: toEditable(decided.current, names, countries) };
      if (!decided.changed)
        return { kind: "saved", changed: false, profile: toEditable(decided.current, names, countries) };
      onChange?.();
      return { kind: "saved", changed: true, profile: toEditable(await store.readProfile(playerId), names, countries) };
    },
  };
}
