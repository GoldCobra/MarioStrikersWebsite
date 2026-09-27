const crypto = require("node:crypto");
const path = require("node:path");
const { parseLimit, parseOffset } = require("../lib/leaderboard-params");
const { PLAYERS_LIST_KEY, MSBL_CLUBS_KEY, COMPETITIVE_SEASON_KEY } = require("../lib/public-data-keys");
const { createSignedToken, verifySignedToken, normalizeReturnTo, appendQuery } = require("../services/auth-service");

// Entirely invented development data. Never copy a production snapshot into this module.
// Shapes mirror the live API exactly so fixture pages render like production pages.
// Set MSC_FIXTURE_NOW (ISO date) to make every timestamp deterministic, e.g. for visual tests.

const DAY_MS = 86400000;
const ASSET_VERSION = "20260608-rank-crop-v1";
const RANK_NAMES = [
  "Unranked",
  "Bronze I", "Bronze II", "Bronze III",
  "Silver I", "Silver II", "Silver III",
  "Gold I", "Gold II", "Gold III",
  "Platinum I", "Platinum II", "Platinum III",
  "Diamond I", "Diamond II", "Diamond III",
  "Master I", "Master II", "Master III",
  "Strikers Titan"
];
const RANK_ICON_FILES = [
  "", "1-bronze-I.png", "1-bronze-II.png", "1-bronze-III.png", "2-silver-I.png", "2-silver-II.png",
  "2-silver-III.png", "3-gold-I.png", "3-gold-II.png", "3-gold-III.png", "4-platinum-I.png",
  "4-platinum-II.png", "4-platinum-III.png", "5-diamond-I.png", "5-diamond-II.png", "5-diamond-III.png",
  "6-master-I.png", "6-master-II.png", "6-master-III.png", "7-strikerstitan-b.png"
];
const REWARD_LEVELS = [
  ["Unranked", "0-unranked.png"], ["Bronze", "1-bronze.png"], ["Silver", "2-silver.png"], ["Gold", "3-gold.png"],
  ["Platinum", "4-platinum.png"], ["Diamond", "5-diamond.png"], ["Master", "6-master.png"],
  ["Strikers Titan", "7-strikerstitan-b.png"]
];
const PLAYER_NAMES = [
  "Sample Player", "Practice Partner", "Training Rookie", "Pixel Piranha", "Turbo Shell", "Banana Drift",
  "Chain Chomper", "Mega Striker", "Hyper Volley", "Koopa Kicker", "Lakitu Loop", "Cloud Keeper",
  "Zoë Ñandú", "Captain Incredibly Long Sample Name", "dotted.sample", "<i>Escaped Name</i>", "Player 42",
  "Rocket Toad", "Midfield Mushroom", "Goalie Gumba", "Thunder Boot", "Crystal Cleat", "Lava Lob",
  "Sand Tomb Sam", "Stormship Sky", "Galactic Goal", "Vice Versa", "Dump Truck Dan", "Wasteland Will",
  "Classroom Kid", "Sudden Death", "Results Rita", "Credits Carl", "Pause Menu", "Loading Lou",
  "Header Hank", "Volley Vera", "Bicycle Ben", "Nutmeg Nora", "Penalty Pete", "Offside Olly",
  "Corner Cora", "Free Kick Finn", "Throw-in Theo", "Extra Time Eve", "Golden Goal Gus", "Hat-trick Hal",
  "Last Minute Lin"
];
const COUNTRIES = ["de", "us", "gb", "gb-eng", "gb-sct", "gb-wls", "fr", "it", "es", "nl", "se", "jp", "kr",
  "br", "mx", "ca", "au", "ch", "pt", "", "ve", "be", "at", "no"];
