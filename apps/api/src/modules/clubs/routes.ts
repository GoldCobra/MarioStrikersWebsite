import { createReadStream } from "node:fs";
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MSBL_CLUBS_KEY } from "../../cache/public-data-keys.ts";
import type { Config } from "../../config.ts";
import { IMMUTABLE_ASSET } from "../../http/cache-control.ts";
import { HttpError, badRequest, notFound, sendNotFound } from "../../http/errors.ts";
import {
  isCrossSiteRequest,
  rateLimit,
  sendNoStore,
  sendPublicData,
  type RouteContext,
} from "../../http/route-context.ts";
import { toPositiveIntId, toPositiveIntOrNull } from "../../lib/numbers.ts";
import { identityFromSession } from "../profile/mappers.ts";
import type { ClubManagement, ClubOutcome, ClubRequest, MyClubView } from "./management.ts";
import { toCandidatesResponse, toMyClubResponse, toRefusalBody } from "./mappers.ts";
import type { ClubRefusalCode } from "./rules.ts";

export function registerClubRoutes(app: FastifyInstance, context: RouteContext): void {
  const { config, data } = context;
  app.get("/api/clubs", async (_request, reply) => {
    const cached = await data.publicData.get(MSBL_CLUBS_KEY);
    return sendPublicData(reply, cached, cached.payload);
  });

  app.get("/api/clubs/msbl", async (_request, reply) => {
    const cached = await data.publicData.get(MSBL_CLUBS_KEY);
    return sendPublicData(reply, cached, cached.payload);
  });

  // Logo URLs carry the file hash (?v=), so browsers may keep them forever.
  app.get<{ Params: { clubId: string } }>("/api/clubs/msbl/:clubId/logo", async (request, reply) => {
    const logo = await data.getClubLogoFile(request.params.clubId);
    if (!logo) throw notFound("Club logo not found.");
    const etag = `"${logo.hash}"`;
    reply.header("Cache-Control", IMMUTABLE_ASSET).header("ETag", etag);
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.type(logo.contentType).send(createReadStream(logo.absolutePath));
  });

  app.get<{ Params: { clubId: string } }>(
    "/api/clubs/msbl/:clubId/profile",
    rateLimit(config, 120),
    async (request, reply) => {
      const clubId = toPositiveIntOrNull(request.params.clubId);
      if (!clubId) throw badRequest("Invalid club id.");
      const profile = await data.getClubProfile(clubId);
      if (!profile) throw notFound("Club not found.");
      return sendNoStore(reply, profile);
    },
  );

  registerMyClubRoutes(app, context);
}

// ---------------------------------------------------------------------------------------------------
// My Club (docs/adr/0012): the signed-in member's club. Every route takes the member from the session only; a
// change is refused from another site's page and when My Club is not open for the member.

const AUTH_REQUIRED = { error: "Authentication required.", code: "AUTH_REQUIRED" } as const;

/** The HTTP status of each refusal of rules.ts. */
const REFUSAL_STATUS: Readonly<Record<ClubRefusalCode, number>> = {
  NOT_IN_CLUB: 409,
  ALREADY_IN_CLUB: 409,
  NOT_ALLOWED: 403,
  CLUB_NOT_FOUND: 404,
  CLUB_INVITE_ONLY: 409,
  JOIN_COOLDOWN: 409,
  REJOIN_BLOCKED: 409,
  TARGET_NOT_IN_CLUB: 404,
  CANNOT_TARGET_SELF: 400,
  ALREADY_OFFICER: 409,
  NOT_OFFICER: 409,
  OFFICER_LIMIT: 409,
  PLAYER_NOT_FOUND: 404,
  PLAYER_IN_CLUB: 409,
  PLAYER_NOT_ON_SERVER: 409,
  INVITATION_LIMIT: 409,
  REINVITE_TOO_SOON: 409,
  INVITATION_NOT_FOUND: 404,
  INVITATION_CLOSED: 409,
  SERVER_AGE_UNKNOWN: 503,
  CREATE_TOO_NEW: 409,
  CREATE_COOLDOWN: 409,
  NAME_TAKEN: 409,
  TAG_TAKEN: 409,
  CONFIRMATION_MISMATCH: 400,
  CLUB_CHANGED: 409,
};

