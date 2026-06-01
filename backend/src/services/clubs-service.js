const { withPool } = require("../db");
const { defaultClubLogoCache, normalizeSourceUrl } = require("./club-logo-cache");
const { resolveDiscordNamesForRoster } = require("./discord-users-service");
const { normalizeCountryCode } = require("./flag-codes");

const CLUB_LOGO_EXCLUSION_RULES = [
  { tags: ["strk"], names: ["i be strikin", "i be stirkin"] },
  { tags: ["bros"], names: ["hammer bros"] }
];
const DEFAULT_ACTIVITY_WINDOW_DAYS = 90;

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

function normalizeTagKey(value) {
  return normalizeKey(value).replace(/[^a-z0-9]/g, "");
}

function normalizeNameKey(value) {
  return normalizeKey(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isExcludedClubLogo(tag, name) {
  const normalizedTag = normalizeTagKey(tag);
  const normalizedName = normalizeNameKey(name);
  return CLUB_LOGO_EXCLUSION_RULES.some(function (rule) {
    const tagMatch = Array.isArray(rule.tags) && rule.tags.some(function (tagKey) {
      return normalizeTagKey(tagKey) === normalizedTag;
    });
    const nameMatch = Array.isArray(rule.names) && rule.names.some(function (nameKey) {
      const key = normalizeNameKey(nameKey);
      return normalizedName === key || normalizedName.includes(key);
    });
    return tagMatch || nameMatch;
  });
}

function normalizeMemberCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function normalizeLogoSource(value) {
  return normalizeSourceUrl(value);
}

function extractDiscordId(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  const mentionMatch = text.match(/<@!?(\d+)>/);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  return /^\d+$/.test(text) ? text : "";
}

function extractMentionSuffixName(value) {
  const text = normalizeText(value);
  if (!text.startsWith("<@")) {
    return "";
  }
  const closeIndex = text.indexOf(">");
  if (closeIndex === -1) {
    return "";
  }
  return normalizeText(text.slice(closeIndex + 1));
}

function extractDiscordName(value) {
  return extractMentionSuffixName(value);
}

function normalizeActivityDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date;
}

function toActivityIso(value) {
  const date = normalizeActivityDate(value);
  return date ? date.toISOString() : null;
}

function isActivityActive(value, now, activityWindowDays) {
  const activity = normalizeActivityDate(value);
  const reference = normalizeActivityDate(now) || new Date();
  const windowDays = Number.isFinite(Number(activityWindowDays))
    ? Number(activityWindowDays)
    : DEFAULT_ACTIVITY_WINDOW_DAYS;

  if (!activity || windowDays <= 0) {
    return false;
  }

  return reference.getTime() - activity.getTime() <= windowDays * 24 * 60 * 60 * 1000;
}

function resolveStatus(joinConditions, isOpen) {
  const joinText = normalizeText(joinConditions);
  if (joinText) {
    return joinText;
  }
  if (isOpen === true || isOpen === 1) {
    return "Open to Anyone";
  }
  if (isOpen === false || isOpen === 0) {
    return "Invite Only";
  }
  return "";
}

async function getMsblClubs() {
  const opts = arguments[0] || {};
  const logoCache = opts.logoCache ? opts.logoCache : defaultClubLogoCache;
  const now = opts.now || new Date();
  const activityWindowDays = opts.activityWindowDays || DEFAULT_ACTIVITY_WINDOW_DAYS;
  return withPool(async function (pool) {
    const result = await pool.request().query(
      [
        "SELECT",
        "  c.ID AS club_id,",
        "  c.ClanTag AS tag,",
        "  c.ClubName AS name,",
        "  c.JoinConditions AS join_conditions,",
        "  c.IsOpen AS is_open,",
        "  c.Region AS region,",
        "  c.ClubCode AS club_code,",
        "  c.Logo AS logo,",
        "  c.Activity AS activity,",
        "  COUNT(cr.Player) AS member_count",
        "FROM Club c",
        "LEFT JOIN ClubRoster cr ON cr.Club = c.ID",
        "GROUP BY c.ID, c.ClanTag, c.ClubName, c.JoinConditions, c.IsOpen, c.Region, c.ClubCode, c.Logo, c.Activity",
        "HAVING COUNT(cr.Player) > 0",
        "ORDER BY COUNT(cr.Player) DESC, LTRIM(RTRIM(ISNULL(c.ClubName, ''))) ASC, LTRIM(RTRIM(ISNULL(c.ClanTag, ''))) ASC"
      ].join(" ")
    );

    const rows = (Array.isArray(result && result.recordset) ? result.recordset : [])
      .map(function (row) {
        return toMsblClubDTO(row, { now, activityWindowDays });
      })
      .filter(Boolean);

    return attachClubLogos(rows, logoCache);
  });
}

function rolePriority(row) {
  if (row && row.is_owner) {
    return 0;
  }
  if (row && row.is_officer) {
    return 1;
  }
  return 2;
}

function compareRosterRows(a, b) {
  const roleDiff = rolePriority(a) - rolePriority(b);
  if (roleDiff !== 0) {
    return roleDiff;
  }

  const nameA = normalizeText(a && a.name).toLowerCase();
  const nameB = normalizeText(b && b.name).toLowerCase();
  if (nameA !== nameB) {
    return nameA < nameB ? -1 : 1;
  }

  const idA = Number(a && a.player_id) || 0;
  const idB = Number(b && b.player_id) || 0;
  return idA - idB;
}

function toRosterRole(isOwner, isOfficer) {
  if (isOwner) {
    return "owner";
  }
  if (isOfficer) {
    return "officer";
  }
  return "member";
}

function buildRosterRow(row, ownerDiscordId) {
  const discordId = extractDiscordId(row && row.discord_id);
  const isOwner = !!ownerDiscordId && discordId === ownerDiscordId;
  const isOfficer = row && (row.is_officer === true || row.is_officer === 1);
  const name = normalizeText(row && row.name) || "Unknown";

  return {
    player_id: Number(row && row.player_id) || null,
    name: name,
    country: normalizeCountryCode(row && row.country),
    discord_id: discordId || normalizeText(row && row.discord_id),
    discord_name: extractDiscordName(row && row.discord_id),
    is_owner: isOwner,
    is_officer: isOwner ? false : !!isOfficer,
    role: toRosterRole(isOwner, isOwner ? false : !!isOfficer)
  };
}

async function findOwnerPlayer(pool, ownerDiscordId) {
  if (!ownerDiscordId) {
    return null;
  }

  const request = pool.request();
  request.input("ownerDid", ownerDiscordId);
  request.input("ownerMention", "<@" + ownerDiscordId + ">");
  request.input("ownerMentionBang", "<@!" + ownerDiscordId + ">");

  const result = await request.query(
    [
      "SELECT TOP 1",
      "  p.ID AS player_id,",
      "  p.Name AS name,",
      "  p.Country AS country,",
      "  p.DiscordID AS discord_id",
      "FROM Player p",
      "WHERE p.DiscordID = @ownerDid",
      "   OR p.DiscordID = @ownerMention",
      "   OR p.DiscordID = @ownerMentionBang",
      "ORDER BY",
      "  CASE",
      "    WHEN p.DiscordID = @ownerDid THEN 0",
      "    WHEN p.DiscordID = @ownerMentionBang THEN 1",
      "    ELSE 2",
      "  END,",
      "  p.ID DESC"
    ].join(" ")
  );

  const rows = Array.isArray(result && result.recordset) ? result.recordset : [];
  return rows[0] || null;
}

async function getMsblClubProfile(clubIdRaw) {
  const clubId = toPositiveInt(clubIdRaw);
  if (!clubId) {
    throw new Error("Invalid club id.");
  }

  const opts = arguments[1] || {};
  const logoCache = opts.logoCache ? opts.logoCache : defaultClubLogoCache;

  return withPool(async function (pool) {
    const clubRequest = pool.request();
    clubRequest.input("clubId", clubId);
    const clubResult = await clubRequest.query(
      [
        "SELECT TOP 1",
        "  c.ID AS club_id,",
        "  c.ClanTag AS tag,",
        "  c.ClubName AS name,",
        "  c.JoinConditions AS join_conditions,",
        "  c.IsOpen AS is_open,",
        "  c.Region AS region,",
        "  c.ClubCode AS club_code,",
        "  c.DiscordServer AS discord_server,",
        "  c.Logo AS logo,",
        "  c.Owner AS owner_raw,",
        "  c.CreatedAtUtc AS created_at",
        "FROM Club c",
        "WHERE c.ID = @clubId"
      ].join(" ")
    );

    const clubRows = Array.isArray(clubResult && clubResult.recordset) ? clubResult.recordset : [];
    const clubRow = clubRows[0];
    if (!clubRow) {
      throw new Error("Club not found.");
    }

    const ownerRaw = normalizeText(clubRow.owner_raw);
    const ownerDiscordId = extractDiscordId(ownerRaw);

    const rosterRequest = pool.request();
    rosterRequest.input("clubId", clubId);
    const rosterResult = await rosterRequest.query(
      [
        "SELECT",
        "  p.ID AS player_id,",
        "  p.Name AS name,",
        "  p.Country AS country,",
        "  p.DiscordID AS discord_id,",
        "  cr.IsOfficer AS is_officer",
        "FROM ClubRoster cr",
        "INNER JOIN Player p ON p.ID = cr.Player",
        "WHERE cr.Club = @clubId"
      ].join(" ")
    );

    const rawRosterRows = Array.isArray(rosterResult && rosterResult.recordset)
      ? rosterResult.recordset
      : [];
    const rosterRows = rawRosterRows.map(function (row) {
      return buildRosterRow(row, ownerDiscordId);
    });

    let ownerInRoster = rosterRows.some(function (row) { return row.is_owner; });
    const ownerLookup = ownerInRoster ? null : await findOwnerPlayer(pool, ownerDiscordId);

    if (!ownerInRoster && ownerDiscordId) {
      rosterRows.push({
        player_id: Number(ownerLookup && ownerLookup.player_id) || null,
        name: normalizeText(ownerLookup && ownerLookup.name) || extractMentionSuffixName(ownerRaw) || "Unknown Owner",
        country: normalizeCountryCode(ownerLookup && ownerLookup.country),
        discord_id: ownerDiscordId,
        discord_name: extractDiscordName(ownerLookup && ownerLookup.discord_id) || extractDiscordName(ownerRaw),
        is_owner: true,
        is_officer: false,
        role: "owner"
      });
      ownerInRoster = true;
    }

    await resolveDiscordNamesForRoster(rosterRows);
    rosterRows.sort(compareRosterRows);

    const ownerRow = rosterRows.find(function (row) { return row.is_owner; }) || null;
    const ownerName = normalizeText(ownerRow && ownerRow.name)
      || normalizeText(ownerLookup && ownerLookup.name)
      || extractMentionSuffixName(ownerRaw)
      || "";
    const ownerDid = normalizeText(ownerRow && rowDiscordId(ownerRow)) || ownerDiscordId || "";

    const clubDto = toMsblClubDTO(clubRow, {});
    await attachClubLogos([clubDto], logoCache);

    return {
      club: {
        club_id: clubDto.club_id,
        name: clubDto.name,
        tag: clubDto.tag,
        join_conditions: clubDto.status,
        region: clubDto.region,
        club_code: clubDto.club_code,
        discord_server: normalizeText(clubRow.discord_server),
        created_at: toActivityIso(clubRow.created_at),
        logo: clubDto.logo,
        owner_name: ownerName,
        owner_discord_id: ownerDid
      },
      roster: rosterRows.map(function (row) {
        return {
          player_id: row.player_id,
          name: row.name,
          country: row.country,
          discord_id: rowDiscordId(row),
          discord_name: row.discord_name,
          is_owner: row.is_owner,
          is_officer: row.is_officer,
          role: row.role
        };
      })
    };
  });
}

function rowDiscordId(row) {
  const normalized = extractDiscordId(row && row.discord_id);
  return normalized || normalizeText(row && row.discord_id);
}

function toMsblClubDTO(row, opts) {
  const options = opts || {};
  const tag = normalizeText(row && row.tag);
  const name = normalizeText(row && row.name);
  const isOpen = row ? row.is_open : null;
  const logoSource = normalizeLogoSource(row && row.logo);
  const activity = toActivityIso(row && row.activity);

  if (!tag && !name) {
    return null;
  }

  return {
    club_id: Number(row && row.club_id) || null,
    tag: tag,
    name: name,
    status: resolveStatus(row && row.join_conditions, isOpen),
    is_open: isOpen === true || isOpen === 1,
    region: normalizeText(row && row.region),
    club_code: normalizeText(row && row.club_code),
    logo_source: isExcludedClubLogo(tag, name) ? "" : logoSource,
    logo: "",
    activity: activity,
    is_active: isActivityActive(row && row.activity, options.now, options.activityWindowDays),
    member_count: normalizeMemberCount(row && row.member_count)
  };
}

async function attachClubLogos(rows, logoCache) {
  const queue = rows.slice();
  const workerCount = Math.max(1, Math.min(4, queue.length || 1));

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (row.logo_source && logoCache && typeof logoCache.ensureClubLogo === "function") {
        row.logo = await logoCache.ensureClubLogo(row);
      }
      delete row.logo_source;
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return rows;
}

module.exports = {
  DEFAULT_ACTIVITY_WINDOW_DAYS,
  attachClubLogos,
  compareRosterRows,
  extractDiscordName,
  extractDiscordId,
  getMsblClubProfile,
  getMsblClubs,
  isActivityActive,
  normalizeCountryCode,
  toActivityIso,
  toRosterRole,
  toMsblClubDTO,
  normalizeLogoSource
};
