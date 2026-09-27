// Maps club and roster rows to the public DTOs.

import { normalizeCountryCode } from "@ms/shared/countries";
import { normalizeText, toText } from "@ms/shared/text";
import { isActivityActive, toActivityIso } from "../../lib/dates.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import { normalizeSourceUrl } from "./logo-cache.ts";

type Row = Record<string, unknown>;

// Clubs whose stored logo belongs to someone else; they are shown without one.
const CLUB_LOGO_EXCLUSION_RULES: readonly { tags: readonly string[]; names: readonly string[] }[] = [
  { tags: ["strk"], names: ["i be strikin", "i be stirkin"] },
  { tags: ["bros"], names: ["hammer bros"] },
];

export interface ClubListItem {
  club_id: number | null;
  tag: string;
  name: string;
  status: string;
  is_open: boolean;
  region: string;
  club_code: string;
  club_codes: string[];
  regions: string[];
  /** Internal: the stored logo URL, replaced by the cached logo URL before the DTO leaves the API. */
  logo_source?: string;
  logo: string;
  activity: string | null;
  is_active: boolean;
  member_count: number;
}

export interface RosterRow {
  player_id: number | null;
  name: string;
  country: string;
  discord_id: string;
  discord_name: string;
  is_owner: boolean;
  is_officer: boolean;
  role: "owner" | "officer" | "member";
}

export interface ClubProfile {
  club: {
    club_id: number | null;
    name: string;
    tag: string;
    join_conditions: string;
    region: string;
    club_code: string;
    regions: string[];
    club_codes: string[];
    first_uniform: string;
    second_uniform: string;
    stadium: string;
    discord_server: string;
    created_at: string | null;
    logo: string;
    owner_name: string;
    owner_discord_id: string;
  };
  roster: RosterRow[];
}

export function compactTextList(values: readonly unknown[]): string[] {
  return values.map(normalizeText).filter(Boolean);
}

function normalizeKey(value: unknown): string {
  return toText(value).trim().toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

function normalizeTagKey(value: unknown): string {
  return normalizeKey(value).replace(/[^a-z0-9]/g, "");
}

function normalizeNameKey(value: unknown): string {
  return normalizeKey(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isExcludedClubLogo(tag: string, name: string): boolean {
  const tagKey = normalizeTagKey(tag);
  const nameKey = normalizeNameKey(name);
  return CLUB_LOGO_EXCLUSION_RULES.some(
    (rule) =>
      rule.tags.some((candidate) => normalizeTagKey(candidate) === tagKey) ||
      rule.names.some((candidate) => {
        const key = normalizeNameKey(candidate);
        return nameKey === key || nameKey.includes(key);
      }),
  );
}

function normalizeMemberCount(value: unknown): number {
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed < 0 ? 0 : Math.floor(parsed);
}

/** The display name stored after a mention, e.g. "<@123>goldcobra111" -> "goldcobra111". */
export function extractDiscordName(value: unknown): string {
  const text = normalizeText(value);
  if (!text.startsWith("<@")) return "";
  const closeIndex = text.indexOf(">");
  return closeIndex === -1 ? "" : normalizeText(text.slice(closeIndex + 1));
}

export function resolveOpenStatus(isOpen: unknown): string {
  if (isOpen === true || isOpen === 1) return "Open to Anyone";
  if (isOpen === false || isOpen === 0) return "Invite Only";
  return "";
}

function resolveStatus(joinConditions: unknown, isOpen: unknown): string {
  return normalizeText(joinConditions) || resolveOpenStatus(isOpen);
}

export function toMsblClubDTO(
  row: Row,
  options: { now?: unknown; activityWindowDays?: unknown } = {},
): ClubListItem | null {
  const tag = normalizeText(row.tag);
  const name = normalizeText(row.name);
  if (!tag && !name) return null;
  const isOpen = row.is_open === true || row.is_open === 1;
  return {
    club_id: Number(row.club_id) || null,
    tag,
    name,
    status: resolveStatus(row.join_conditions, row.is_open),
    is_open: isOpen,
    region: normalizeText(row.region),
    club_code: isOpen ? normalizeText(row.club_code) : "",
    club_codes: isOpen ? compactTextList([row.club_code, row.club_code2, row.club_code3]) : [],
    regions: compactTextList([row.region, row.region2, row.region3]),
    logo_source: isExcludedClubLogo(tag, name) ? "" : normalizeSourceUrl(row.logo),
    logo: "",
    activity: toActivityIso(row.activity),
    is_active: isActivityActive(row.activity, options.now, options.activityWindowDays),
    member_count: normalizeMemberCount(row.member_count),
  };
}

export function toRosterRole(isOwner: boolean, isOfficer: boolean): RosterRow["role"] {
  if (isOwner) return "owner";
  return isOfficer ? "officer" : "member";
}

function rolePriority(row: Pick<RosterRow, "is_owner" | "is_officer">): number {
  if (row.is_owner) return 0;
  return row.is_officer ? 1 : 2;
}

/** Owner first, then officers, then members, each alphabetically. */
export function compareRosterRows(
  a: Pick<RosterRow, "name" | "is_owner" | "is_officer" | "player_id">,
  b: Pick<RosterRow, "name" | "is_owner" | "is_officer" | "player_id">,
): number {
  const roleDiff = rolePriority(a) - rolePriority(b);
  if (roleDiff !== 0) return roleDiff;
  const nameA = normalizeText(a.name).toLowerCase();
  const nameB = normalizeText(b.name).toLowerCase();
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  return (Number(a.player_id) || 0) - (Number(b.player_id) || 0);
}

/** The owner is the roster member whose Discord id matches Club.Owner. */
export function buildRosterRow(row: Row, ownerDiscordId: string): RosterRow {
  const discordId = normalizeDiscordId(row.discord_id);
  const isOwner = Boolean(ownerDiscordId) && discordId === ownerDiscordId;
  const isOfficer = !isOwner && (row.is_officer === true || row.is_officer === 1);
  return {
    player_id: Number(row.player_id) || null,
    name: normalizeText(row.name) || "Unknown",
    country: normalizeCountryCode(row.country),
    discord_id: discordId || normalizeText(row.discord_id),
    discord_name: extractDiscordName(row.discord_id),
    is_owner: isOwner,
    is_officer: isOfficer,
    role: toRosterRole(isOwner, isOfficer),
  };
}
