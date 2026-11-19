import assert from "node:assert/strict";
import test from "node:test";
import { clubNameKey } from "@ms/shared/clubs";
import { createFakeDatabase, type QueryResult } from "../../test-support/fake-database.ts";
import {
  ADD_MEMBER_SQL,
  CREATE_CLUB_SQL,
  EVENT_SQL,
  INVITE_SQL,
  LOG_SQL,
  MODE_QUERY,
  SCOPE_QUERY,
  buildClubUpdate,
  buildLockedStateQuery,
  createSqlClubStore,
  toClubState,
  toSettings,
} from "./management-repository.ts";
import { NEW_CLUB, type PlanStep } from "./rules.ts";

const NOW = Date.parse("2026-12-01T12:00:00.000Z");

const CLUB_ROW = {
  ID: 5,
  PublicId: "Ab3dEf9h",
  ClubName: "Hammer Bros",
  ClanTag: "HB",
  Owner: "101",
  IsOpen: true,
  Region: "EU",
  Region2: null,
  Region3: "",
  ClubCode: "ABC1234",
  ClubCode2: null,
  ClubCode3: null,
  Color1: "",
  Color2: "",
  Stadium: null,
  DiscordServer: null,
  Logo: "",
  Activity: new Date(NOW - 1000),
  CreatedAtUtc: null,
  EstablishedAtUtc: new Date(NOW - 5000),
  StreakSinceUtc: null,
  InactiveSinceUtc: null,
  InactiveWarnedAtUtc: null,
  DeletionWarnedAtUtc: null,
};

const PLAYER_ROW = {
  ID: 1,
  DiscordID: "101",
  Name: "Cap",
  Country: "DE",
  LastClubCreatedAtUtc: null,
  LastClubExitAtUtc: null,
};
const MEMBER_ROW = {
  Player: 1,
  Club: 5,
  IsOfficer: 1,
  JoinedAtUtc: null,
  AbsentSinceUtc: null,
  AbsenceExempt: 0,
  DiscordID: "101",
  Name: "Cap",
  Country: "DE",
};

function database(options: { deadlocks?: number; closed?: number } = {}) {
  let deadlocks = options.deadlocks ?? 0;
  return createFakeDatabase((sql): QueryResult => {
    if (sql === SCOPE_QUERY) {
      if (deadlocks > 0) {
        deadlocks -= 1;
        throw Object.assign(new Error("deadlock victim"), { number: 1205 });
      }
      return { recordset: [{ actor_club: 5, invitation_club: null }] };
    }
    if (sql.startsWith("SET XACT_ABORT ON; SELECT c.ID")) {
      return { recordsets: [[CLUB_ROW], [MEMBER_ROW], [], [PLAYER_ROW], []] };
    }
    if (sql === CREATE_CLUB_SQL) return { recordset: [{ id: 400 }] };
    if (sql === INVITE_SQL) return { recordset: [{ id: 77 }] };
    if (sql.startsWith("UPDATE dbo.ClubInvitation")) return { rowsAffected: [options.closed ?? 1] };
    return { rowsAffected: [1] };
  });
}

test("the locking read takes club rows, roster, invitations, player state and blocks in this order", () => {
  const sql = buildLockedStateQuery([5, 9]);
  const order = [
    "FROM dbo.Club c WITH (UPDLOCK, HOLDLOCK)",
    "FROM dbo.ClubRoster cr WITH (UPDLOCK, HOLDLOCK)",
    "FROM dbo.ClubInvitation i WITH (UPDLOCK, HOLDLOCK)",
    "dbo.ClubPlayerState s WITH (UPDLOCK, HOLDLOCK)",
    "FROM dbo.ClubJoinBlock b WITH (UPDLOCK, HOLDLOCK)",
  ];
  let position = -1;
  for (const part of order) {
    const at = sql.indexOf(part);
    assert.ok(at > position, part);
    position = at;
  }
  assert.match(sql, /WHERE c\.ID IN \(5, 9\) ORDER BY c\.ID;/);
  assert.match(buildLockedStateQuery([]), /WHERE c\.ID IN \(-1\)/, "no club to lock");
});

