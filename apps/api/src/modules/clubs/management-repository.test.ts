import assert from "node:assert/strict";
import test from "node:test";
import { clubNameKey } from "@ms/shared/clubs";
import { render } from "../../db/sql.ts";
import { createFakeDatabase, type FakeResult, type RecordedStatement } from "../../test-support/fake-database.ts";
import {
  buildClubUpdate,
  buildLockedStateQuery,
  createSqlClubStore,
  toClubState,
  toSettings,
} from "./management-repository.ts";
import { DAY_MS, NEW_CLUB, type PlanStep } from "./rules.ts";

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
const INVITATION_ROW = {
  Id: 3,
  ClubId: 5,
  PlayerId: 2,
  InvitedByPlayerId: 1,
  Status: "open",
  CreatedAtUtc: new Date(NOW - 8 * DAY_MS),
  ExpiresAtUtc: new Date(NOW - DAY_MS),
};

const LOCKED_READ = "FROM dbo.ClubSystemState WITH (HOLDLOCK)";

function database(options: { deadlocks?: number; closed?: number; mode?: string } = {}) {
  let deadlocks = options.deadlocks ?? 0;
  return createFakeDatabase(({ text }): FakeResult => {
    if (text.includes("AS actor_club")) {
      if (deadlocks > 0) {
        deadlocks -= 1;
        throw Object.assign(new Error("deadlock victim"), { number: 1205 });
      }
      return { rows: [{ actor_club: 5, invitation_club: null }] };
    }
    if (text.includes(LOCKED_READ)) {
      return { sets: [[{ Mode: options.mode ?? "on" }], [CLUB_ROW], [MEMBER_ROW], [], [PLAYER_ROW], []] };
    }
    if (text.includes("INSERT INTO dbo.Club (")) return { rows: [{ id: 400 }] };
    if (text.includes("INSERT INTO dbo.ClubInvitation")) return { rows: [{ id: 77 }] };
    if (text.includes("UPDATE dbo.ClubInvitation")) return { affected: [options.closed ?? 1] };
    return { affected: [1] };
  });
}

function statement(db: { readonly statements: readonly RecordedStatement[] }, part: string): RecordedStatement {
  const found = db.statements.find(({ text }) => text.includes(part));
  assert.ok(found, `a statement with ${part}`);
  return found;
}

/** The values of the parameters a statement's `WHERE c.ID IN (…)` lists: the club rows it locks. */
function lockedClubIds({ text, values }: RecordedStatement): unknown[] {
  const list = /WHERE c\.ID IN \(([^)]*)\)/.exec(text)?.[1] ?? "";
  return list.split(", ").map((name) => values[Number(name.replace("@p", ""))]);
}

/** Every part occurs in the text, each after the one before. */
function assertInOrder(text: string, parts: readonly string[]): void {
  let position = -1;
  for (const part of parts) {
    const at = text.indexOf(part);
    assert.ok(at > position, part);
    position = at;
  }
}

