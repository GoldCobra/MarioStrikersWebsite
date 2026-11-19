// Maps club and roster rows to the public DTOs.

import { normalizeCountryCode } from "@ms/shared/countries";
import { normalizeText, toText } from "@ms/shared/text";
import { isActivityActive, toActivityIso } from "../../lib/dates.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import { normalizeSourceUrl } from "./logo-cache.ts";
import type { InviteCandidate, MyClubView } from "./management.ts";
import type { ClubRefusal } from "./rules.ts";

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

/** The logo route's URL of an uploaded logo (dbo.ClubLogo), with its hash; "" without one. */
export function uploadedLogoUrl(clubId: unknown, hash: unknown): string {
  const id = Number(clubId);
  const key = normalizeText(hash);
  return key && Number.isInteger(id) && id > 0 ? `/api/clubs/msbl/${String(id)}/logo?v=${key}` : "";
}

/** The stored logo URL a club's logo is downloaded from; "" for none (and for logos that belong to someone else). */
export function clubLogoSource(tag: string, name: string, logo: unknown): string {
  return isExcludedClubLogo(tag, name) ? "" : normalizeSourceUrl(logo);
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
    // An uploaded logo (its hash in the URL) wins; else the stored link, downloaded into the logo cache.
    logo_source: normalizeText(row.logo_hash) ? "" : clubLogoSource(tag, name, row.logo),
    logo: uploadedLogoUrl(row.club_id, row.logo_hash),
    activity: toActivityIso(row.activity),
    // The 90-day rule; a new club the counter marked inactive (dbo.Club.InactiveSinceUtc) is inactive regardless.
    is_active: !row.inactive_since && isActivityActive(row.activity, options.now, options.activityWindowDays),
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

// ---------------------------------------------------------------------------------------------------
// My Club (management.ts) as the API sends it

const isoOrNull = (value: number | null): string | null => (value === null ? null : new Date(value).toISOString());

export function toRefusalBody(refusal: ClubRefusal): Record<string, unknown> {
  return {
    error: refusal.message,
    code: refusal.code,
    ...(refusal.until === undefined ? {} : { until: new Date(refusal.until).toISOString() }),
  };
}

export function toMyClubResponse(view: MyClubView): Record<string, unknown> {
  const { club } = view;
  return {
    player_id: view.playerId,
    club: club
      ? {
          club_id: club.clubId,
          name: club.name,
          tag: club.tag,
          logo: club.logo,
          is_open: club.settings.isOpen,
          status: resolveOpenStatus(club.settings.isOpen),
          regions: club.settings.regions,
          club_codes: club.settings.clubCodes,
          first_uniform: club.settings.firstUniform,
          second_uniform: club.settings.secondUniform,
          stadium: club.settings.stadium,
          discord_url: club.settings.discordUrl,
          settings_version: club.settingsVersion,
          activity: isoOrNull(club.activity),
          is_active: club.isActive,
          created_at: isoOrNull(club.createdAt),
          inactive_at: isoOrNull(club.inactiveAt),
          deletion_at: isoOrNull(club.deletionAt),
          role: club.role,
          permissions: {
            invite: club.permissions.invite,
            edit_settings: club.permissions.editSettings,
            confirm_activity: club.permissions.confirmActivity,
            promote: club.permissions.promote,
            delete_club: club.permissions.deleteClub,
            leave: club.permissions.leave,
          },
          officers: { count: club.officers.count, max: club.officers.max },
          members: club.members.map((member) => ({
            player_id: member.playerId,
            name: member.name,
            country: member.country,
            discord_name: member.discordName,
            role: member.role,
            joined_at: isoOrNull(member.joinedAt),
            absent: member.absent,
            actions: { ...member.actions },
          })),
          invitations: club.invitations.map((invitation) => ({
            id: invitation.id,
            player_id: invitation.playerId,
            name: invitation.name,
            invited_by: invitation.invitedBy,
            created_at: new Date(invitation.createdAt).toISOString(),
            expires_at: new Date(invitation.expiresAt).toISOString(),
          })),
        }
      : null,
    invitations: view.invitations.map((invitation) => ({
      id: invitation.id,
      club_id: invitation.clubId,
      club_name: invitation.clubName,
      club_tag: invitation.clubTag,
      invited_by: invitation.invitedBy,
      created_at: new Date(invitation.createdAt).toISOString(),
      expires_at: new Date(invitation.expiresAt).toISOString(),
    })),
    create: {
      allowed: view.create.allowed,
      reason: view.create.refusal ? toRefusalBody(view.create.refusal) : null,
    },
    join_cooldown_until: isoOrNull(view.joinCooldownUntil),
    join_blocks: view.joinBlocks.map((block) => ({
      club_id: block.clubId,
      until: new Date(block.until).toISOString(),
    })),
  };
}

export function toCandidatesResponse(result: {
  readonly candidates: readonly InviteCandidate[];
  readonly total: number;
  readonly page: number;
}): Record<string, unknown> {
  return {
    total: result.total,
    page: result.page,
    candidates: result.candidates.map((candidate) => ({
      player_id: candidate.playerId,
      name: candidate.name,
      discord_name: candidate.discordName,
      country: candidate.country,
      invitable_from: isoOrNull(candidate.blockedUntil),
    })),
  };
}