function sendOutcome<T>(
  reply: FastifyReply,
  outcome: ClubOutcome<T>,
  toBody: (result: T) => Record<string, unknown>,
): FastifyReply {
  switch (outcome.kind) {
    case "ok":
      return sendNoStore(reply, toBody(outcome.result));
    case "refused":
      return sendNoStore(reply, toRefusalBody(outcome.refusal), REFUSAL_STATUS[outcome.refusal.code]);
    case "invalid":
      return sendNoStore(
        reply,
        { error: "Some fields are not valid.", code: "VALIDATION_FAILED", fields: outcome.errors },
        400,
      );
    case "closed":
      return sendNoStore(reply, { error: "My Club is not open yet.", code: "CLUB_MANAGEMENT_CLOSED" }, 403);
    case "not_member":
      return sendNoStore(
        reply,
        { error: "Only members of the Discord server can manage clubs.", code: "NOT_GUILD_MEMBER" },
        403,
      );
    case "discord_unavailable":
      return sendNoStore(
        reply,
        { error: "Discord could not be asked right now. Please try again.", code: "DISCORD_UNAVAILABLE" },
        503,
      );
  }
}

/** The JSON body of a change; refused unless it is JSON. */
function jsonBody(request: FastifyRequest): Record<string, unknown> {
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request as JSON.");
  }
  const body = request.body;
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function idParam(value: unknown, what: string): number {
  const id = toPositiveIntId(value);
  if (!id) throw badRequest(`Invalid ${what}.`);
  return id;
}

/** A per-member limit (invitations), keyed by the session's Discord id; per address without one. */
function memberRateLimit(config: Config, data: RouteContext["data"], max: number, timeWindow: number) {
  if (!config.rateLimitEnabled) return {};
  return {
    config: {
      rateLimit: {
        max,
        timeWindow,
        keyGenerator: (request: FastifyRequest) =>
          data.login?.sessions.readSession(request.headers.cookie)?.discord_user_id ?? request.ip,
      },
    },
  };
}