test("the locking read takes the mode row, club rows, roster, invitations, player state and blocks in this order", () => {
  const { text, parameters } = render(buildLockedStateQuery({ actorPlayerId: 1, targetPlayerId: 2 }, [5, 9], NOW));
  assertInOrder(text, [
    "FROM dbo.ClubSystemState WITH (HOLDLOCK) WHERE Id = 1",
    "FROM dbo.Club c WITH (UPDLOCK, HOLDLOCK)",
    "FROM dbo.ClubRoster cr WITH (UPDLOCK, HOLDLOCK)",
    "FROM dbo.ClubInvitation i WITH (UPDLOCK, HOLDLOCK)",
    "dbo.ClubPlayerState s WITH (UPDLOCK, HOLDLOCK)",
    "FROM dbo.ClubJoinBlock b WITH (UPDLOCK, HOLDLOCK)",
  ]);
  const values = parameters.map(({ value }) => value);
  assert.match(text, /DECLARE @actor INT = @p0;\s+DECLARE @target INT = @p1;/);
  assert.deepEqual(values.slice(0, 2), [1, 2]);
  assert.match(text, /WHERE c\.ID IN \(@p\d+, @p\d+\)\s+ORDER BY c\.ID;/);
  assert.deepEqual(lockedClubIds({ text, values }), [5, 9]);
  const lists = [...text.matchAll(/IN \((@p\d+), (@p\d+)\)/g)].map((match) =>
    match.slice(1).map((name) => values[Number(name.replace("@p", ""))]),
  );
  assert.deepEqual(
    lists,
    [
      [5, 9],
      [5, 9],
      [5, 9],
    ],
    "the roster and the invitations of the same clubs",
  );
  const since = parameters.find(({ name }) => text.includes(`i.CreatedAtUtc >= @${name}`));
  assert.deepEqual(since?.value, new Date(NOW - 14 * DAY_MS));
  assert.equal((since.type as { scale?: number }).scale, 0, "DATETIME2(0), the column's type");

  const empty = render(buildLockedStateQuery({ actorPlayerId: 1 }, [], NOW));
  const emptyValues = empty.parameters.map(({ value }) => value);
  assert.deepEqual(lockedClubIds({ text: empty.text, values: emptyValues }), [-1], "no club to lock");
  assert.equal(emptyValues[1], -1, "no target");
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
    assert.equal(extras.mode, "on", "the mode row is read under the change's own lock");
    return { ok: true, plan, result: "done" };
  });
  assert.equal(seen, 1);
  assert.equal(decision.ok, true);
  assert.deepEqual(created, { clubId: 400, invitationId: 77 });
  assert.deepEqual(db.transactions, ["begin", "commit"]);
  const order = [
    "AS actor_club",
    LOCKED_READ,
    "SELECT ClubName, ClanTag FROM dbo.Club;",
    "INSERT INTO dbo.Club (",
    "INSERT INTO dbo.ClubRoster",
    "INSERT INTO dbo.ClubInvitation",
    "INSERT INTO dbo.ClubEvent",
    "INSERT INTO dbo.CommandLog",
  ];
  assert.deepEqual(
    db.statements.map(({ text }) => order.findIndex((part) => text.includes(part))),
    order.map((_, index) => index),
    "the two reads, the names, then the plan's steps in order",
  );
  const valuesOf = (part: string): readonly unknown[] => statement(db, part).values;
  assert.deepEqual(
    valuesOf("INSERT INTO dbo.Club ("),
    [
      ...["Zz8xWv7u", "New Club", "NEW", "101"],
      ...[true, "EU", null, null, "ABC1234", null, null, "", "", null, null],
      ...[new Date(NOW), new Date(NOW)],
    ],
    "the identity, the settings and the two dates, each value in its own column",
  );
  assert.deepEqual(valuesOf("INSERT INTO dbo.ClubRoster"), [400, 1, true, new Date(NOW)]);
  assert.deepEqual(valuesOf("INSERT INTO dbo.ClubInvitation"), [5, 2, 1, new Date(NOW), new Date(NOW + 1000)]);
  const [type, clubId, publicId, name, tag, actor, target, payload, createdAt] = valuesOf("INSERT INTO dbo.ClubEvent");
  assert.deepEqual(
    [type, clubId, publicId, name, tag, actor, target, createdAt],
    ["invitation.created", 400, "Zz8xWv7u", "New Club", "NEW", 1, 2, new Date(NOW)],
  );
  const event = JSON.parse(String(payload)) as { club: { id: number }; invitation: { id: number } };
  assert.equal(event.club.id, 400);
  assert.equal(event.invitation.id, 77);
  assert.deepEqual(valuesOf("INSERT INTO dbo.CommandLog"), ["WebsiteClubCreate", '{"a":1}']);
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
  assert.equal(db.statements.length, 2, "only the two reads");

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
  const close = statement(racing, "UPDATE dbo.ClubInvitation");
  assert.match(close.text, /WHERE Status = 'open' AND Id IN \(@p2\);/);
  assert.deepEqual(close.values, ["revoked", new Date(NOW), 3]);
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

