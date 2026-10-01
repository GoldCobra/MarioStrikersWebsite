// The signed-in player's own profile. A profile is created at the first login and reused afterwards,
// whether the website, futbot or robotic_nightmare created it: dbo.Player.DiscordID is unique.

import { HttpError } from "../../http/errors.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import { playerNameFromDiscord, type DiscordIdentity } from "./mappers.ts";

export interface EnsuredPlayer {
  readonly playerId: number;
  /** True when this call created the profile. */
  readonly created: boolean;
}

/** Where profiles are kept: the database (repository.ts) or the memory of the fixtures. */
export interface ProfileStore {
  /** The player of this Discord id; one with this name is created when there is none. */
  ensurePlayer(discordId: string, name: string): Promise<EnsuredPlayer>;
}

export interface ProfileService {
  ensurePlayer(identity: DiscordIdentity): Promise<EnsuredPlayer>;
}

export function createProfileService(store: ProfileStore): ProfileService {
  return {
    async ensurePlayer(identity) {
      const discordId = normalizeDiscordId(identity.id);
      if (!discordId) throw new HttpError(400, "BAD_REQUEST", "Invalid Discord user id.");
      return store.ensurePlayer(discordId, playerNameFromDiscord(identity));
    },
  };
}