const CLUB_DEFS = [
  ["Sample Strikers", "SMP", "Open to Anyone", "EU", ["EU"]],
  ["Demo United", "DEMO", "Invite Only", "NA", ["NA"]],
  ["Fixture FC", "FIX", "Open to Anyone", "NA", ["NA", "EU", "SA"]],
  ["Placeholder Athletic", "PLH", "Invite Only", "EU", ["EU"]],
  ["Mock Mushrooms", "MOCK", "Open to Anyone", "JP", ["JP"]],
  ["Synthetic Shells", "SYN", "Closed", "OCE", ["OCE"]],
  ["Test Toads", "TST", "Open to Anyone", "SA", ["SA", "NA"]],
  ["Example Eagles", "EXE", "Invite Only", "EU", ["EU", "NA"]],
  ["Dummy Dynamos", "DUM", "Open to Anyone", "NA", ["NA"]],
  ["Lorem Ipsum Legends Football Club", "LIL", "Open to Anyone", "EU", ["EU"]],
  ["Stub Stars", "STB", "Invite Only", "NA", ["NA"]],
  ["No Logo Club", "NLC", "Open to Anyone", "EU", ["EU"]]
];
const TOURNAMENTS = [
  ["MSL 2025 World Championship", "🥇", true],
  ["MSL 2026 Spring Series", "🥇", false],
  ["MSL 2025 Fall Series - Premier", "🥈", false],
  ["Sample Training Cup", "🥉", false],
  ["Community Weekly #12", "🥇", false],
  ["Demo Doubles Open", "🥈", false]
];

function resolveFixtureNow() {
  const raw = process.env.MSC_FIXTURE_NOW;
  if (!raw) return { now: Date.now(), pinned: false };
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error("Invalid MSC_FIXTURE_NOW; use an ISO date.");
  return { now: parsed, pinned: true };
}

// Small deterministic PRNG (mulberry32) so the invented data is identical on every start.
function createRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function versioned(url) {
  return url + "?v=" + ASSET_VERSION;
}

function rankIconUrl(rankNumber) {
  return rankNumber > 0
    ? versioned("/assets/leaderboards/rankicons/" + RANK_ICON_FILES[rankNumber])
    : versioned("/assets/players/rewardlevel/0-unranked.png");
}

function rewardLevel(order, extra) {
  const [name, image] = REWARD_LEVELS[order];
  return { order, name, image_url: versioned("/assets/players/rewardlevel/" + image), ...extra };
}

function rankNumberForRating(rating) {
  if (rating >= 1750) return 19;
  return Math.max(1, Math.min(18, Math.floor((rating - 400) / 75) + 1));
}

function fakeFriendCode(random, prefix) {
  const block = function () { return String(Math.floor(random() * 10000)).padStart(4, "0"); };
  return (prefix ? prefix + "-" : "") + block() + "-" + block() + "-" + block();
}