test("deadlocks repeat the change twice at most, each time in a new transaction", async () => {
  const change = (db: ReturnType<typeof database>) =>
    createSqlClubStore(db, clubNameKey).change({ actorPlayerId: 1 }, NOW, () => ({ ok: true, plan: [], result: 1 }));
  const twice = database({ deadlocks: 2 });
  assert.equal((await change(twice)).decision.ok, true);
  assert.deepEqual(twice.transactions, ["begin", "rollback", "begin", "rollback", "begin", "commit"]);
  const thrice = database({ deadlocks: 3 });
  await assert.rejects(change(thrice), /deadlock victim/);
  assert.deepEqual(thrice.transactions, ["begin", "rollback", "begin", "rollback", "begin", "rollback"]);
});

test("a scope that moved between the two reads is read again with the actor's club locked", async () => {
  let reads = 0;
  const db = createFakeDatabase(({ text }): FakeResult => {
    if (text.includes("AS actor_club")) {
      reads += 1;
      // The first read finds the actor without a club; the actor has joined club 5 when the locks are taken.
      return { rows: [{ actor_club: reads === 1 ? null : 5, invitation_club: null }] };
    }
    if (text.includes(LOCKED_READ)) {
      return { sets: [[{ Mode: "on" }], reads === 1 ? [] : [CLUB_ROW], [MEMBER_ROW], [], [PLAYER_ROW], []] };
    }
    return { affected: [1] };
  });
  const { decision } = await createSqlClubStore(db, clubNameKey).change({ actorPlayerId: 1 }, NOW, (state) => {
    assert.equal(state.clubs.get(5)?.name, "Hammer Bros");
    return { ok: true, plan: [], result: null };
  });
  assert.equal(decision.ok, true);
  assert.deepEqual(db.transactions, ["begin", "rollback", "begin", "commit"]);
  assert.deepEqual(db.statements.filter(({ text }) => text.includes(LOCKED_READ)).map(lockedClubIds), [[-1], [5]]);
});

test("the mode is off without a mode row, and rows map to the rules' state", async () => {
  const missing = createFakeDatabase(() => {
    throw new Error("Invalid object name 'dbo.ClubSystemState'.");
  });
  assert.deepEqual(await createSqlClubStore(missing, clubNameKey).readMode(), { mode: "off", goLiveAt: null });
  const live = createFakeDatabase(({ text }) =>
    text.includes("FROM dbo.ClubSystemState WHERE Id = 1") ? [{ Mode: "admins", GoLiveAtUtc: null }] : [],
  );
  assert.equal((await createSqlClubStore(live, clubNameKey).readMode()).mode, "admins");
  assert.deepEqual(live.transactions, [], "the cached gate reads the mode outside a transaction");
  for (const [stored, seen] of [
    ["admins", "admins"],
    ["unknown", "off"],
  ] as const) {
    let mode = "";
    await createSqlClubStore(database({ mode: stored }), clubNameKey).change({ actorPlayerId: 1 }, NOW, (_, extras) => {
      mode = extras.mode;
      return { ok: true, plan: [], result: null };
    });
    assert.equal(mode, seen, `a change sees the stored mode ${stored} as ${seen}`);
  }

  const state = toClubState({ ...CLUB_ROW, Owner: "<@101>name" }, []);
  assert.equal(state.ownerDiscordId, "101");
  assert.deepEqual(state.settings.regions, ["EU"], "empty and NULL regions drop out");
  assert.equal(state.establishedAt, NOW - 5000);
});

