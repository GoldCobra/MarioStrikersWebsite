// Reading and patching MSC "Online" friendlists (layout in docs/save-tools.md). A file holds one profile
// per game region header; each profile has up to 64 friend records and a block of friend names.
// Pure functions over bytes: changes are made on a copy that is only returned when it parses back.

import { crc8, writeHeaderCrc32 } from "../shared/checksums.ts";

const REGION_LABELS: Readonly<Record<string, string>> = { R4QP: "PAL", R4QE: "NTSC-U", R4QJ: "NTSC-J", R4QK: "NTSC-K" };
const FRIEND_TYPE_FRIEND_KEY = 0x00001000;
const VALID_FRIEND_TYPES = new Set([0x00003800, 0x00001800, FRIEND_TYPE_FRIEND_KEY]);
const FRIEND_DATA_OFFSET = 0x1c;
const FRIEND_NAME_OFFSET = 0x31c;
const FRIEND_NAME_WRITE_LIMIT = 0xa20;
const PROFILE_NAME_OFFSETS = [0xa84, 0xa9c];
const DWC_USER_DATA_SIZE = 0x40;
const DWC_USER_DATA_PROFILE_ID_OFFSET = 0x1c;
const DWC_USER_DATA_GAME_ID_OFFSET = 0x24;
const FRIEND_RECORD_SIZE = 12;
const NAME_SCAN_LIMIT = 0x800;
export const MAX_FRIENDS = (FRIEND_NAME_OFFSET - FRIEND_DATA_OFFSET) / FRIEND_RECORD_SIZE;

export interface Player {
  readonly name: string;
  readonly storedLabel: string;
  readonly type: number;
  readonly profileId: number;
  readonly checkValue: number;
  readonly friendCode: string;
}

export interface Profile {
  readonly gameId: string;
  readonly region: string;
  readonly offset: number;
  readonly endOffset: number;
  readonly ownProfileId: number;
  readonly ownFriendCode: string;
  readonly profileName: string;
  readonly players: readonly Player[];
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface FriendCode {
  readonly profileId: number;
  readonly checkValue: number;
  readonly friendCode: string;
}

export interface FriendCodeBatch {
  readonly entries: readonly FriendCode[];
  readonly skipped: { own: number; existing: number; duplicate: number };
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) >>> 0;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((((bytes[offset] ?? 0) << 24) >>> 0) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function writeU32BE(bytes: Uint8Array, offset: number, value: number): void {
  const normalized = value >>> 0;
  bytes[offset] = (normalized >>> 24) & 0xff;
  bytes[offset + 1] = (normalized >>> 16) & 0xff;
  bytes[offset + 2] = (normalized >>> 8) & 0xff;
  bytes[offset + 3] = normalized & 0xff;
}

function isAllowedStringCode(code: number): boolean {
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xffef);
}

function hasLetter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    const code = value.charCodeAt(index);
    if ((char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || (code >= 0x00c0 && code !== 0x2122))
      return true;
  }
  return false;
}

function isPlayerName(value: string): boolean {
  const text = value.trim();
  return text.length > 0 && text.length <= 32 && hasLetter(text);
}

function isPendingLabel(value: string): boolean {
  return /^\d{6} \d{6}$/.test(value.trim());
}

function readUtf16BEString(bytes: Uint8Array, offset: number, maxChars: number): string {
  if (offset < 0 || offset + 1 >= bytes.length) return "";
  const chars: string[] = [];
  for (let index = 0, at = offset; index < Math.max(1, maxChars) && at + 1 < bytes.length; index += 1, at += 2) {
    const code = readU16BE(bytes, at);
    if (code === 0 || !isAllowedStringCode(code)) break;
    chars.push(String.fromCharCode(code));
  }
  return chars.join("").trim();
}

