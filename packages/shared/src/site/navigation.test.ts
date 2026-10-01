import assert from "node:assert/strict";
import { test } from "node:test";
import { loginPath } from "./navigation.ts";

test("the login returns to the profile, or to the given path of the site", () => {
  assert.equal(loginPath(), "/api/auth/discord/start?returnTo=%2Fprofile");
  assert.equal(loginPath("/profile?edit=1"), "/api/auth/discord/start?returnTo=%2Fprofile%3Fedit%3D1");
});