test("a club update sets exactly the given columns, each in its column's type", () => {
  assert.equal(buildClubUpdate({}), null, "nothing to set");
  const times = buildClubUpdate({ activity: NOW, streakSince: null });
  assert.ok(times);
  const timed = render(times);
  assert.equal(timed.text, "Activity = @p0, StreakSinceUtc = @p1");
  assert.deepEqual(
    timed.parameters.map(({ value }) => value),
    [new Date(NOW), null],
  );
  assert.deepEqual(
    timed.parameters.map(({ type }) => (type as { scale?: number }).scale),
    [0, 0],
  );

  const identity = buildClubUpdate({ name: "Koopa Kickers", tag: "KK", ownerDiscordId: "202", logo: null });
  assert.ok(identity);
  const named = render(identity);
  assert.equal(named.text, "ClubName = @p0, ClanTag = @p1, Owner = @p2, Logo = @p3");
  assert.deepEqual(
    named.parameters.map(({ value }) => value),
    ["Koopa Kickers", "KK", "202", null],
  );
  assert.deepEqual(
    named.parameters.map(({ type }) => (type as { length?: number }).length),
    [50, 5, 25, 4000],
  );

  const settings = buildClubUpdate({ settings: toSettings(CLUB_ROW) });
  assert.ok(settings);
  const { text, parameters } = render(settings);
  assert.equal(
    text,
    "IsOpen = @p0, Region = @p1, Region2 = @p2, Region3 = @p3, ClubCode = @p4, ClubCode2 = @p5, ClubCode3 = @p6, " +
      "Color1 = @p7, Color2 = @p8, Stadium = @p9, DiscordServer = @p10",
  );
  assert.deepEqual(
    parameters.map(({ value }) => value),
    [true, "EU", null, null, "ABC1234", null, null, "", "", null, null],
  );
  assert.equal(parameters[9]?.value, null, "no stadium is stored as NULL");
  assert.deepEqual(
    parameters.slice(1).map(({ type }) => (type as { length?: number }).length),
    [10, 10, 10, 10, 7, 7, 10, 10, 50, 100],
  );
});

