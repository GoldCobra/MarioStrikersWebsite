const { withPool } = require("../db");

const CLUB_LOGO_EXCLUSION_RULES = [
  { tags: ["strk"], names: ["i be strikin", "i be stirkin"] },
  { tags: ["bros"], names: ["hammer bros"] }
];

function normalizeText(value) {
  return String(value || "").trim();
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

function normalizeLogo(value) {
  let text = String(value || "").trim();
  if (!text) {
    return "";
  }
  text = text.replace(/^[\s"'`]+|[\s"'`]+$/g, "").trim();
  if (!/^https?:\/\//i.test(text)) {
    return "";
  }
  function toStableDiscordCdn(urlObj) {
    const host = String(urlObj.hostname || "").toLowerCase();
    const path = String(urlObj.pathname || "");
    if (!/^\/attachments\/\d+\/\d+\/.+/.test(path)) {
      return null;
    }
    if (host === "media.discordapp.net" || host === "cdn.discordapp.com") {
      return "https://cdn.discordapp.com" + path;
    }
    return null;
  }
  try {
    const parsed = new URL(text);
    const stableDiscordUrl = toStableDiscordCdn(parsed);
    if (stableDiscordUrl) {
      return stableDiscordUrl;
    }
  } catch (_error) {
    return "";
  }
  return text;
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
        "  COUNT(cr.Player) AS member_count",
        "FROM Club c",
        "LEFT JOIN ClubRoster cr ON cr.Club = c.ID",
        "GROUP BY c.ID, c.ClanTag, c.ClubName, c.JoinConditions, c.IsOpen, c.Region, c.ClubCode, c.Logo",
        "HAVING COUNT(cr.Player) > 0",
        "ORDER BY LTRIM(RTRIM(ISNULL(c.ClubName, ''))) ASC, LTRIM(RTRIM(ISNULL(c.ClanTag, ''))) ASC"
      ].join(" ")
    );

    const rows = Array.isArray(result && result.recordset) ? result.recordset : [];
    return rows
      .map(function (row) {
        const tag = normalizeText(row && row.tag);
        const name = normalizeText(row && row.name);
        const isOpen = row ? row.is_open : null;
        const logo = normalizeLogo(row && row.logo);

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
          logo: isExcludedClubLogo(tag, name) ? "" : logo,
          member_count: normalizeMemberCount(row && row.member_count)
        };
      })
      .filter(Boolean);
  });
}

module.exports = {
  getMsblClubs
};
