const crypto = require("node:crypto");
const path = require("node:path");
const { parseLimit, parseOffset } = require("../lib/leaderboard-params");
const { PLAYERS_LIST_KEY, MSBL_CLUBS_KEY, COMPETITIVE_SEASON_KEY } = require("../lib/public-data-keys");
const { createSignedToken, verifySignedToken, normalizeReturnTo, appendQuery, toAuthMeResponse } = require("../services/auth-service");

// Entirely invented development data. Never copy a production snapshot into this module.
function createFixtureProviders() {
  if (process.env.NODE_ENV === "production") throw new Error("Fixtures cannot run in production.");
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const user = { id: "900000000000000001", username: "sample_player", global_name: "Sample Player", avatar: "" };
  const players = [
    { player_id: 1, name: "Sample Player", country: "de", club_id: 1, club_name: "Sample Strikers", club_tag: "SMP", is_active: true },
    { player_id: 2, name: "Practice Partner", country: "us", club_id: 1, club_name: "Sample Strikers", club_tag: "SMP", is_active: true },
    { player_id: 3, name: "Training Rookie", country: "gb", club_id: 2, club_name: "Demo United", club_tag: "DEMO", is_active: false }
  ].map(function (player) {
    return { ...player, display_name: player.name, activity: player.is_active ? generatedAt : null };
  });
  const clubs = [
    { club_id: 1, name: "Sample Strikers", tag: "SMP", status: "Open to Anyone", is_open: true, region: "EU", club_code: "0000000", member_count: 2 },
    { club_id: 2, name: "Demo United", tag: "DEMO", status: "Invite Only", is_open: false, region: "NA", club_code: "", member_count: 1 }
  ].map(function (club) {
    return { ...club, regions: [club.region], club_codes: club.club_code ? [club.club_code] : [],
      logo: "/api/clubs/msbl/" + club.club_id + "/logo", activity: generatedAt, is_active: true };
  });

  function leaderboardRows(mode) {
    return players.map(function (player, index) {
      return { rank: index + 1, player_id: player.player_id, discord_user_id: index === 0 ? user.id : null,
        display_name: player.name, rating: (mode === "whr" ? 1800 : 1400) - index * 150,
        rank_number: 7 - index * 3, competitive_rank: ["Gold I", "Silver I", "Bronze I"][index],
        total_matches: 20, total_wins: 15 - index * 3, total_losses: 5 + index * 3,
        total_draws: 0, total_game_diff: 10, total_goals_for: 60, total_goals_against: 40,
        total_goal_diff: 20, updated_at: generatedAt };
    });
  }

  function requirePlayer(id) {
    const player = players.find(function (row) { return String(row.player_id) === String(id); });
    if (!player) throw new Error("Player not found.");
    return player;
  }

  async function getPlayerProfile(id) {
    const player = requirePlayer(id);
    const rating = { rating: 1400, whr: 1800, sets: "15-5", games: "30-12", rank_emoji: "",
      competitive_rank: "Gold I", competitive_rank_number: 7,
      rank_icon_url: "/assets/leaderboards/rankicons/3-gold-I.png",
      season_reward_level: { order: 2, name: "Silver", image_url: "/assets/players/rewardlevel/2-silver.png", current_wins: 3, required_wins: 10 } };
    return {
      player: { ...player, id: player.player_id, results_url: "" },
      friend_codes: { switch: ["SW-0000-0000-0000"], msc: ["PAL (sample): 0000-0000-0000"],
        msc_pal: ["PAL (sample): 0000-0000-0000"], msc_ntsc: [], msc_jpn: [], msc_kor: [] },
      ratings: { sms: { ...rating }, msc: { ...rating }, msbl: { ...rating }, msbl2v2: { ...rating, tst: 1750 }, sms2v2: {}, msc2v2: {} },
      season_awards: [{ season_name: "Sample Season", game_code: "MSBL", mode_code: "1v1",
        award_code: "top3", award_name: "Sample Top Three", rank_position: 3, metric_label: "ELO" }],
      accolades: [{ place_medal: "🥈", game_code: "MSBL", tournament_name: "Sample Training Cup",
        start_date: "2026-01-01", is_winner: false, is_world_champion: false }],
      season_reward_level: { order: 2, name: "Silver", image_url: "/assets/players/rewardlevel/2-silver.png" },
      highest_rank_banner_url: ""
    };
  }

  const sessionSecret = crypto.randomBytes(32).toString("hex");
  const cookieName = "msc_dev_session";
  const auth = {
    appendQuery, toAuthMeResponse,
    buildDiscordAuthorizeUrl: function (returnTo) {
      const state = createSignedToken({ return_to: normalizeReturnTo(returnTo), expires_at: Date.now() + 600000 }, sessionSecret);
      return "/api/auth/discord/callback?code=sample&state=" + encodeURIComponent(state);
    },
    verifyOAuthState: function (state) {
      const payload = verifySignedToken(state, sessionSecret);
      if (!payload || !payload.return_to) throw new Error("Invalid OAuth state.");
      return { returnTo: normalizeReturnTo(payload.return_to) };
    },
    completeDiscordLogin: async function (code) {
      if (code !== "sample") throw new Error("Invalid sample login code.");
      return { user };
    },
    createSessionCookie: function () {
      const token = createSignedToken({ discord_user: user, discord_user_id: user.id, expires_at: Date.now() + 86400000 }, sessionSecret);
      return cookieName + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400";
    },
    createClearSessionCookie: function () {
      return cookieName + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    },
    readSessionFromRequest: function (req) {
      const entry = String(req.headers.cookie || "").split(";").map(function (part) { return part.trim(); })
        .find(function (part) { return part.startsWith(cookieName + "="); });
      const session = entry ? verifySignedToken(entry.slice(cookieName.length + 1), sessionSecret) : null;
      return session && session.discord_user_id === user.id ? session : null;
    }
  };

  return {
    source: "fixtures", auth,
    healthCheck: async function () { return true; },
    getLeaderboardRows: async function (options) {
      const offset = parseOffset(options.offset);
      return leaderboardRows(options.modeCode).slice(offset, offset + parseLimit(options.limit, 100));
    },
    getPlayerProfile,
    getPlayerProfileByDiscordId: async function (id) { return id === user.id ? getPlayerProfile(1) : null; },
    getMsblClubProfile: async function (id) {
      const club = clubs.find(function (row) { return String(row.club_id) === String(id); });
      if (!club) throw new Error("Club not found.");
      const roster = players.filter(function (player) { return player.club_id === club.club_id; }).map(function (player, index) {
        return { player_id: player.player_id, name: player.name, country: player.country,
          discord_id: player.player_id === 1 ? user.id : "", discord_name: player.player_id === 1 ? user.username : "",
          is_owner: index === 0, is_officer: false, role: index === 0 ? "Owner" : "Member" };
      });
      return { club: { ...club, join_conditions: club.status, first_uniform: "Red",
        second_uniform: "Blue", stadium: "Mushroom Hill", discord_server: "", created_at: "2026-01-01T00:00:00.000Z",
        owner_name: roster[0].name, owner_discord_id: roster[0].discord_id }, roster };
    },
    defaultClubLogoCache: {
      getLogoFile: async function (id) {
        return clubs.some(function (club) { return String(club.club_id) === String(id); })
          ? { absolutePath: path.join(__dirname, "club-logo.svg"), contentType: "image/svg+xml", hash: "synthetic-v1" } : null;
      }
    },
    communityEventsCache: { get: async function () {
      const rows = [{ id: "sample-event", name: "sample-training-cup", display_name: "SAMPLE TRAINING CUP",
        game: "msbl", image_url: "/assets/games/msblball.png", slug: "sample-training-cup", position: 0, url: "/community-tournaments" }];
      return { count: rows.length, rows };
    } },
    fetchWiimmfiPlayers: async function () {
      return [{ region: "R4QP", friendCode: "0000-0000-0000", name: "Sample Player" }];
    },
    publicDataCache: { get: async function (key) {
      let payload;
      if (key === PLAYERS_LIST_KEY) payload = { count: players.length, rows: players };
      else if (key === MSBL_CLUBS_KEY) payload = { game: "msbl", count: clubs.length, rows: clubs };
      else if (key === COMPETITIVE_SEASON_KEY) payload = { serverNowUtc: new Date().toISOString(),
        season: { id: 1, seasonNumber: 1, displayName: "Sample Season", startDateUtc: new Date(now - 86400000).toISOString(),
          endDateUtc: new Date(now + 14 * 86400000).toISOString(), isActive: true, isCompleted: false, lifecycleStatus: "Active" } };
      else if (key.startsWith("leaderboard:")) {
        const [, game, mode] = key.split(":");
        const rows = leaderboardRows(mode);
        payload = { game, mode, count: rows.length, rows };
      } else throw new Error("Unknown fixture data key.");
      return { payload: structuredClone(payload), cacheStatus: "fixture", generatedAt };
    } }
  };
}

module.exports = { createFixtureProviders };