test("a change reads the state under locks, applies the plan and resolves the new club's and invitation's ids", async () => {
  const db = database();
  const store = createSqlClubStore(db, clubNameKey);
  const plan: PlanStep[] = [
    {
      kind: "createClub",
      club: {
        publicId: "Zz8xWv7u",
        name: "New Club",
        tag: "NEW",
        ownerDiscordId: "101",
        settings: toSettings(CLUB_ROW),
        createdAt: NOW,
        activity: NOW,
      },
    },
    { kind: "addMember", clubId: NEW_CLUB, playerId: 1, isOfficer: true },
    { kind: "invite", clubId: 5, playerId: 2, invitedByPlayerId: 1, expiresAt: NOW + 1000 },
    {
      kind: "event",
      event: {
        type: "invitation.created",
        clubId: NEW_CLUB,
        clubPublicId: "Zz8xWv7u",
        clubName: "New Club",
        clubTag: "NEW",
        actorPlayerId: 1,
        targetPlayerId: 2,
        newInvitation: true,
        payload: {
          version: 1,
          club: { id: null, name: "New Club", tag: "NEW" },
          actor: null,
          target: null,
          dm: [],
          nick: [],
          transfer: null,
          invitation: { id: null, status: "open", expires_at: "x", invited_by: "Cap" },
          reason: null,
          inactive_at: null,
          deletion_at: null,
        },
      },
    },
    { kind: "log", command: "WebsiteClubCreate", parameters: { a: 1 } },
  ];
  let seen: number | null = null;
  const { decision, created } = await store.change({ actorPlayerId: 1, names: true }, NOW, (state, extras) => {
    seen = state.clubs.get(5)?.members.length ?? null;
    assert.equal(state.actor.clubId, 5);
    assert.equal(state.actor.country, "de");
    assert.equal(extras.names.has(clubNameKey("x")), false);
    return { ok: true, plan, result: "done" };
  });
  assert.equal(seen, 1);
  assert.equal(decision.ok, true);
  assert.deepEqual(created, { clubId: 400, invitationId: 77 });
  assert.deepEqual(db.transactions, ["begin", "commit"]);
  const member = db.queries.find((query) => query.sql === ADD_MEMBER_SQL);
  assert.equal(member?.inputs.club, 400);
  const eventQuery = db.queries.find((query) => query.sql === EVENT_SQL);
  assert.equal(eventQuery?.inputs.club, 400);
  const payload = JSON.parse(String(eventQuery.inputs.payload)) as {
    club: { id: number };
    invitation: { id: number };
  };
  assert.equal(payload.club.id, 400);
  assert.equal(payload.invitation.id, 77);
  assert.ok(db.queries.some((query) => query.sql === LOG_SQL && query.inputs.command === "WebsiteClubCreate"));
});

test("a refusal writes nothing; a plan that finds an invitation closed meanwhile rolls back", async () => {
  const db = database();
  const store = createSqlClubStore(db, clubNameKey);
  const refused = await store.change({ actorPlayerId: 1 }, NOW, () => ({
    ok: false,
    code: "NOT_ALLOWED",
    message: "No.",
  }));
  assert.equal(refused.decision.ok, false);
  assert.equal(db.queries.length, 2, "only the two reads");

  const racing = database({ closed: 0 });
  await assert.rejects(
    createSqlClubStore(racing, clubNameKey).change({ actorPlayerId: 1 }, NOW, () => ({
      ok: true,
      plan: [{ kind: "closeInvitations", ids: [3], status: "revoked" }],
      result: null,
    })),
    /Expected 1 open invitations, closed 0/,
  );
  assert.deepEqual(racing.transactions, ["begin", "rollback"]);
});

test("a deadlock repeats the change once", async () => {
  const db = database({ deadlocks: 1 });
  const { decision } = await createSqlClubStore(db, clubNameKey).change({ actorPlayerId: 1 }, NOW, () => ({
    ok: true,
    plan: [],
    result: 1,
  }));
  assert.equal(decision.ok, true);
  assert.deepEqual(db.transactions, ["begin", "rollback", "begin", "commit"]);
});

test("the mode is off without a mode row, and rows map to the rules' state", async () => {
  const missing = createFakeDatabase(() => {
    throw new Error("Invalid object name 'dbo.ClubSystemState'.");
  });
  assert.deepEqual(await createSqlClubStore(missing, clubNameKey).readMode(), { mode: "off", goLiveAt: null });
  const live = createFakeDatabase((sql) =>
    sql === MODE_QUERY ? { recordset: [{ Mode: "admins", GoLiveAtUtc: null }] } : {},
  );
  assert.equal((await createSqlClubStore(live, clubNameKey).readMode()).mode, "admins");

  const state = toClubState({ ...CLUB_ROW, Owner: "<@101>name" }, []);
  assert.equal(state.ownerDiscordId, "101");
  assert.deepEqual(state.settings.regions, ["EU"], "empty and NULL regions drop out");
  assert.equal(state.establishedAt, NOW - 5000);
});

test("a club update sets exactly the given columns", () => {
  const inputs: Record<string, unknown> = {};
  const request = { input: (name: string, _type: unknown, value: unknown) => (inputs[name] = value) } as never;
  assert.deepEqual(buildClubUpdate({ activity: NOW, streakSince: null }, request), [
    "Activity = @activity",
    "StreakSinceUtc = @streakSince",
  ]);
  assert.equal(inputs.streakSince, null);
  const settings = buildClubUpdate({ settings: toSettings(CLUB_ROW) }, request);
  assert.equal(settings.length, 11);
  assert.equal(inputs.region1, "EU");
  assert.equal(inputs.region2, null);
  assert.equal(inputs.stadium, null, "no stadium is stored as NULL");
});
