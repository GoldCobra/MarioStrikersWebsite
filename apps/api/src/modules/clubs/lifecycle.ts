// The club lifecycle job (docs/adr/0012), every few minutes in the API: invitations expire, the new-club counter runs
// (L1), and from go-live on members off the server are stamped and removed after 14 days (J5) and club activity
// follows the members' rated matches (L2). Every club is changed in its own locked transaction on state read under
// that lock, so a second API process (a release swaps them) finds nothing left to do instead of doing it twice.

import { CLUB_LIMITS } from "@ms/shared/clubs";
import type { GuildMemberSnapshot } from "../../integrations/discord/guild-members.ts";
import type { Logger } from "../../lib/logger.ts";
import type { ClubStore } from "./management-repository.ts";
import { DAY_MS, decideAbsence, decideExpiry, decideNewClubCounter, type ClubMember } from "./rules.ts";

/** A member list older than this is not trusted for the absence rule. */
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
/** More newly absent members than this share of the roster at once means a broken list: J5 waits (and warns). */
const MAX_NEWLY_ABSENT_SHARE = 0.2;

export interface ClubLifecycleOptions {
  readonly store: ClubStore;
  readonly memberList: { get(): Promise<GuildMemberSnapshot | null> };
  readonly log: Logger;
  /** Time between two runs; 0 switches the job off. */
  readonly intervalMs: number;
  readonly firstRunMs?: number;
  readonly now?: () => number;
  /** Runs after a run changed something, e.g. to refresh the public club list. */
  readonly onChange?: () => void;
}

export interface ClubLifecycleReport {
  readonly expiredInvitations: number;
  readonly newClubChanges: number;
  readonly absenceChanges: number;
  readonly activityClubs: number;
  readonly cleanedRows: number;
  /** Why J5 did not run this time ("" when it ran). */
  readonly absenceSkipped: string;
}

export interface ClubLifecycle {
  start(): void;
  stop(): void;
  /** One run (the job's timer calls it; tests call it directly). */
  run(): Promise<ClubLifecycleReport>;
}

/** Whether J5 changes anything for this member now. */
export function absenceDue(member: ClubMember, onServer: boolean, now: number): boolean {
  if (onServer) return member.absentSince !== null || member.absenceExempt;
  if (member.absenceExempt) return false;
  return member.absentSince === null || now >= member.absentSince + CLUB_LIMITS.absenceDays * DAY_MS;
}

export function createClubLifecycle(options: ClubLifecycleOptions): ClubLifecycle {
  const { store, log } = options;
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<ClubLifecycleReport> | null = null;

  async function absence(at: number): Promise<{ changes: number; skipped: string }> {
    const snapshot = await options.memberList.get().catch(() => null);
    if (!snapshot || at - snapshot.takenAt > SNAPSHOT_MAX_AGE_MS)
      return { changes: 0, skipped: "no fresh member list" };
    const onServer = (discordId: string): boolean => snapshot.members.has(discordId);
    const roster = await store.rosterPresence();
    const newlyAbsent = roster.filter(
      ({ member }) => !onServer(member.discordId) && !member.absenceExempt && member.absentSince === null,
    ).length;
    if (newlyAbsent > Math.max(10, roster.length * MAX_NEWLY_ABSENT_SHARE)) {
      log.warn(
        { newlyAbsent, roster: roster.length },
        "[clubs] Absence rule skipped: too many members missing at once",
      );
      return { changes: 0, skipped: `${newlyAbsent} of ${roster.length} members missing at once` };
    }
    const clubIds = new Set(
      roster.filter(({ member }) => absenceDue(member, onServer(member.discordId), at)).map(({ clubId }) => clubId),
    );
    let changes = 0;
    for (const clubId of clubIds) {
      if (await store.changeClub(clubId, at, (state, club) => decideAbsence(state, club, onServer))) changes += 1;
    }
    return { changes, skipped: "" };
  }

  async function runOnce(): Promise<ClubLifecycleReport> {
    const at = now();
    const system = await store.readMode();
    const cleanedRows = await store.cleanUp(at);
    const expiredInvitations = await store.expireInvitations(at, (invitations, clubOf) =>
      decideExpiry(at, invitations, clubOf),
    );
    let newClubChanges = 0;
    for (const clubId of await store.newClubIds()) {
      if (await store.changeClub(clubId, at, (state, club) => decideNewClubCounter(state, club))) newClubChanges += 1;
    }
    let absenceChanges = 0;
    let absenceSkipped = "not live yet";
    let activityClubs = 0;
    if (system.mode === "on" && system.goLiveAt !== null) {
      const result = await absence(at);
      absenceChanges = result.changes;
      absenceSkipped = result.skipped;
      activityClubs = await store.raiseMatchActivity(system.goLiveAt);
    }
    const report = { expiredInvitations, newClubChanges, absenceChanges, activityClubs, cleanedRows, absenceSkipped };
    if (expiredInvitations || newClubChanges || absenceChanges || activityClubs) {
      log.info(report, "[clubs] Lifecycle run changed clubs");
      options.onChange?.();
    }
    return report;
  }

  function run(): Promise<ClubLifecycleReport> {
    running ??= runOnce().finally(() => {
      running = null;
    });
    return running;
  }

  function schedule(delayMs: number): void {
    timer = setTimeout(() => {
      void run()
        .catch((err: unknown) => {
          log.warn({ err }, "[clubs] Lifecycle run failed");
        })
        .finally(() => {
          if (timer) schedule(options.intervalMs);
        });
    }, delayMs);
    timer.unref();
  }

  return {
    start() {
      if (options.intervalMs <= 0 || timer) return;
      schedule(options.firstRunMs ?? 60_000);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    run,
  };
}
