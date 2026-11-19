import assert from "node:assert/strict";
import test from "node:test";
import { adminClubsHtml, filterClubs, type AdminClubRow, type AdminClubsResponse } from "./admin-clubs.ts";

const CLUBS: AdminClubRow[] = [
  { club_id: 5, public_id: "Ab3dEf9h", name: "Hammer Bros", tag: "HB", members: 3, has_logo: true },
  { club_id: 7, public_id: "Zz8xWv7u", name: "Solo <Club>", tag: "SOLO", members: 1, has_logo: false },
];

const RESPONSE: AdminClubsResponse = { mode: "admins", clubs: CLUBS };

test("the search finds clubs by name, tag or backend id, in any case", () => {
  assert.deepEqual(
    filterClubs(CLUBS, "hammer").map((club) => club.club_id),
    [5],
  );
  assert.deepEqual(
    filterClubs(CLUBS, "zz8x").map((club) => club.club_id),
    [7],
  );
  assert.equal(filterClubs(CLUBS, " ").length, 2);
});

test("each club shows its id and members and the actions it has; names are escaped", () => {
  const html = adminClubsHtml(RESPONSE, { query: "", form: null });
  assert.match(html, /Hammer Bros \[HB\]<\/strong> <span class="admin-club-facts">ID Ab3dEf9h · 3 members/);
  assert.match(html, /Solo &lt;Club&gt; \[SOLO\]/);
  assert.equal((html.match(/data-admin-club="logo"/g) ?? []).length, 1, "only a club with a logo offers removing it");
  assert.match(html, /1 member</);
});

test("an open form: rename with both fields, delete only after the tag is typed", () => {
  const rename = adminClubsHtml(RESPONSE, { query: "", form: { clubId: 5, kind: "rename" } });
  assert.match(rename, /data-admin-field="name" value="Hammer Bros"/);
  assert.match(rename, /data-admin-field="tag" value="HB"/);
  const remove = adminClubsHtml(RESPONSE, { query: "", form: { clubId: 7, kind: "delete" } });
  assert.match(remove, /data-admin-club="delete-confirm" data-club-id="7" disabled/);
});

test("in mode off the list stays, the actions are off", () => {
  const html = adminClubsHtml({ ...RESPONSE, mode: "off" }, { query: "", form: null });
  assert.match(html, /Club management is off/);
  assert.equal((html.match(/data-admin-club="rename" data-club-id="\d+" disabled/g) ?? []).length, 2);
});
