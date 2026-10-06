// The admin page's overview: who is signed in, the access window and the latest admin activity.

import assert from "node:assert/strict";
import test from "node:test";
import { adminOverviewHtml, formatUtc, type AdminOverviewResponse } from "./admin-overview.ts";

const OVERVIEW: AdminOverviewResponse = {
  admin: { discord_user_id: "195905866527014912", username: "goldcobra111", global_name: "GoldCobra" },
  access_until: "2026-10-06T22:00:00.000Z",
  role_checked_at: "2026-10-06T10:01:00.000Z",
  audit: [
    {
      at: "2026-10-06T10:00:00.000Z",
      discord_user_id: "195905866527014912",
      action: "page.open",
      target: "",
      outcome: "allowed",
    },
  ],
};

test("dates are shown in UTC; a missing one as -", () => {
  assert.equal(formatUtc("2026-10-06T22:00:00.000Z"), "6 Oct 2026, 22:00 UTC");
  assert.equal(formatUtc(""), "-");
  assert.equal(formatUtc("not a date"), "-");
});

test("the overview names the admin, the access window and each activity", () => {
  const html = adminOverviewHtml(OVERVIEW);
  assert.match(html, /^<h2>Admin<\/h2>/);
  assert.match(html, /Signed in as <strong>GoldCobra<\/strong> \(goldcobra111\)\./);
  assert.match(html, /Admin access until 6 Oct 2026, 22:00 UTC; log in again after that\./);
  assert.match(html, /Discord role confirmed 6 Oct 2026, 10:01 UTC\./);
  assert.match(html, /<li>6 Oct 2026, 10:00 UTC · page\.open · allowed · Discord 195905866527014912<\/li>/);
});

test("an empty or unavailable log says so; names fall back and are escaped", () => {
  assert.match(adminOverviewHtml({ ...OVERVIEW, audit: [] }), /<p>No admin activity recorded yet\.<\/p>/);
  assert.match(adminOverviewHtml({ ...OVERVIEW, audit: null }), /<p>The admin log is unavailable right now\.<\/p>/);
  const plain = adminOverviewHtml({ ...OVERVIEW, admin: { ...OVERVIEW.admin, global_name: "" } });
  assert.match(plain, /Signed in as <strong>goldcobra111<\/strong>\./);
  const hostile = adminOverviewHtml({
    ...OVERVIEW,
    admin: { ...OVERVIEW.admin, global_name: "<img src=x>" },
    audit: [{ at: "", discord_user_id: "1", action: "page.open", target: "<script>", outcome: "allowed" }],
  });
  assert.doesNotMatch(hostile, /<img|<script/);
  assert.match(hostile, /&lt;img src=x&gt;/);
});
