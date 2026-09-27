import assert from "node:assert/strict";
import test from "node:test";
import { tamper } from "../../test-support/app.ts";
import {
  appendQuery,
  createSignedToken,
  normalizeReturnTo,
  parseCookies,
  serializeCookie,
  verifySignedToken,
} from "./tokens.ts";

test("signed tokens verify and reject tampering, other secrets and expiry", () => {
  const token = createSignedToken({ discord_user_id: "123", expires_at: 2_000 }, "secret");
  assert.equal(verifySignedToken(token, "secret", 1_000)?.discord_user_id, "123");
  assert.equal(verifySignedToken(tamper(token), "secret", 1_000), null);
  assert.equal(verifySignedToken(token, "other-secret", 1_000), null);
  assert.equal(verifySignedToken(token, "secret", 2_001), null);
  for (const malformed of [undefined, "", "abc", "a.b.c", `${Buffer.from("[1]").toString("base64url")}.x`]) {
    assert.equal(verifySignedToken(malformed, "secret", 1_000), null);
  }
});

test("returnTo normalization rejects external and API targets", () => {
  assert.equal(normalizeReturnTo("/profile?tab=main"), "/profile?tab=main");
  assert.equal(normalizeReturnTo("/players#top"), "/players#top");
  for (const unsafe of [
    "https://evil.example/profile",
    "//evil.example/profile",
    "/api/health",
    "profile",
    "/a\r\nb",
    "",
  ]) {
    assert.equal(normalizeReturnTo(unsafe), "/profile", unsafe);
  }
  assert.equal(appendQuery("/profile?tab=main#x", { auth: "success" }), "/profile?tab=main&auth=success#x");
});

test("cookies parse leniently and serialize in the previous attribute order", () => {
  assert.deepEqual(parseCookies("a=1; broken; b=%E0%A4%A; =x; c=%20two"), { a: "1", c: " two" });
  assert.equal(
    serializeCookie("msc_session", "v", { maxAgeSeconds: 60, path: "/", secure: true }),
    "msc_session=v; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax",
  );
  assert.equal(
    serializeCookie("msc_session", "", { maxAgeSeconds: 0, expires: new Date(0), secure: false }),
    "msc_session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax",
  );
});