function registerMyClubRoutes(app: FastifyInstance, { config, data }: RouteContext): void {
  const sessions = data.login?.sessions ?? null;
  const clubs = data.clubs;

  /** The member behind the request with the service, or null after the 401; changes are refused from other sites. */
  function member(
    request: FastifyRequest,
    reply: FastifyReply,
    change: boolean,
  ): { readonly club: ClubRequest; readonly service: ClubManagement } | null {
    if (change && isCrossSiteRequest(request)) throw new HttpError(403, "FORBIDDEN", "Cross-site request refused.");
    const session = sessions?.readSession(request.headers.cookie) ?? null;
    if (!session || !clubs) {
      void sendNoStore(reply, AUTH_REQUIRED, 401);
      return null;
    }
    return { club: { cookie: request.headers.cookie, identity: identityFromSession(session) }, service: clubs };
  }

  const view = (result: MyClubView): Record<string, unknown> => toMyClubResponse(result);

  /** A change of the member's club: the session, JSON, then the action; the answer is the new My Club. */
  function action(
    handler: (
      service: ClubManagement,
      club: ClubRequest,
      body: Record<string, unknown>,
      params: Record<string, string>,
    ) => Promise<ClubOutcome<MyClubView>>,
    options: { readonly json?: boolean } = {},
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // Like the profile editor: another site's request first, then the body, then the session.
      if (isCrossSiteRequest(request)) throw new HttpError(403, "FORBIDDEN", "Cross-site request refused.");
      const body = options.json === false ? {} : jsonBody(request);
      const found = member(request, reply, false);
      if (!found) return reply;
      const params = request.params as Record<string, string>;
      return sendOutcome(reply, await handler(found.service, found.club, body, params), view);
    };
  }

  app.get("/api/my-club", rateLimit(config, 60), async (request, reply) => {
    const found = member(request, reply, false);
    if (!found) return reply;
    return sendOutcome(reply, await found.service.view(found.club), view);
  });

  app.get<{ Querystring: { q?: unknown; page?: unknown } }>(
    "/api/my-club/invite-candidates",
    rateLimit(config, 60),
    async (request, reply) => {
      const found = member(request, reply, false);
      if (!found) return reply;
      const query = typeof request.query.q === "string" ? request.query.q.slice(0, 50) : "";
      const page = toPositiveIntOrNull(request.query.page) ?? 1;
      return sendOutcome(reply, await found.service.inviteCandidates(found.club, query, page), toCandidatesResponse);
    },
  );

  const change = rateLimit(config, 20);
  app.post(
    "/api/my-club/create",
    rateLimit(config, 10),
    action((service, club, body) => service.create(club, body)),
  );
  app.put(
    "/api/my-club/settings",
    change,
    action((service, club, body) => service.updateSettings(club, body)),
  );
  app.post(
    "/api/my-club/join",
    change,
    action((service, club, body) => service.join(club, idParam(body.club_id, "club id"))),
  );
  app.post(
    "/api/my-club/leave",
    change,
    action((service, club) => service.leave(club), { json: false }),
  );
  app.post(
    "/api/my-club/members/:playerId/remove",
    change,
    action((service, club, _body, params) => service.removeMember(club, idParam(params.playerId, "player id")), {
      json: false,
    }),
  );
  app.put(
    "/api/my-club/members/:playerId/officer",
    change,
    action((service, club, body, params) => {
      if (typeof body.officer !== "boolean") throw badRequest("Send officer: true or false.");
      return service.setOfficer(club, idParam(params.playerId, "player id"), body.officer);
    }),
  );
  app.post(
    "/api/my-club/invitations",
    { ...memberRateLimit(config, data, 30, 60 * 60 * 1000) },
    action((service, club, body) => service.invite(club, idParam(body.player_id, "player id"))),
  );
  app.delete(
    "/api/my-club/invitations/:invitationId",
    change,
    action((service, club, _body, params) => service.revoke(club, idParam(params.invitationId, "invitation id")), {
      json: false,
    }),
  );
  app.post(
    "/api/my-club/invitations/:invitationId/accept",
    change,
    action(
      (service, club, _body, params) => service.answer(club, idParam(params.invitationId, "invitation id"), true),
      { json: false },
    ),
  );
  app.post(
    "/api/my-club/invitations/:invitationId/decline",
    change,
    action(
      (service, club, _body, params) => service.answer(club, idParam(params.invitationId, "invitation id"), false),
      { json: false },
    ),
  );
  app.post(
    "/api/my-club/activity",
    change,
    action((service, club) => service.confirmActivity(club), { json: false }),
  );
  app.post(
    "/api/my-club/delete",
    rateLimit(config, 5),
    action((service, club, body) =>
      service.deleteClub(club, typeof body.confirm_tag === "string" ? body.confirm_tag : ""),
    ),
  );

  registerInternalRoute(app, { config, data });
}

// ---------------------------------------------------------------------------------------------------
// The bot's invitation buttons (docs/adr/0012). Outside /api/: nginx proxies only /api/, so only containers on the
// Docker networks reach it, and only with the shared secret; anything else looks like a path that does not exist.

export const CLUB_INTERNAL_ANSWER_PATH = "/internal/clubs/invitations/:invitationId/answer";

function secretMatches(header: unknown, secret: string): boolean {
  if (!secret || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const given = crypto.createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(given, expected);
}

function registerInternalRoute(app: FastifyInstance, { config, data }: RouteContext): void {
  app.post<{ Params: { invitationId: string } }>(CLUB_INTERNAL_ANSWER_PATH, async (request, reply) => {
    const clubs = data.clubs;
    if (!clubs || !secretMatches(request.headers.authorization, config.clubs.internalSecret))
      return sendNotFound(reply);
    const body = (request.body ?? {}) as { discord_user_id?: unknown; answer?: unknown };
    const discordUserId = typeof body.discord_user_id === "string" ? body.discord_user_id.trim() : "";
    const invitationId = toPositiveIntId(request.params.invitationId);
    if (
      !/^\d{15,20}$/.test(discordUserId) ||
      !invitationId ||
      (body.answer !== "accept" && body.answer !== "decline")
    ) {
      throw badRequest("Send discord_user_id and answer (accept or decline).");
    }
    const outcome = await clubs.answerFromDiscord(discordUserId, invitationId, body.answer === "accept");
    return sendOutcome(reply, outcome, (result) => ({
      accepted: result.accepted,
      club_name: result.clubName,
      club_tag: result.clubTag,
    }));
  });
}
