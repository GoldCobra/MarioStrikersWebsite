// Input files for the save tool checks: the sample saves in the web root and a synthetic MSC "Online"
// friendlist, built to the layout docs/save-tools.md describes (no real player data).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const SAVEGAMES = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/assets/savegames");

export const MSBL_SAVE = readFileSync(join(SAVEGAMES, "100-msbl-comp/strkrs.save"));
export const MSC_SAVE_PAL = readFileSync(join(SAVEGAMES, "100-msc-comp/pal/Strikers2"));
export const MSC_SAVE_NTSC_U = readFileSync(join(SAVEGAMES, "100-msc-comp/ntsc-u/Strikers2"));

/**
 * The MSBL sample save with no gear bought for the first eight characters, so "Have All Gear" and gear
 * presets have something to write. Entries are found through the entry table like the editor does:
 * a character header (tag 0xB5D1609D) followed by at least ten gear fields (tag 0xCE8AE847).
 */
export function msblSaveWithoutGear(characters = 8): Buffer {
  const bytes = Buffer.from(MSBL_SAVE);
  const count = bytes.readUInt32LE(0x8);
  const tableEnd = 0x18 + count * 12;
  const rows = Array.from({ length: count }, (_, index) => ({
    size: bytes.readUInt32LE(0x18 + index * 12 + 4),
    relOff: bytes.readUInt32LE(0x18 + index * 12 + 8),
  }));
  const base = tableEnd - Math.min(...rows.filter((row) => row.size >= 4).map((row) => row.relOff));
  const entries = rows.map((row) => {
    const offset = base + row.relOff;
    return row.size >= 8
      ? { offset, tag: bytes.readUInt32LE(offset), dlen: bytes.readUInt32LE(offset + 4), payload: row.size - 8 }
      : { offset, tag: -1, dlen: -1, payload: -1 };
  });
  const isField = (entry: (typeof entries)[number] | undefined): boolean =>
    entry?.tag === 0xce8ae847 && entry.dlen === 4 && entry.payload === 4;
  let blocks = 0;
  for (let index = 0; index < entries.length && blocks < characters; index += 1) {
    const header = entries[index];
    if (header?.tag !== 0xb5d1609d || header.dlen !== 1 || header.payload !== 2) continue;
    const fields = [];
    while (fields.length < 12 && isField(entries[index + 1 + fields.length]))
      fields.push(entries[index + 1 + fields.length]);
    if (fields.length < 10) continue;
    for (const position of [1, 4, 2, 6, 3, 5, 7, 8, 9]) {
      const field = fields[position];
      if (field) bytes.fill(0, field.offset + 8, field.offset + 12);
    }
    blocks += 1;
    index += fields.length;
  }
  if (blocks !== characters) throw new Error(`Expected ${characters} character blocks, found ${blocks}.`);
  return bytes;
}

const FRIEND_TYPE_BUDDY = 0x3800;
const FRIEND_TYPE_PROFILE_ID = 0x1800;
const FRIEND_TYPE_FRIEND_KEY = 0x1000;

function crc8(bytes: readonly number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte & 0xff;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** The friend-code check value of a profile ID in a game region (e.g. "R4QP"). */
export function friendCheck(profileId: number, gameId: string): number {
  const reversed = [3, 2, 1, 0].map((index) => gameId.charCodeAt(index));
  return (
    crc8([profileId & 0xff, (profileId >>> 8) & 0xff, (profileId >>> 16) & 0xff, profileId >>> 24, ...reversed]) & 0x7f
  );
}

/** "####-####-####" for a profile ID in a game region. */
export function friendCode(profileId: number, gameId: string): string {
  const raw = String(friendCheck(profileId, gameId) * 0x1_0000_0000 + profileId).padStart(12, "0");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

function writeU32(bytes: Buffer, offset: number, value: number): void {
  bytes.writeUInt32BE(value >>> 0, offset);
}

function writeName(bytes: Buffer, offset: number, name: string): number {
  for (let index = 0; index < name.length; index += 1) bytes.writeUInt16BE(name.charCodeAt(index), offset + index * 2);
  return offset + (name.length + 1) * 2;
}

interface Profile {
  readonly offset: number;
  readonly gameId: string;
  readonly profileId: number;
  readonly name: string;
  readonly friends: readonly { type: number; profileId: number; name: string }[];
}

export const ONLINE_PROFILES = [
  {
    offset: 0x40,
    gameId: "R4QP",
    profileId: 123_456_789,
    name: "Tester",
    friends: [
      { type: FRIEND_TYPE_BUDDY, profileId: 111_111_111, name: "Alice" },
      { type: FRIEND_TYPE_PROFILE_ID, profileId: 222_222_222, name: "Bob" },
      { type: FRIEND_TYPE_FRIEND_KEY, profileId: 333_333_333, name: "" },
    ],
  },
  { offset: 0xc40, gameId: "R4QE", profileId: 987_654_321, name: "Second", friends: [] },
] as const satisfies readonly Profile[];

/** Two profiles (PAL with an established buddy, a profile-ID friend and a pending key; NTSC-U empty). */
export function buildOnlineFile(): Buffer {
  const bytes = Buffer.alloc(0x1800);
  for (const profile of ONLINE_PROFILES) {
    const userData = profile.offset - 0x24;
    writeU32(bytes, userData, 0x40);
    writeU32(bytes, userData + 0x1c, profile.profileId);
    bytes.write(profile.gameId, profile.offset, "latin1");
    writeName(bytes, profile.offset + 0xa84, profile.name);
    let nameOffset = profile.offset + 0x31c;
    profile.friends.forEach((friend, index) => {
      const record = profile.offset + 0x1c + index * 12;
      const check = friendCheck(friend.profileId, profile.gameId);
      writeU32(bytes, record, friend.type);
      writeU32(bytes, record + 4, friend.profileId);
      writeU32(bytes, record + 8, friend.type === FRIEND_TYPE_FRIEND_KEY ? check : 0);
      const digits = friendCode(friend.profileId, profile.gameId).replace(/-/g, "");
      nameOffset = writeName(bytes, nameOffset, friend.name || `${digits.slice(0, 6)} ${digits.slice(6)}`);
    });
  }
  writeU32(bytes, 4, crc32(bytes.subarray(8)));
  return bytes;
}
