// The club events the website writes into dbo.ClubEvent (the outbox, docs/adr/0012) and Robotic Nightmare works off.
// The website decides who is told and whose nickname tag changes; the bot only performs it, with its own texts.
// Each payload is a snapshot: the club or the membership may be gone when the bot gets to it. This file is the
// contract with the bot's worker; change it only together with the bot.
//
// The worker takes pending rows in Id order (ProcessedAtUtc NULL; ClaimedUntilUtc as its lease), records every
// effect it has performed in DoneEffects ({"dm:<discord id>": …, "nick:<discord id>": …, "transfer": …}) before the
// next one, so a restart never repeats a DM, and sets ProcessedAtUtc when all are done (Attempts/LastError on
// failures; a failed DM is done, not retried). The invitation DM's channel and message ids go into the
// invitation.created event's DoneEffects; an invitation.closed event finds them there by invitation id, also after
// the club and its invitation rows are deleted.

export const CLUB_EVENT_VERSION = 1;

export const CLUB_EVENT_TYPES = [
  "club.created",
  "club.deleted",
  "club.renamed",
  "club.inactivity_warning",
  "club.marked_inactive",
  "club.deletion_warning",
  "member.joined",
  "member.left",
  "member.removed",
  "member.promoted",
  "member.demoted",
  "captain.changed",
  "invitation.created",
  "invitation.closed",
] as const;
export type ClubEventType = (typeof CLUB_EVENT_TYPES)[number];

/** Which message a DM recipient gets; the bot holds the text of each. */
export const CLUB_DM_KINDS = [
  "invitation",
  "member_joined",
  "member_left",
  "member_removed",
  "promoted",
  "demoted",
  "club_deleted",
  "new_captain",
  "inactivity_warning",
  "marked_inactive",
  "deletion_warning",
] as const;
export type ClubDmKind = (typeof CLUB_DM_KINDS)[number];

export interface EventPerson {
  readonly player_id: number;
  readonly discord_id: string;
  readonly name: string;
  /** dbo.Player.Country ("" for none), for the #club-transfers post's flag. */
  readonly country: string;
}

export interface ClubEventPayload {
  readonly version: typeof CLUB_EVENT_VERSION;
  /** The club as it was; the id is filled in by the store for a club created in the same change. */
  readonly club: { readonly id: number | null; readonly name: string; readonly tag: string };
  readonly actor: EventPerson | null;
  readonly target: EventPerson | null;
  /** DMs to send, one per recipient. */
  readonly dm: readonly { readonly discord_id: string; readonly kind: ClubDmKind }[];
  /**
   * Members whose nickname tag the bot sets to their club's tag now (none when they have no club). old_tag names a
   * tag to take off that may no longer belong to any club (a deleted or renamed club).
   */
  readonly nick: readonly { readonly discord_id: string; readonly old_tag: string }[];
  /** A post in #club-transfers. */
  readonly transfer: {
    readonly action: "joined" | "left" | "removed";
    readonly discord_id: string;
    readonly country: string;
  } | null;
  /** The invitation of an invitation event; the id is filled in by the store for a new one. */
  readonly invitation: {
    readonly id: number | null;
    readonly status: string;
    readonly expires_at: string;
    readonly invited_by: string;
  } | null;
  readonly reason: string | null;
  /** The new-club counter's dates, for its warnings. */
  readonly inactive_at: string | null;
  readonly deletion_at: string | null;
}

export function emptyPayload(club: { readonly name: string; readonly tag: string }): ClubEventPayload {
  return {
    version: CLUB_EVENT_VERSION,
    club: { id: null, name: club.name, tag: club.tag },
    actor: null,
    target: null,
    dm: [],
    nick: [],
    transfer: null,
    invitation: null,
    reason: null,
    inactive_at: null,
    deletion_at: null,
  };
}

/** The recipients once each, in order, without the ones left out (the actor, who sees the result on the page). */
export function dmTo(
  discordIds: readonly string[],
  kind: ClubDmKind,
  except: readonly string[] = [],
): ClubEventPayload["dm"] {
  const seen = new Set(except.filter(Boolean));
  const recipients: { discord_id: string; kind: ClubDmKind }[] = [];
  for (const id of discordIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    recipients.push({ discord_id: id, kind });
  }
  return recipients;
}
