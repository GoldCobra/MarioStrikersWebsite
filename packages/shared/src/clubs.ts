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

/**
 * F6: an uploaded logo — PNG, JPG or WebP (no GIF, no SVG), at most 2 MB, between 256×256 and 2048×2048 pixels; it is
 * stored fitted into 512×512 (the club popup shows it at 330 px, the list at 100 px).
 */
export const CLUB_LOGO_LIMITS = {
  types: ["image/png", "image/jpeg", "image/webp"],
  maxBytes: 2 * 1024 * 1024,
  minSide: 256,
  maxSide: 2048,
  outputSide: 512,
} as const;

/** The numbers of the club rules, for the API's decisions and the page's explanations. */
export const CLUB_LIMITS = {
  /** Officers besides the captain. */
  maxOfficers: 3,
  maxOpenInvitations: 10,
  /** An invitation expires after this. */
  invitationDays: 7,
  /** The same club invites the same player again this long after its previous invitation at the earliest. */
  reinviteDays: 14,
  /** After leaving or being removed, joining a club by oneself waits this long (an invitation does not). */
  leaveCooldownHours: 1,
  /** A removed member cannot rejoin that club for this long (an invitation lifts it). */
  rejoinBlockDays: 14,
  /** A member who left the Discord server is removed from the club after this. */
  absenceDays: 14,
  /** Time on the Discord server before a player may create a club. */
  createServerDays: 14,
  /** Time between two clubs a player creates. */
  createCooldownDays: 30,
  /** A new club alone (only its captain) this long after its creation is marked inactive… */
  newClubAloneDays: 30,
  /** …and deleted this long after the mark… */
  newClubDeletionDays: 14,
  /** …unless it has had two members this many days in a row (then only the activity rule applies). */
  streakDays: 7,
  /** A club is shown active while its activity date is at most this old. */
  activityDays: 90,
} as const;

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

// ---------------------------------------------------------------------------------------------------
// My Club's requests: the settings { is_open, regions, club_codes, first_uniform, second_uniform, stadium,
// discord_url } and a new club, which adds { name, tag }. The page checks them while typing, the API on every
// request.

export interface ClubSettingsValue {
  readonly isOpen: boolean;
  /** Region values; a club saved before the rules may have none until its next save. */
  readonly regions: readonly string[];
  readonly clubCodes: readonly string[];
  /** Two colours of the list, or both "" (an older club may keep an older pair while it is left unchanged). */
  readonly firstUniform: string;
  readonly secondUniform: string;
  /** A stadium of the list, or "". */
  readonly stadium: string;
  /** A Discord invite link, or "". */
  readonly discordUrl: string;
}

export interface NewClubValue {
  readonly name: string;
  readonly tag: string;
  readonly settings: ClubSettingsValue;
}

export type ClubFieldErrorCode =
  "REQUIRED" | "INVALID" | "TOO_LONG" | "TOO_MANY" | "DUPLICATE" | "BLOCKED" | "UNIFORM_PAIR" | "UNIFORM_GROUPS";

export interface ClubFieldError {
  /** "name", "tag", "is_open", "regions", "club_codes", "club_codes.<index>", "uniforms", "stadium", "discord_url". */
  readonly field: string;
  readonly code: ClubFieldErrorCode;
  readonly message: string;
}