/** Zero-terminated UTF-16 names from a profile's name block, with their positions. */
function readFriendNames(bytes: Uint8Array, start: number, end: number): { value: string }[] {
  const entries: { value: string }[] = [];
  const maxOffset = Math.min(end, bytes.length, start + NAME_SCAN_LIMIT);
  let offset = start;
  while (offset + 1 < maxOffset) {
    let zeroRun = 0;
    while (offset + 1 < maxOffset && readU16BE(bytes, offset) === 0) {
      zeroRun += 1;
      offset += 2;
    }
    if (entries.length > 0 && zeroRun >= 8) break;
    let chars: string[] = [];
    while (offset + 1 < maxOffset) {
      const code = readU16BE(bytes, offset);
      if (code === 0) break;
      if (!isAllowedStringCode(code)) {
        chars = [];
        break;
      }
      chars.push(String.fromCharCode(code));
      offset += 2;
    }
    const value = chars.join("").trim();
    if (isPlayerName(value) || isPendingLabel(value)) entries.push({ value });
    offset += 2;
  }
  return entries;
}

function writeUtf16BEString(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index <= value.length; index += 1) {
    const code = index < value.length ? value.charCodeAt(index) : 0;
    bytes[offset + index * 2] = (code >>> 8) & 0xff;
    bytes[offset + index * 2 + 1] = code & 0xff;
  }
}

function pendingLabel(friendCode: string): string {
  const digits = friendCode.replace(/\D/g, "");
  return digits.length === 12 ? `${digits.slice(0, 6)} ${digits.slice(6)}` : "";
}

/** Where the next friend name goes: right after the last one, or null when the block looks unusual. */
function nameAppendOffset(bytes: Uint8Array, profile: Profile): number | null {
  const start = profile.offset + FRIEND_NAME_OFFSET;
  const maxOffset = Math.min(profile.endOffset, bytes.length, profile.offset + FRIEND_NAME_WRITE_LIMIT);
  let offset = start;
  let appendOffset = start;
  while (offset + 1 < maxOffset) {
    let zeroRun = 0;
    while (offset + 1 < maxOffset && readU16BE(bytes, offset) === 0) {
      zeroRun += 1;
      offset += 2;
    }
    if (zeroRun >= 8) return appendOffset;
    let sawChars = false;
    while (offset + 1 < maxOffset) {
      const code = readU16BE(bytes, offset);
      if (code === 0) break;
      if (!isAllowedStringCode(code)) return null;
      sawChars = true;
      offset += 2;
    }
    if (!sawChars || offset + 1 >= maxOffset) return null;
    appendOffset = offset + 2;
    offset += 2;
  }
  return null;
}

function friendKeyCheck(profileId: number, gameId: string): number {
  const reversed = [3, 2, 1, 0].map((index) => gameId.charCodeAt(index));
  return (
    crc8([
      profileId & 0xff,
      (profileId >>> 8) & 0xff,
      (profileId >>> 16) & 0xff,
      (profileId >>> 24) & 0xff,
      ...reversed,
    ]) & 0x7f
  );
}