test("the lifecycle job changes one club, or expires invitations, in a locked transaction of its own", async () => {
  const db = createFakeDatabase(({ text }): FakeResult => {
    if (text.includes("WHERE c.ID = @club;")) return { sets: [[CLUB_ROW], [MEMBER_ROW], []] };
    if (text.includes("i.ExpiresAtUtc <=")) return { rows: [INVITATION_ROW] };
    if (text.includes("FROM dbo.Club c WHERE c.ID IN (")) return { rows: [CLUB_ROW] };
    return { affected: [1] };
  });
  const store = createSqlClubStore(db, clubNameKey);
  const changed = await store.changeClub(5, NOW, (state, club) => {
    assert.equal(state.now, NOW);
    assert.deepEqual(state.invitations, []);
    assert.equal(club.members.length, 1);
    return [{ kind: "updateClub", clubId: club.clubId, set: { streakSince: null } }];
  });
  assert.equal(changed, true);
  assert.deepEqual(db.transactions, ["begin", "commit"]);
  const [read, update] = db.statements;
  assert.ok(read && update);
  assertInOrder(read.text, [
    "FROM dbo.Club c WITH (UPDLOCK, HOLDLOCK) WHERE c.ID = @club;",
    "FROM dbo.ClubRoster cr WITH (UPDLOCK, HOLDLOCK)",
    "FROM dbo.ClubInvitation i WITH (UPDLOCK, HOLDLOCK)",
  ]);
  assert.deepEqual(read.values, [5]);
  assert.match(update.text, /UPDATE dbo\.Club SET StreakSinceUtc = @p0 WHERE ID = @p1;/);
  assert.deepEqual(update.values, [null, 5]);

  const expired = await store.expireInvitations(NOW, (invitations, clubOf) => {
    assert.equal(clubOf(5)?.name, "Hammer Bros");
    return [{ kind: "closeInvitations", ids: invitations.map((invitation) => invitation.id), status: "expired" }];
  });
  assert.equal(expired, 1);
  assert.deepEqual(db.transactions, ["begin", "commit", "begin", "commit"]);
  const [lock, clubs, close] = db.statements.slice(2);
  assert.match(lock?.text ?? "", /FROM dbo\.ClubInvitation i WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.deepEqual(lock?.values, [new Date(NOW)]);
  assert.deepEqual(clubs?.values, [5]);
  assert.deepEqual(close?.values, ["expired", new Date(NOW), 3]);
});

test("a club that is gone is no change, and nothing is written", async () => {
  const db = createFakeDatabase((): FakeResult => ({ sets: [[], [], []] }));
  const changed = await createSqlClubStore(db, clubNameKey).changeClub(9, NOW, () => {
    throw new Error("No decision without a club.");
  });
  assert.equal(changed, false);
  assert.equal(db.statements.length, 1);
  assert.deepEqual(db.transactions, ["begin", "commit"]);
});

test("My Club reads the player, the club, its members, both kinds of invitations and the blocks in one batch", async () => {
  const db = createFakeDatabase(({ text }): FakeResult => ({
    sets: text.includes("DECLARE @player INT")
      ? [
          [{ ...PLAYER_ROW, Club: 5 }],
          [{ ...CLUB_ROW, LogoHash: "abc" }],
          [MEMBER_ROW],
          [{ ...INVITATION_ROW, ExpiresAtUtc: new Date(NOW + DAY_MS), PlayerName: "Ivy", InvitedByName: "Cap" }],
          [
            {
              ...INVITATION_ROW,
              Id: 4,
              ClubId: 9,
              PlayerId: 1,
              ClubName: "Koopa Kickers",
              ClanTag: "KK",
              InvitedByName: "Bowser",
            },
          ],
          [{ ClubId: 9, PlayerId: 1, BlockedUntilUtc: new Date(NOW + DAY_MS) }],
        ]
      : [],
  }));
  const row = await createSqlClubStore(db, clubNameKey).readMyClub(1, NOW);
  assert.equal(row.player?.clubId, 5);
  assert.equal(row.player.country, "de");
  assert.equal(row.club?.logoHash, "abc");
  assert.deepEqual(
    row.club.members.map((member) => [member.name, member.isOfficer]),
    [["Cap", true]],
  );
  assert.deepEqual(
    row.clubInvitations.map((invitation) => [invitation.id, invitation.playerName, invitation.invitedByName]),
    [[3, "Ivy", "Cap"]],
  );
  assert.deepEqual(
    row.invitations.map((invitation) => [
      invitation.id,
      invitation.clubName,
      invitation.clubTag,
      invitation.invitedByName,
    ]),
    [[4, "Koopa Kickers", "KK", "Bowser"]],
  );
  assert.deepEqual(row.joinBlocks, [{ clubId: 9, playerId: 1, until: NOW + DAY_MS }]);
  assert.deepEqual(db.transactions, [], "a plain read");
  assert.deepEqual(db.statements[0]?.values, [1, new Date(NOW)]);
});

test("the lifecycle's plain statements count the rows they changed", async () => {
  const db = createFakeDatabase(({ text }): FakeResult => ({
    affected: text.includes("DELETE i FROM dbo.ClubInvitation") ? [1, 2, 3, 4] : [3],
  }));
  const store = createSqlClubStore(db, clubNameKey);
  assert.equal(await store.cleanUp(NOW), 10, "the rows of all four deletes");
  assert.deepEqual(db.statements[0]?.values, [new Date(NOW - 30 * DAY_MS), new Date(NOW)]);
  assert.equal(await store.raiseMatchActivity(NOW - DAY_MS), 3);
  assert.match(db.statements[1]?.text ?? "", /INNER JOIN rocci121_toby\.RatedMatch m ON m\.Id = mp\.RatedMatchId/);
  assert.deepEqual(db.statements[1]?.values, [new Date(NOW - DAY_MS)]);
  assert.deepEqual(db.transactions, []);
});
