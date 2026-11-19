// Striker Clubs as robotic_nightmare and the database keep them (dbo.Club, dbo.ClubRoster), and the fixed values
// of club management on the website: the game's lists (regions, uniform colours, stadiums), the shape of names,
// tags, club codes and Discord links, and the club's backend id. Clubs are mainly a Mario Strikers: Battle League
// feature: club codes, stadiums and uniform colours are MSBL's. The lists come from the game and do not grow.

/** dbo.Club.Region/Region2/Region3 values, in the bot's order. */
export const CLUB_REGIONS = [
  { value: "EU", label: "Europe" },
  { value: "NA", label: "North America" },
  { value: "SA", label: "South America" },
  { value: "SSA", label: "Africa" },
  { value: "APAC", label: "Asia" },
  { value: "OCE", label: "Oceania" },
  { value: "MENA", label: "Middle East" },
  { value: "Other", label: "Other Regions" },
] as const;

/** dbo.Club.IsOpen: an open club takes anyone at once, an invite-only club takes invited players only. */
export const CLUB_STATUS_OPEN = "Open to Anyone";
export const CLUB_STATUS_INVITE_ONLY = "Invite Only";

/**
 * The game's twelve uniform colours (dbo.Club.Color1/Color2). A club picks two or none, one from each group.
 */
export const CLUB_UNIFORMS_WARM = ["Red", "Pink", "Orange", "Yellow", "Lime", "Green"] as const;
export const CLUB_UNIFORMS_COOL = ["Black", "Grey", "Blue", "Violet", "Lavender", "Turquoise"] as const;
export const CLUB_UNIFORMS = [...CLUB_UNIFORMS_WARM, ...CLUB_UNIFORMS_COOL] as const;

/** The game's eight stadiums (dbo.Club.Stadium). */
export const CLUB_STADIUMS = [
  "Lava Castle",
  "Spooky Mansion",
  "Jungle Retreat",
  "Mushroom Hill",
  "Royal Castle",
  "Desert Ruin",
  "Planetoid",
  "Urban Rooftop",
] as const;

export type ClubRegion = (typeof CLUB_REGIONS)[number]["value"];
export type ClubUniform = (typeof CLUB_UNIFORMS)[number];
export type ClubStadium = (typeof CLUB_STADIUMS)[number];

/** At most this many regions and club codes; a club needs at least one of each. */
export const MAX_CLUB_REGIONS = 3;
export const MAX_CLUB_CODES = 3;

/** New names: letters, digits and spaces (dbo.Club.ClubName is nvarchar(50)); older names keep what they have. */
export const CLUB_NAME_MAX_LENGTH = 50;
export const CLUB_NAME_PATTERN = /^[A-Za-z0-9 ]+$/;
/** New tags: letters and digits (dbo.Club.ClanTag is nvarchar(5)); older tags keep what they have. */
export const CLUB_TAG_MAX_LENGTH = 5;
export const CLUB_TAG_PATTERN = /^[A-Za-z0-9]+$/;
/** Tags no club may use, in any case: they would look like staff in a nickname. */
export const BLOCKED_CLUB_TAGS: readonly string[] = ["MOD", "ADMIN", "ADM", "OWNER"];
/** An MSBL club code: exactly seven letters or digits. */
export const CLUB_CODE_PATTERN = /^[A-Za-z0-9]{7}$/;
/** dbo.Club.DiscordServer is nvarchar(100). */
export const CLUB_DISCORD_URL_MAX_LENGTH = 100;

/**
 * The club's backend id (dbo.Club.PublicId): eight characters of letters and digits without the look-alikes
 * 0, O, 1, l and I (57 symbols), case-sensitive. Shown in the Admin Panel only; Club.ID stays the key of
 * everything public.
 */
export const CLUB_PUBLIC_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const CLUB_PUBLIC_ID_LENGTH = 8;

export function isClubPublicId(value: string): boolean {
  if (value.length !== CLUB_PUBLIC_ID_LENGTH) return false;
  return Array.from(value).every((character) => CLUB_PUBLIC_ID_ALPHABET.includes(character));
}

/** A name as stored: trimmed, inner runs of whitespace as one space. */
export function normalizeClubName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** The key two names or two tags are compared by: case and spacing do not count. */
export function clubNameKey(value: string): string {
  return normalizeClubName(value).toUpperCase();
}

export function isBlockedClubTag(tag: string): boolean {
  return BLOCKED_CLUB_TAGS.includes(tag.trim().toUpperCase());
}

/** The region value for a value or label in any case ("eu", "Europe"), or "" when it is none. */
export function toClubRegion(value: string): ClubRegion | "" {
  const key = value.trim().toLowerCase();
  const region = CLUB_REGIONS.find((entry) => entry.value.toLowerCase() === key || entry.label.toLowerCase() === key);
  return region ? region.value : "";
}

/** The colour for a value in any case, or "" when it is none of the twelve. */
export function toClubUniform(value: string): ClubUniform | "" {
  const key = value.trim().toLowerCase();
  return CLUB_UNIFORMS.find((uniform) => uniform.toLowerCase() === key) ?? "";
}

/** Two colours fit when one is warm and the other cool. */
export function isUniformPair(first: ClubUniform, second: ClubUniform): boolean {
  const warm = (uniform: ClubUniform): boolean => (CLUB_UNIFORMS_WARM as readonly string[]).includes(uniform);
  return warm(first) !== warm(second);
}

/** The stadium for a value in any case, or "" when it is none of the eight. */
export function toClubStadium(value: string): ClubStadium | "" {
  const key = value.trim().toLowerCase();
  return CLUB_STADIUMS.find((stadium) => stadium.toLowerCase() === key) ?? "";
}

/** A Discord invite link (discord.gg/<code>, discord.com/invite/<code>, discordapp.com/invite/<code>). */
export function isDiscordInviteUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "discord.gg") return parts.length >= 1;
  if (host === "discord.com" || host === "discordapp.com")
    return parts[0]?.toLowerCase() === "invite" && parts.length >= 2;
  return false;
}
