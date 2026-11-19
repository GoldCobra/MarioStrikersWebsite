// My Club's data (GET /api/my-club; apps/api modules/clubs/mappers.ts) and the requests the page sends. Every
// change answers with the whole view, so the page draws it anew from that answer.

import type { ClubSettingsValue } from "@ms/shared/clubs";

export type ClubRole = "captain" | "officer" | "member";

export interface MyClubMember {
  readonly player_id: number;
  readonly name: string;
  readonly country: string;
  /** "" when the member is not on the Discord server. */
  readonly discord_name: string;
  readonly role: ClubRole;
  readonly joined_at: string | null;
  /** Not on the Discord server now (only shown to the captain and the officers). */
  readonly absent: boolean;
  readonly actions: { readonly remove: boolean; readonly promote: boolean; readonly demote: boolean };
}

export interface ClubInvitation {
  readonly id: number;
  readonly player_id: number;
  readonly name: string;
  readonly invited_by: string;
  readonly created_at: string;
  readonly expires_at: string;
}

export interface MyClub {
  readonly club_id: number;
  readonly name: string;
  readonly tag: string;
  readonly logo: string;
  readonly is_open: boolean;
  readonly status: string;
  readonly regions: readonly string[];
  readonly club_codes: readonly string[];
  readonly first_uniform: string;
  readonly second_uniform: string;
  readonly stadium: string;
  readonly discord_url: string;
  readonly settings_version: string;
  readonly activity: string | null;
  readonly is_active: boolean;
  readonly created_at: string | null;
  /** The new-club counter: when the club is marked inactive and when it is deleted; null once established. */
  readonly inactive_at: string | null;
  readonly deletion_at: string | null;
  readonly role: ClubRole;
  readonly permissions: {
    readonly invite: boolean;
    readonly edit_settings: boolean;
    readonly confirm_activity: boolean;
    readonly promote: boolean;
    readonly delete_club: boolean;
    readonly leave: boolean;
  };
  readonly officers: { readonly count: number; readonly max: number };
  readonly members: readonly MyClubMember[];
  /** The club's open invitations (for the captain and the officers). */
  readonly invitations: readonly ClubInvitation[];
}

export interface PlayerInvitation {
  readonly id: number;
  readonly club_id: number;
  readonly club_name: string;
  readonly club_tag: string;
  readonly invited_by: string;
  readonly created_at: string;
  readonly expires_at: string;
}

export interface MyClubState {
  readonly player_id: number;
  readonly club: MyClub | null;
  readonly invitations: readonly PlayerInvitation[];
  readonly create: {
    readonly allowed: boolean;
    readonly reason: { readonly error: string; readonly code: string } | null;
  };
  /** J3: joining a club by oneself waits until then. */
  readonly join_cooldown_until: string | null;
  /** J4: clubs the member cannot rejoin yet. */
  readonly join_blocks: readonly { readonly club_id: number; readonly until: string }[];
}

export interface InviteCandidate {
  readonly player_id: number;
  readonly name: string;
  readonly discord_name: string;
  readonly country: string;
  /** The same club can invite the player again from then on; null when it can now. */
  readonly invitable_from: string | null;
}

export interface InviteCandidates {
  readonly total: number;
  readonly page: number;
  readonly candidates: readonly InviteCandidate[];
}

export interface FieldErrorBody {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

/** An answer of the API: its status and its body (an error body has `error` and `code`). */
export interface ClubResponse<T> {
  readonly status: number;
  readonly ok: boolean;
  readonly body: T | null;
  readonly error: { readonly error?: string; readonly code?: string; readonly fields?: readonly FieldErrorBody[] };
}

export const MY_CLUB_URL = "/api/my-club";

/** One request to the API, JSON in and out; a network failure is status 0. */
export async function clubRequest<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<ClubResponse<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    headers["Content-Type"] = body.type;
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: payload,
    });
    const json = (await response.json().catch(() => null)) as unknown;
    const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    return {
      status: response.status,
      ok: response.ok,
      body: response.ok ? (json as T) : null,
      error: response.ok ? {} : record,
    };
  } catch {
    return { status: 0, ok: false, body: null, error: {} };
  }
}

/** The settings of a club as the shared rules take them. */
export function settingsOf(club: MyClub): ClubSettingsValue {
  return {
    isOpen: club.is_open,
    regions: club.regions,
    clubCodes: club.club_codes,
    firstUniform: club.first_uniform,
    secondUniform: club.second_uniform,
    stadium: club.stadium,
    discordUrl: club.discord_url,
  };
}