function formatFriendKey(profileId: number, checkValue: number): string {
  const raw = String((checkValue >>> 0) * 0x1_0000_0000 + (profileId >>> 0)).padStart(12, "0");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

function parseProfile(bytes: Uint8Array, offset: number, gameId: string, endOffset: number, index: number): Profile {
  const records = [];
  const maxOffset = Math.min(endOffset, bytes.length);
  for (
    let count = 0, at = offset + FRIEND_DATA_OFFSET;
    count < MAX_FRIENDS && at + FRIEND_RECORD_SIZE <= maxOffset;
    count += 1
  ) {
    const type = readU32BE(bytes, at);
    const profileId = readU32BE(bytes, at + 4);
    const checkValue = readU32BE(bytes, at + 8);
    if ((type === 0 && profileId === 0 && checkValue === 0) || !VALID_FRIEND_TYPES.has(type) || profileId === 0) break;
    records.push({ type, profileId, checkValue });
    at += FRIEND_RECORD_SIZE;
  }
  const names = readFriendNames(bytes, offset + FRIEND_NAME_OFFSET, endOffset);
  const profileName = PROFILE_NAME_OFFSETS.map((nameOffset) => readUtf16BEString(bytes, offset + nameOffset, 16)).find(
    isPlayerName,
  );

  const userData = offset - DWC_USER_DATA_GAME_ID_OFFSET;
  const ownProfileId =
    userData >= 0 && userData + DWC_USER_DATA_SIZE <= bytes.length && readU32BE(bytes, userData) === DWC_USER_DATA_SIZE
      ? readU32BE(bytes, userData + DWC_USER_DATA_PROFILE_ID_OFFSET)
      : 0;

  return {
    gameId,
    region: REGION_LABELS[gameId] ?? "",
    offset,
    endOffset,
    ownProfileId,
    ownFriendCode: ownProfileId ? formatFriendKey(ownProfileId, friendKeyCheck(ownProfileId, gameId)) : "",
    profileName: profileName ?? `Profile ${index}`,
    players: records.map((record, position) => {
      const storedLabel = names[position]?.value ?? "";
      const pending = record.type === FRIEND_TYPE_FRIEND_KEY;
      return {
        name:
          storedLabel && !isPendingLabel(storedLabel)
            ? storedLabel
            : pending
              ? "Pending Friend"
              : `Player ${position + 1}`,
        storedLabel,
        type: record.type,
        profileId: record.profileId,
        checkValue: record.checkValue,
        friendCode: pending
          ? formatFriendKey(record.profileId, record.checkValue)
          : formatFriendKey(record.profileId, friendKeyCheck(record.profileId, gameId)),
      };
    }),
  };
}

export function parseOnlineFile(bytes: Uint8Array): Result<{ profiles: Profile[] }> {
  if (bytes.length === 0) return { ok: false, error: "Online file is empty." };
  const headers: { offset: number; gameId: string }[] = [];
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    const gameId = String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    );
    if (Object.hasOwn(REGION_LABELS, gameId)) headers.push({ offset, gameId });
  }
  const profiles: Profile[] = [];
  headers.forEach((header, index) => {
    const endOffset = headers[index + 1]?.offset ?? bytes.length;
    if (header.offset + FRIEND_DATA_OFFSET + 8 > endOffset) return;
    profiles.push(parseProfile(bytes, header.offset, header.gameId, endOffset, profiles.length + 1));
  });
  return profiles.length ? { ok: true, profiles } : { ok: false, error: "no valid profiles found" };
}

function parseFriendCode(raw: string, profile: Profile): Result<FriendCode> {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Enter a friend code." };
  if (/[A-Za-z]/.test(text)) return { ok: false, error: "Friend codes can only contain numbers." };
  const digits = text.replace(/[- ]/g, "");
  if (digits.length !== 12) return { ok: false, error: "Friend code must contain exactly 12 numbers." };
  if (!/^(\d{4}-\d{4}-\d{4}|\d{12}|\d{6} \d{6})$/.test(text)) {
    return { ok: false, error: "Use 1234-5678-9012, 123456789012, or 123456 789012." };
  }
  const key = BigInt(digits);
  if (key === 0n) return { ok: false, error: "Friend code is invalid." };
  const profileId = Number(key & 0xffffffffn) >>> 0;
  const checkValue = Number(key >> 32n) >>> 0;
  if (checkValue !== friendKeyCheck(profileId, profile.gameId)) {
    return { ok: false, error: `Friend code checksum does not match ${profile.region}.` };
  }
  return { ok: true, profileId, checkValue, friendCode: formatFriendKey(profileId, checkValue) };
}

function hasFriend(profile: Profile, profileId: number): boolean {
  return profile.players.some((player) => player.profileId >>> 0 === profileId >>> 0);
}

