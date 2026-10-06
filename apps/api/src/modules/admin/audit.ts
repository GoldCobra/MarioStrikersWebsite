// The admin audit log (docs/adr/0011): who opened the admin page or did something there, when, from which
// address and with what outcome. It never holds a token, a cookie or the page's path. The live store is SQL
// (audit-repository.ts); fixtures and tests keep it in memory (below), without any database code.

export type AdminAuditOutcome = "allowed" | "denied" | "failed";

export interface AdminAuditEvent {
  readonly discordUserId: string;
  /** What happened, e.g. "page.open"; future admin actions name themselves the same way. */
  readonly action: string;
  readonly target?: string;
  readonly outcome: AdminAuditOutcome;
  readonly ip?: string;
  readonly requestId?: string;
  readonly details?: string;
}

export interface AdminAuditEntry {
  readonly at: string;
  readonly discordUserId: string;
  readonly action: string;
  readonly target: string;
  readonly outcome: string;
}

export interface AdminAuditStore {
  record(event: AdminAuditEvent): Promise<void>;
  /** The newest entries first. */
  recent(limit: number): Promise<AdminAuditEntry[]>;
}

/** The audit log of fixture mode and tests: kept in memory for the life of the process. */
export function createMemoryAdminAuditStore(now: () => number = Date.now): AdminAuditStore & {
  readonly events: AdminAuditEvent[];
} {
  const events: AdminAuditEvent[] = [];
  const times: number[] = [];
  return {
    events,
    record(event) {
      events.push(event);
      times.push(now());
      return Promise.resolve();
    },
    recent(limit) {
      return Promise.resolve(
        events
          .map((event, index) => ({
            at: new Date(times[index] ?? 0).toISOString(),
            discordUserId: event.discordUserId,
            action: event.action,
            target: event.target ?? "",
            outcome: event.outcome,
          }))
          .reverse()
          .slice(0, limit),
      );
    },
  };
}