const CLUB_FIELD_MESSAGES: Readonly<Record<string, Partial<Record<ClubFieldErrorCode, string>>>> = {
  request: { INVALID: "This request is not valid." },
  name: {
    REQUIRED: "Enter the club's name.",
    INVALID: "Use letters, digits and spaces only.",
    TOO_LONG: `At most ${CLUB_NAME_MAX_LENGTH} characters.`,
  },
  tag: {
    REQUIRED: "Enter the club's tag.",
    INVALID: "Use letters and digits only.",
    TOO_LONG: `At most ${CLUB_TAG_MAX_LENGTH} characters.`,
    BLOCKED: "This tag cannot be used.",
  },
  is_open: { INVALID: "Select who can join the club." },
  regions: {
    REQUIRED: "Select at least one region.",
    INVALID: "Select regions from the list.",
    TOO_MANY: `Select at most ${MAX_CLUB_REGIONS} regions.`,
    DUPLICATE: "Select each region once.",
  },
  club_codes: {
    REQUIRED: "Enter at least one club code.",
    INVALID: "A club code has exactly 7 letters or digits.",
    TOO_MANY: `Enter at most ${MAX_CLUB_CODES} club codes.`,
    DUPLICATE: "This club code is entered twice.",
  },
  uniforms: {
    INVALID: "Select colours from the list.",
    UNIFORM_PAIR: "Select both uniform colours, or none.",
    UNIFORM_GROUPS: "Select one colour from each group.",
  },
  stadium: { INVALID: "Select a stadium from the list." },
  discord_url: {
    INVALID: "Enter a Discord invite link (discord.gg/…).",
    TOO_LONG: `At most ${CLUB_DISCORD_URL_MAX_LENGTH} characters.`,
  },
};

export function clubFieldError(field: string, code: ClubFieldErrorCode): ClubFieldError {
  const group = field.split(".")[0] ?? field;
  return { field, code, message: CLUB_FIELD_MESSAGES[group]?.[code] ?? "This value is not valid." };
}