/** One code per line; the whole batch fails on the first invalid line. Own, known and repeated codes are skipped. */
export function parseFriendCodeBatch(text: string, profile: Profile): Result<FriendCodeBatch> {
  const entries: FriendCode[] = [];
  const seen = new Set<number>();
  const skipped = { own: 0, existing: 0, duplicate: 0 };
  let lines = 0;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    lines += 1;
    const parsed = parseFriendCode(line, profile);
    if (!parsed.ok) return { ok: false, error: `Line ${index + 1}: ${parsed.error}` };
    if (profile.ownProfileId && parsed.profileId === profile.ownProfileId) skipped.own += 1;
    else if (hasFriend(profile, parsed.profileId)) skipped.existing += 1;
    else if (seen.has(parsed.profileId)) skipped.duplicate += 1;
    else {
      seen.add(parsed.profileId);
      entries.push(parsed);
    }
  }
  if (!lines) return { ok: false, error: "Enter at least one friend code." };
  return { ok: true, entries, skipped };
}

export function skippedCount(skipped: FriendCodeBatch["skipped"]): number {
  return skipped.own + skipped.existing + skipped.duplicate;
}

export function batchAddStatus(added: number, skipped: FriendCodeBatch["skipped"]): string {
  const details = [
    skipped.own ? `${skipped.own} own` : "",
    skipped.existing ? `${skipped.existing} already present` : "",
    skipped.duplicate ? `${skipped.duplicate} duplicate in batch` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const count = skippedCount(skipped);
  if (added <= 0) return `No codes added. ${count} skipped (${details}).`;
  return `${added} code${added === 1 ? "" : "s"} added.${count > 0 ? ` ${count} skipped (${details}).` : ""} Export Online to save the patched file.`;
}

function freeFriendSlots(bytes: Uint8Array, profile: Profile, required: number): Result<{ offsets: number[] }> {
  const offsets: number[] = [];
  if (!required) return { ok: true, offsets };
  let offset = profile.offset + FRIEND_DATA_OFFSET;
  const maxOffset = Math.min(profile.endOffset, bytes.length, offset + MAX_FRIENDS * FRIEND_RECORD_SIZE);
  let foundFree = false;
  for (let count = 0; count < MAX_FRIENDS && offset + FRIEND_RECORD_SIZE <= maxOffset; count += 1) {
    const type = readU32BE(bytes, offset);
    const profileId = readU32BE(bytes, offset + 4);
    const checkValue = readU32BE(bytes, offset + 8);
    if (type === 0 && profileId === 0 && checkValue === 0) {
      foundFree = true;
      offsets.push(offset);
      if (offsets.length === required) return { ok: true, offsets };
    } else if (foundFree) {
      return { ok: false, error: "Friend list contains data after a free slot." };
    } else if (!VALID_FRIEND_TYPES.has(type) || profileId === 0) {
      return { ok: false, error: "Friend list contains unsupported data before a free slot." };
    }
    offset += FRIEND_RECORD_SIZE;
  }
  return { ok: false, error: "This profile has no free friend slots." };
}

/** Adds pending friend keys to a profile, each with its numeric label in the name block. */
export function addFriendCodes(
  bytes: Uint8Array,
  profile: Profile,
  codes: readonly FriendCode[],
): Result<{ bytes: Uint8Array; profiles: Profile[] }> {
  if (profile.players.length + codes.length > MAX_FRIENDS) {
    return {
      ok: false,
      error: `Adding ${codes.length} new codes would exceed ${MAX_FRIENDS} friends for this profile.`,
    };
  }
  const slots = freeFriendSlots(bytes, profile, codes.length);
  if (!slots.ok) return slots;
  const next = new Uint8Array(bytes);
  const maxOffset = Math.min(profile.endOffset, next.length, profile.offset + FRIEND_NAME_WRITE_LIMIT);
  for (const [index, code] of codes.entries()) {
    const slot = slots.offsets[index] ?? 0;
    writeU32BE(next, slot, FRIEND_TYPE_FRIEND_KEY);
    writeU32BE(next, slot + 4, code.profileId);
    writeU32BE(next, slot + 8, code.checkValue);
    const label = pendingLabel(code.friendCode);
    const labelOffset = nameAppendOffset(next, profile);
    if (!label || labelOffset === null || labelOffset + (label.length + 1) * 2 > maxOffset) {
      return { ok: false, error: "This profile has no free friend label slot." };
    }
    writeUtf16BEString(next, labelOffset, label);
  }
  writeHeaderCrc32(next);
  const parsed = parseOnlineFile(next);
  if (!parsed.ok) return { ok: false, error: "Patched Online file could not be parsed." };
  return { ok: true, bytes: next, profiles: parsed.profiles };
}

function nameToWrite(player: Player): string {
  const stored = player.storedLabel.trim();
  const name = player.name.trim();
  if (stored && isPlayerName(stored)) return stored;
  if (player.type === FRIEND_TYPE_FRIEND_KEY) return pendingLabel(player.friendCode);
  if (name && !/^Player \d+$/.test(name) && name !== "Pending Friend" && isPlayerName(name)) return name;
  return "";
}

/** Removes friends from a profile; the rest move up so no record follows an empty slot. */
export function deleteFriends(
  bytes: Uint8Array,
  profile: Profile,
  profileIndex: number,
  indices: readonly number[],
): Result<{ bytes: Uint8Array; profiles: Profile[] }> {
  if (!indices.length) return { ok: false, error: "Select at least one friend code." };
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= profile.players.length)) {
    return { ok: false, error: "Selected friend code is no longer available." };
  }
  const remaining = profile.players.filter((_, index) => !indices.includes(index));
  const next = new Uint8Array(bytes);

  const recordStart = profile.offset + FRIEND_DATA_OFFSET;
  if (recordStart + MAX_FRIENDS * FRIEND_RECORD_SIZE > Math.min(profile.endOffset, next.length)) {
    return { ok: false, error: "Friend roster could not be rewritten safely." };
  }
  for (let index = 0; index < MAX_FRIENDS; index += 1) {
    const player = remaining[index];
    const offset = recordStart + index * FRIEND_RECORD_SIZE;
    writeU32BE(next, offset, player?.type ?? 0);
    writeU32BE(next, offset + 4, player?.profileId ?? 0);
    writeU32BE(next, offset + 8, player?.checkValue ?? 0);
  }

  const nameStart = profile.offset + FRIEND_NAME_OFFSET;
  const nameLimit = Math.min(profile.endOffset, next.length, profile.offset + FRIEND_NAME_WRITE_LIMIT);
  const oldEnd = nameAppendOffset(next, profile);
  if (oldEnd === null || oldEnd < nameStart || oldEnd > nameLimit) {
    return { ok: false, error: "Friend name block could not be rebuilt." };
  }
  const labels = remaining.map(nameToWrite);
  if (labels.some((label) => !label))
    return { ok: false, error: "Friend name block contains an unsupported player name." };
  const totalBytes = labels.reduce((sum, label) => sum + (label.length + 1) * 2, 0);
  if (nameStart + totalBytes > nameLimit)
    return { ok: false, error: "Friend name block is too small for the remaining roster." };
  next.fill(0, nameStart, Math.min(nameLimit, Math.max(oldEnd, nameStart + totalBytes + 16)));
  let cursor = nameStart;
  for (const label of labels) {
    writeUtf16BEString(next, cursor, label);
    cursor += (label.length + 1) * 2;
  }

  writeHeaderCrc32(next);
  const parsed = parseOnlineFile(next);
  if (!parsed.ok) return { ok: false, error: "Patched Online file could not be parsed." };
  const updated = parsed.profiles[profileIndex];
  const matches =
    updated?.players.length === remaining.length &&
    remaining.every(
      (player, index) =>
        updated.players[index]?.type === player.type >>> 0 &&
        updated.players[index].profileId === player.profileId >>> 0 &&
        updated.players[index].checkValue === player.checkValue >>> 0,
    );
  if (!matches) return { ok: false, error: "Patched friend roster failed validation." };
  return { ok: true, bytes: next, profiles: parsed.profiles };
}