function createFixtureProviders() {
  if (process.env.NODE_ENV === "production") throw new Error("Fixtures cannot run in production.");
  const clock = resolveFixtureNow();
  const now = clock.now;
  const nowFn = function () { return clock.pinned ? now : Date.now(); };
  const generatedAt = new Date(now).toISOString();
  const random = createRandom(20260927);
  const iso = function (offsetMs) { return new Date(now + offsetMs).toISOString(); };

  const linkedUser = { id: "900000000000000001", username: "sample_player", global_name: "Sample Player", avatar: "" };
  const unlinkedUser = { id: "900000000000000002", username: "unlinked_sample", global_name: "Unlinked Sample", avatar: "" };
  const usersByCode = { sample: linkedUser, "sample-unlinked": unlinkedUser };

  const clubs = CLUB_DEFS.map(function ([name, tag, status, region, regions], index) {
    const clubId = index + 1;
    const hasLogo = tag !== "NLC";
    const codes = index % 3 === 2 ? [] : [String(1000000 + clubId * 7919).slice(0, 7), ...(index % 4 === 0 ? ["ABC" + clubId + "DEF"] : [])];
    return {
      club_id: clubId, tag, name, status, is_open: status === "Open to Anyone", region,
      club_code: codes[0] || "", club_codes: codes, regions,
      logo: hasLogo ? "/api/clubs/msbl/" + clubId + "/logo?v=synthetic" + clubId : "",
      activity: iso(-(index * 9 + 1) * DAY_MS), is_active: index % 5 !== 4, member_count: 0
    };
  });

  const players = PLAYER_NAMES.map(function (name, index) {
    const playerId = index + 1;
    const club = index % 2 === 0 || index < 4 ? clubs[index % clubs.length] : null;
    const daysAgo = index % 7 === 6 ? null : index * 3;
    const activity = daysAgo === null ? null : iso(-daysAgo * DAY_MS - 3600000);
    return {
      player_id: playerId, name, display_name: name, country: COUNTRIES[index % COUNTRIES.length],
      club_id: club ? club.club_id : null, club_name: club ? club.name : null, club_tag: club ? club.tag : null,
      activity, is_active: daysAgo !== null && daysAgo <= 90
    };
  });
  clubs.forEach(function (club) {
    club.member_count = players.filter(function (player) { return player.club_id === club.club_id; }).length;
  });

  function discordIdFor(player) {
    if (player.player_id === 1) return linkedUser.id;
    return player.player_id % 3 === 0 ? "9100000000000000" + String(player.player_id).padStart(2, "0") : null;
  }

  // Ratings per game are derived once so leaderboards and profiles agree.
  const GAMES = ["msbl", "msc", "sms"];
  const ratingsByGame = {};
  GAMES.forEach(function (game, gameIndex) {
    ratingsByGame[game] = players.map(function (player, index) {
      const played = game === "msbl" || (index + gameIndex) % 3 !== 0;
      const elo = played ? Math.round(1880 - index * 29 - gameIndex * 17 + random() * 12) : null;
      const whr = played ? Math.round(2150 - index * 23 - gameIndex * 31 + random() * 9) : null;
      const wins = played ? 3 + Math.floor(random() * 60) : 0;
      const losses = played ? Math.floor(random() * 40) : 0;
      return { player, elo, whr, wins, losses, draws: index % 11 === 0 && played ? 1 : 0, played };
    });
  });

  function competitiveRows(game, mode) {
    const source = ratingsByGame[game].filter(function (entry) { return entry.played; });
    const limitCount = mode === "elo2v2" ? 8 : game === "msbl" ? source.length : 18;
    const rows = source.slice(0, limitCount).map(function (entry, index) {
      const rating = mode === "elo2v2" ? Math.round(entry.elo * 0.72) : entry.elo;
      return {
        player: entry.player, rating, wins: mode === "elo2v2" ? 2 + (index % 5) : entry.wins,
        losses: mode === "elo2v2" ? index % 3 : entry.losses, draws: mode === "elo2v2" ? 0 : entry.draws
      };
    });
    rows.sort(function (a, b) { return b.rating - a.rating; });
    return rows.map(function (row, index) {
      return {
        rank: index + 1, player_id: row.player.player_id, discord_user_id: discordIdFor(row.player),
        display_name: row.player.display_name, total_matches: row.wins + row.losses + row.draws,
        total_wins: row.wins, total_losses: row.losses, total_draws: row.draws,
        total_game_diff: 0, total_goals_for: 0, total_goals_against: 0, total_goal_diff: 0,
        rating: row.rating, competitive_rank: RANK_NAMES[rankNumberForRating(row.rating)],
        updated_at: iso(-(index + 1) * 60000)
      };
    });
  }

  function whrRows(game) {
    const ball = { msbl: "blball", msc: "mscball", sms: "smsball" }[game];
    const source = ratingsByGame[game].filter(function (entry) { return entry.played; }).slice(0, 26);
    const rows = source.map(function (entry, index) {
      // A few WHR names have no matching Player row in the live data; mirror that.
      const unmatched = index % 9 === 8;
      return {
        player_id: unmatched ? null : entry.player.player_id,
        discord_user_id: unmatched ? null : discordIdFor(entry.player),
        display_name: unmatched ? "Unlinked " + entry.player.display_name : entry.player.display_name,
        total_matches: entry.wins * 9 + entry.losses * 7, total_wins: entry.wins * 9, total_losses: entry.losses * 7,
        total_draws: entry.draws, rating: entry.whr, competitive_rank: game === "msc" && index % 4 === 1 ? ball + "2" : ball
      };
    });
    rows.sort(function (a, b) { return b.rating - a.rating || a.display_name.localeCompare(b.display_name); });
    return rows.map(function (row, index) {
      return {
        rank: index + 1, player_id: row.player_id, discord_user_id: row.discord_user_id, display_name: row.display_name,
        total_matches: row.total_matches, total_wins: row.total_wins, total_losses: row.total_losses,
        total_draws: row.total_draws, total_game_diff: 0, total_goals_for: 0, total_goals_against: 0,
        total_goal_diff: 0, rating: row.rating, competitive_rank: row.competitive_rank, updated_at: generatedAt
      };
    });
  }

  function leaderboardRows(game, mode) {
    return mode === "whr" ? whrRows(game) : competitiveRows(game, mode);
  }

  function findPlayer(id) {
    const player = players.find(function (row) { return String(row.player_id) === String(id); });
    if (!player) throw new Error("Player not found.");
    return player;
  }

  function ratingBlock(game, player) {
    const entry = ratingsByGame[game][player.player_id - 1];
    const index = player.player_id - 1;
    if (!entry.played && index % 2 === 0) {
      return { rating: null, sets: "0-0", games: "0-0", rank_emoji: "", rank_icon_url: "", competitive_rank: "",
        competitive_rank_number: null, season_reward_level: rewardLevel(0, { current_wins: 0, required_wins: 5 }), whr: null };
    }
    const seasonPlayed = index % 5 !== 3;
    const rankNumber = seasonPlayed ? rankNumberForRating(entry.elo || 500) : 0;
    const rewardOrder = seasonPlayed ? Math.min(7, Math.floor(index / 2) % 8) : 0;
    return {
      rating: entry.elo, sets: seasonPlayed ? (entry.wins % 12) + "-" + (entry.losses % 7) : "0-0",
      games: entry.wins * 9 + "-" + entry.losses * 7, rank_emoji: "", rank_icon_url: rankIconUrl(rankNumber),
      competitive_rank: RANK_NAMES[rankNumber], competitive_rank_number: rankNumber,
      season_reward_level: rewardLevel(rewardOrder, { current_wins: rewardOrder === 7 ? 5 : index % 6, required_wins: 5 }),
      whr: entry.whr
    };
  }

  function buildPlayerProfile(player) {
    const index = player.player_id - 1;
    const accoladeCount = index === 0 ? TOURNAMENTS.length : index % 4;
    const accolades = TOURNAMENTS.slice(0, accoladeCount).map(function ([tournament, medal, worldChampion], position) {
      return {
        place_medal: medal, game_code: ["MSBL", "MSC", "SMS"][(index + position) % 3], tournament_name: tournament,
        start_date: iso(-(position + 1) * 60 * DAY_MS).slice(0, 10), is_winner: medal === "🥇",
        is_world_champion: worldChampion && medal === "🥇"
      };
    });
    const seasonAwards = index % 3 === 1 ? [] : [
      { season_name: "Burst 2026", game_code: "MSBL", mode_code: "1v1", award_code: "TOP_10", award_name: "Top 10",
        rank_position: (index % 9) + 1, metric_label: (1500 - index * 7) + ".25 ELO" },
      ...(index % 2 === 0 ? [{ season_name: "Rise 2026", game_code: "MSC", mode_code: "1v1", award_code: "TOP_3",
        award_name: "Top 3", rank_position: (index % 3) + 1, metric_label: (1400 - index * 5) + ".5 ELO" }] : [])
    ];
    const has2v2 = index % 4 === 0;
    return {
      player: {
        id: player.player_id, name: player.name, country: player.country, club_id: player.club_id,
        club_name: player.club_name, club_tag: player.club_tag,
        results_url: index % 3 === 0 ? "https://start.gg/user/sample" + player.player_id + "/results" : "",
        activity: player.activity, is_active: player.is_active
      },
      friend_codes: {
        switch: index % 5 === 4 ? [] : [fakeFriendCode(createRandom(player.player_id), "SW")],
        msc: index % 3 === 2 ? [] : ["PAL (Wii): " + fakeFriendCode(createRandom(player.player_id + 100))],
        msc_pal: index % 3 === 2 ? [] : ["PAL (Wii): " + fakeFriendCode(createRandom(player.player_id + 100))],
        msc_ntsc: index % 4 === 1 ? ["NTSC (Dolphin): " + fakeFriendCode(createRandom(player.player_id + 200))] : [],
        msc_kor: [], msc_jpn: []
      },
      season_awards: seasonAwards,
      accolades,
      ratings: {
        sms: ratingBlock("sms", player), msc: ratingBlock("msc", player), msbl: ratingBlock("msbl", player),
        sms2v2: {}, msc2v2: {},
        msbl2v2: has2v2 ? { ...ratingBlock("msbl", player), rating: Math.round((ratingsByGame.msbl[index].elo || 800) * 0.72), tst: 1700 - index * 11 } : {}
      },
      season_reward_level: rewardLevel(Math.min(7, index % 8)),
      highest_rank_banner_url: ""
    };
  }

  function buildClubProfile(club) {
    const members = players.filter(function (player) { return player.club_id === club.club_id; });
    const roster = members.map(function (player, index) {
      const role = index === 0 ? "owner" : index === 1 ? "officer" : "member";
      const discordId = discordIdFor(player) || "";
      return {
        player_id: player.player_id, name: player.name, country: player.country, discord_id: discordId,
        discord_name: discordId ? player.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") : "",
        is_owner: role === "owner", is_officer: role === "officer", role
      };
    });
    const owner = roster[0] || { name: "", discord_id: "" };
    return {
      club: {
        club_id: club.club_id, name: club.name, tag: club.tag, join_conditions: club.status, region: club.region,
        club_code: club.club_code, regions: club.regions, club_codes: club.club_codes,
        first_uniform: ["Red", "Blue", "Green", "Yellow"][club.club_id % 4],
        second_uniform: ["White", "Black", "Orange", "Purple"][club.club_id % 4],
        stadium: ["Mushroom Hill", "Spooky Mansion", "Desert Ruins", "Pipeline Central"][club.club_id % 4],
        discord_server: club.club_id % 2 === 0 ? "https://discord.gg/sample" + club.club_id : "",
        created_at: iso(-(400 + club.club_id * 30) * DAY_MS), logo: club.logo,
        owner_name: owner.name, owner_discord_id: owner.discord_id
      },
      roster
    };
  }

  const sessionSecret = crypto.randomBytes(32).toString("hex");
  const cookieName = "msc_dev_session";
  const auth = {
    appendQuery,
    toAuthMeResponse: function (session) {
      if (!session) return { authenticated: false };
      return { authenticated: true, user: session.discord_user, expires_at: new Date(nowFn() + DAY_MS).toISOString() };
    },
    buildDiscordAuthorizeUrl: function (returnTo) {
      const state = createSignedToken({ return_to: normalizeReturnTo(returnTo), expires_at: Date.now() + 600000 }, sessionSecret);
      return "/api/auth/discord/callback?code=sample&state=" + encodeURIComponent(state);
    },
    verifyOAuthState: function (state) {
      const payload = verifySignedToken(state, sessionSecret);
      if (!payload || !payload.return_to) throw new Error("Invalid OAuth state.");
      return { returnTo: normalizeReturnTo(payload.return_to) };
    },
    // "sample" logs in the linked player; "sample-unlinked" a Discord user without a profile.
    completeDiscordLogin: async function (code) {
      const user = usersByCode[code];
      if (!user) throw new Error("Invalid sample login code.");
      return { user };
    },
    createSessionCookie: function (user) {
      const token = createSignedToken({ discord_user: user, discord_user_id: user.id, expires_at: Date.now() + DAY_MS }, sessionSecret);
      return cookieName + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400";
    },
    createClearSessionCookie: function () {
      return cookieName + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    },
    readSessionFromRequest: function (req) {
      const entry = String(req.headers.cookie || "").split(";").map(function (part) { return part.trim(); })
        .find(function (part) { return part.startsWith(cookieName + "="); });
      const session = entry ? verifySignedToken(entry.slice(cookieName.length + 1), sessionSecret) : null;
      const known = session && [linkedUser.id, unlinkedUser.id].includes(session.discord_user_id);
      return known ? session : null;
    }
  };

  return {
    source: "fixtures", auth, now: nowFn,
    healthCheck: async function () { return true; },
    getLeaderboardRows: async function (options) {
      const offset = parseOffset(options.offset);
      return leaderboardRows(options.gameCode, options.modeCode).slice(offset, offset + parseLimit(options.limit, 100));
    },
    getPlayerProfile: async function (id) { return buildPlayerProfile(findPlayer(id)); },
    getPlayerProfileByDiscordId: async function (id) { return id === linkedUser.id ? buildPlayerProfile(findPlayer(1)) : null; },
    getMsblClubProfile: async function (id) {
      const club = clubs.find(function (row) { return String(row.club_id) === String(id); });
      if (!club) throw new Error("Club not found.");
      return buildClubProfile(club);
    },
    defaultClubLogoCache: {
      getLogoFile: async function (id) {
        const club = clubs.find(function (row) { return String(row.club_id) === String(id); });
        return club && club.logo
          ? { absolutePath: path.join(__dirname, "club-logo.svg"), contentType: "image/svg+xml", hash: "synthetic-v1" } : null;
      }
    },
    communityEventsCache: { get: async function () {
      const rows = [
        ["sample-training-cup", "SAMPLE TRAINING CUP", "msbl", "/assets/games/msblball.png"],
        ["demo-charged-classic", "DEMO CHARGED CLASSIC", "msc", "/assets/games/mscball.png"],
        ["fixture-super-series", "FIXTURE SUPER SERIES", "sms", "/assets/games/smsball.png"]
      ].map(function ([name, displayName, game, imageUrl], position) {
        return { id: "sample-event-" + (position + 1), name, display_name: displayName, game, image_url: imageUrl,
          slug: name, position, url: "/community-tournaments" };
      });
      return { count: rows.length, rows };
    } },
    fetchWiimmfiPlayers: async function () {
      return [
        { region: "R4QP", friendCode: "0000-0000-0001", name: "Sample Player" },
        { region: "R4QE", friendCode: "0000-0000-0002", name: "Pixel Piranha" },
        { region: "R4QJ", friendCode: "0000-0000-0003", name: "サンプル" },
        { region: "R4QK", friendCode: "0000-0000-0004", name: "Turbo Shell" }
      ];
    },
    publicDataCache: { get: async function (key) {
      let payload;
      if (key === PLAYERS_LIST_KEY) payload = { count: players.length, rows: players };
      else if (key === MSBL_CLUBS_KEY) payload = { game: "msbl", count: clubs.length, rows: clubs };
      else if (key === COMPETITIVE_SEASON_KEY) payload = { serverNowUtc: new Date(nowFn()).toISOString(),
        season: { id: 3, seasonNumber: 2, displayName: "Dusk Season 2026", startDateUtc: iso(-20 * DAY_MS),
          endDateUtc: iso(50 * DAY_MS + 5 * 3600000), isActive: true, isCompleted: false, lifecycleStatus: "active" } };
      else if (key.startsWith("leaderboard:")) {
        const [, game, mode] = key.split(":");
        const rows = leaderboardRows(game, mode);
        payload = { game, mode, count: rows.length, rows };
      } else throw new Error("Unknown fixture data key.");
      return { payload: structuredClone(payload), cacheStatus: "fixture", generatedAt };
    } }
  };
}

module.exports = { createFixtureProviders };