export type ClubValidation<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly ClubFieldError[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A text field: absent or null is "", a string is trimmed, anything else null (invalid). */
function textOf(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

/** A list of texts without blank entries; null when it is no list of strings. */
function listOf(record: Record<string, unknown>, key: string): string[] | null {
  const value = record[key] ?? [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return null;
  return value.map((entry) => entry.trim()).filter(Boolean);
}

/**
 * The settings rules (F2, F4, F8): who can join, 1–3 regions and 1–3 club codes, both uniform colours from
 * opposite groups or none, a stadium of the list, a Discord invite link. `stored` is what the club has saved: an
 * older uniform pair, stadium or link that breaks today's rules may stay while it is left unchanged.
 */
export function validateClubSettings(raw: unknown, stored?: ClubSettingsValue): ClubValidation<ClubSettingsValue> {
  if (!isRecord(raw)) return { ok: false, errors: [clubFieldError("request", "INVALID")] };
  const errors: ClubFieldError[] = [];

  const isOpen = raw.is_open;
  if (typeof isOpen !== "boolean") errors.push(clubFieldError("is_open", "INVALID"));

  const regionTexts = listOf(raw, "regions");
  const regions: string[] = [];
  if (regionTexts === null) errors.push(clubFieldError("regions", "INVALID"));
  else {
    for (const text of regionTexts) {
      const region = toClubRegion(text);
      if (!region) errors.push(clubFieldError("regions", "INVALID"));
      else if (regions.includes(region)) errors.push(clubFieldError("regions", "DUPLICATE"));
      else regions.push(region);
    }
    if (!regionTexts.length) errors.push(clubFieldError("regions", "REQUIRED"));
    if (regionTexts.length > MAX_CLUB_REGIONS) errors.push(clubFieldError("regions", "TOO_MANY"));
  }

  const codeTexts = listOf(raw, "club_codes");
  const clubCodes: string[] = [];
  if (codeTexts === null) errors.push(clubFieldError("club_codes", "INVALID"));
  else {
    codeTexts.forEach((code, index) => {
      if (!CLUB_CODE_PATTERN.test(code)) errors.push(clubFieldError(`club_codes.${index}`, "INVALID"));
      else if (clubCodes.some((entry) => entry.toUpperCase() === code.toUpperCase())) {
        errors.push(clubFieldError(`club_codes.${index}`, "DUPLICATE"));
      } else clubCodes.push(code);
    });
    if (!codeTexts.length) errors.push(clubFieldError("club_codes", "REQUIRED"));
    if (codeTexts.length > MAX_CLUB_CODES) errors.push(clubFieldError("club_codes", "TOO_MANY"));
  }

  let firstUniform = textOf(raw, "first_uniform");
  let secondUniform = textOf(raw, "second_uniform");
  const keptPair = firstUniform === stored?.firstUniform && secondUniform === stored.secondUniform;
  if (firstUniform === null || secondUniform === null) errors.push(clubFieldError("uniforms", "INVALID"));
  else if (!keptPair && (firstUniform || secondUniform)) {
    const first = toClubUniform(firstUniform);
    const second = toClubUniform(secondUniform);
    if (!firstUniform || !secondUniform) errors.push(clubFieldError("uniforms", "UNIFORM_PAIR"));
    else if (!first || !second) errors.push(clubFieldError("uniforms", "INVALID"));
    else if (!isUniformPair(first, second)) errors.push(clubFieldError("uniforms", "UNIFORM_GROUPS"));
    else {
      firstUniform = first;
      secondUniform = second;
    }
  }

  let stadium = textOf(raw, "stadium");
  if (stadium === null) errors.push(clubFieldError("stadium", "INVALID"));
  else if (stadium && stadium !== stored?.stadium) {
    const known = toClubStadium(stadium);
    if (!known) errors.push(clubFieldError("stadium", "INVALID"));
    else stadium = known;
  }

  const discordUrl = textOf(raw, "discord_url");
  if (discordUrl === null) errors.push(clubFieldError("discord_url", "INVALID"));
  else if (discordUrl && discordUrl !== stored?.discordUrl) {
    if (discordUrl.length > CLUB_DISCORD_URL_MAX_LENGTH) errors.push(clubFieldError("discord_url", "TOO_LONG"));
    else if (!isDiscordInviteUrl(discordUrl)) errors.push(clubFieldError("discord_url", "INVALID"));
  }

  if (
    errors.length ||
    typeof isOpen !== "boolean" ||
    firstUniform === null ||
    secondUniform === null ||
    stadium === null ||
    discordUrl === null
  ) {
    return { ok: false, errors };
  }
  return { ok: true, value: { isOpen, regions, clubCodes, firstUniform, secondUniform, stadium, discordUrl } };
}

/** A new club (C1, F2, F3): a name of letters, digits and spaces, a tag of letters and digits, and its settings. */
export function validateNewClub(raw: unknown): ClubValidation<NewClubValue> {
  if (!isRecord(raw)) return { ok: false, errors: [clubFieldError("request", "INVALID")] };
  const errors: ClubFieldError[] = [];

  const nameText = textOf(raw, "name");
  const name = nameText === null ? "" : normalizeClubName(nameText);
  if (nameText === null) errors.push(clubFieldError("name", "INVALID"));
  else if (!name) errors.push(clubFieldError("name", "REQUIRED"));
  else if (name.length > CLUB_NAME_MAX_LENGTH) errors.push(clubFieldError("name", "TOO_LONG"));
  else if (!CLUB_NAME_PATTERN.test(name)) errors.push(clubFieldError("name", "INVALID"));

  const tag = textOf(raw, "tag");
  if (tag === null) errors.push(clubFieldError("tag", "INVALID"));
  else if (!tag) errors.push(clubFieldError("tag", "REQUIRED"));
  else if (tag.length > CLUB_TAG_MAX_LENGTH) errors.push(clubFieldError("tag", "TOO_LONG"));
  else if (!CLUB_TAG_PATTERN.test(tag)) errors.push(clubFieldError("tag", "INVALID"));
  else if (isBlockedClubTag(tag)) errors.push(clubFieldError("tag", "BLOCKED"));

  const settings = validateClubSettings(raw);
  if (!settings.ok) errors.push(...settings.errors);
  if (errors.length || !settings.ok || tag === null) return { ok: false, errors };
  return { ok: true, value: { name, tag, settings: settings.value } };
}
