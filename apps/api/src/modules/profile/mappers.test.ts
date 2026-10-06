import assert from "node:assert/strict";
import test from "node:test";
import { identityFromLogin, identityFromSession, playerNameFromDiscord, type DiscordIdentity } from "./mappers.ts";

const identity = (overrides: Partial<DiscordIdentity> = {}): DiscordIdentity => ({
  id: "709777875686916210",
  username: "goldcobra",
  globalName: "GoldCobra",
  nick: "",
  ...overrides,
});

test("a new profile is named like the member shows on the server", () => {
  assert.equal(playerNameFromDiscord(identity({ nick: "Cobra" })), "Cobra");
  assert.equal(playerNameFromDiscord(identity()), "GoldCobra");
  assert.equal(playerNameFromDiscord(identity({ globalName: "" })), "goldcobra");
  assert.equal(playerNameFromDiscord(identity({ globalName: "", username: "" })), "Player 709777875686916210");
});

test("the club tag the nickname sync adds is left out, so it is not added twice", () => {
  assert.equal(playerNameFromDiscord(identity({ nick: "[CE] GoldCobra" })), "GoldCobra");
  assert.equal(playerNameFromDiscord(identity({ nick: "  [CE]   Gold Cobra  " })), "Gold Cobra");
  // A nickname that is only a tag falls back to the global name.
  assert.equal(playerNameFromDiscord(identity({ nick: "[CE] " })), "GoldCobra");
  // Brackets elsewhere are part of the name.
  assert.equal(playerNameFromDiscord(identity({ nick: "Gold [CE] Cobra" })), "Gold [CE] Cobra");
  assert.equal(playerNameFromDiscord(identity({ nick: "[CE]Cobra" })), "[CE]Cobra");
});

test("names keep emoji whole and fit dbo.Player.Name", () => {
  assert.equal(playerNameFromDiscord(identity({ nick: "Cobra 🐍" })), "Cobra 🐍");
  const long = "🐍".repeat(120);
  assert.equal(Array.from(playerNameFromDiscord(identity({ nick: long }))).length, 100);
  assert.equal(playerNameFromDiscord(identity({ nick: long })), "🐍".repeat(100));
});

test("identities come from the login or the session", () => {
  assert.deepEqual(
    identityFromLogin({
      user: { id: " 123 ", username: "tester", global_name: null, avatar: "hash" },
      nick: " Nick ",
      roles: [],
    }),
    { id: "123", username: "tester", globalName: "", nick: "Nick" },
  );
  assert.deepEqual(
    identityFromSession({
      discord_user: { id: "123", username: "tester", global_name: "Tester", avatar: "" },
      discord_user_id: "123",
      guild_nick: "[CE] Tester",
    }),
    { id: "123", username: "tester", globalName: "Tester", nick: "[CE] Tester" },
  );
  // Sessions from before the nickname was stored.
  assert.deepEqual(identityFromSession({ discord_user_id: "123" }), {
    id: "123",
    username: "",
    globalName: "",
    nick: "",
  });
});
