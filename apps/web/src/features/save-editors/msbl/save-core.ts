// Reading and patching MSBL strkrs.save files. A save is a table of entries (key hash, size, offset);
// patches change entry payloads in place and never the file length. Pure functions over bytes, so the
// Node tests run them directly.

import {
  BUILDER_DIGIT_TO_LOADOUT_ID,
  BUSHIDO_UNLOCK_HASH,
  BYTE_INDEX_BY_PART,
  CHARACTER_FIELD_TAG,
  CHARACTER_HEADER_TAG,
  CHARACTER_NAMES,
  COIN_HASH,
  CUP_BATTLE_PROGRESS,
  CUP_COMPLETED_DETAILS,
  CUP_GLOBAL_STATE,
  EMPTY_CUP_RUN_HEX,
  GEAR_PARTS,
  MARIO_LOADOUT_HASH,
  SET_FIELD_POSITIONS,
  type PayloadSpec,
} from "./save-format.ts";

export const MAX_COINS = 0xffffffff;

interface SaveEntry {
  readonly keyHash: number;
  readonly size: number;
  readonly absOff: number;
  /** A copy of the entry's bytes; patches edit it and saveToBytes writes it back. */
  readonly raw: Uint8Array;
  readonly payloadOff: number;
}

interface ParsedSave {
  readonly buf: Uint8Array;
  readonly entryCount: number;
  readonly entries: readonly SaveEntry[];
  readonly byHash: ReadonlyMap<number, readonly SaveEntry[]>;
}

interface CharacterBlock {
  readonly fields: readonly SaveEntry[];
}

export interface EditableSave {
  readonly save: ParsedSave;
  readonly coinEntry: SaveEntry;
  readonly charBlocks: readonly CharacterBlock[];
}

export interface GearPresetCharacter {
  readonly id: number;
  readonly name: string;
  /** Four Gear Builder digits: head, arms, body, legs. */
  readonly build: string;
}

export interface GearPresetResult {
  readonly changed: boolean;
  readonly characterCount: number;
  readonly usesBushido: boolean;
}

export type PatchOutcome = boolean | GearPresetResult;

export interface PatchResult {
  readonly bytes: Uint8Array;
  readonly changed: boolean;
  readonly info: { readonly entryCount: number; readonly charBlockCount: number; readonly coins: number };
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error("Cannot read u32 outside byte buffer.");
  return (
    ((bytes[offset] ?? 0) +
      (bytes[offset + 1] ?? 0) * 0x100 +
      (bytes[offset + 2] ?? 0) * 0x10000 +
      (bytes[offset + 3] ?? 0) * 0x1000000) >>>
    0
  );
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error("Cannot write u32 outside byte buffer.");
  const normalized = value >>> 0;
  bytes[offset] = normalized & 0xff;
  bytes[offset + 1] = (normalized >>> 8) & 0xff;
  bytes[offset + 2] = (normalized >>> 16) & 0xff;
  bytes[offset + 3] = (normalized >>> 24) & 0xff;
}

function entryTag(entry: SaveEntry): number | null {
  return entry.size >= 8 ? readU32LE(entry.raw, 0) : null;
}

function entryDataLength(entry: SaveEntry): number | null {
  return entry.size >= 8 ? readU32LE(entry.raw, 4) : null;
}

function payloadLength(entry: SaveEntry): number {
  return entry.raw.length - entry.payloadOff;
}

function payload(entry: SaveEntry): Uint8Array {
  return entry.raw.subarray(entry.payloadOff, entry.payloadOff + payloadLength(entry));
}

function parseSave(input: Uint8Array): ParsedSave {
  const bytes = new Uint8Array(input);
  if (bytes.length < 0x18) throw new Error("Save too small.");
  const entryCount = readU32LE(bytes, 0x8);
  const tableStart = 0x18;
  const tableEnd = tableStart + entryCount * 12;
  if (tableEnd > bytes.length) throw new Error("Entry table exceeds file size.");

  const rows = [];
  let minNormalRel: number | null = null;
  for (let index = 0; index < entryCount; index += 1) {
    const rowOffset = tableStart + index * 12;
    const row = {
      keyHash: readU32LE(bytes, rowOffset),
      size: readU32LE(bytes, rowOffset + 4),
      relOff: readU32LE(bytes, rowOffset + 8),
    };
    rows.push(row);
    if (row.size >= 4 && (minNormalRel === null || row.relOff < minNormalRel)) minNormalRel = row.relOff;
  }

  const base = tableEnd - (minNormalRel ?? 0);
  const entries: SaveEntry[] = [];
  const byHash = new Map<number, SaveEntry[]>();
  rows.forEach((row, index) => {
    const absOff = base + row.relOff;
    if (absOff < 0 || absOff + row.size > bytes.length) throw new Error(`Entry ${index} out of bounds.`);
    const entry: SaveEntry = {
      keyHash: row.keyHash >>> 0,
      size: row.size,
      absOff,
      raw: bytes.slice(absOff, absOff + row.size),
      payloadOff: row.size >= 8 ? 8 : 0,
    };
    entries.push(entry);
    const list = byHash.get(entry.keyHash);
    if (list) list.push(entry);
    else byHash.set(entry.keyHash, [entry]);
  });
  return { buf: bytes, entryCount, entries, byHash };
}

function saveToBytes(save: ParsedSave): Uint8Array {
  const out = new Uint8Array(save.buf);
  for (const entry of save.entries) out.set(entry.raw, entry.absOff);
  return out;
}

function first(save: ParsedSave, keyHash: number): SaveEntry | null {
  return save.byHash.get(keyHash >>> 0)?.[0] ?? null;
}

function coinEntryOf(save: ParsedSave): SaveEntry {
  const entry = first(save, COIN_HASH);
  if (!entry || payloadLength(entry) < 4) throw new Error("Coin entry not found.");
  return entry;
}

function isCharacterField(entry: SaveEntry): boolean {
  return entryTag(entry) === CHARACTER_FIELD_TAG && entryDataLength(entry) === 4 && payloadLength(entry) === 4;
}

/** A character header entry followed by 10 to 12 gear fields, once per character. */
function characterBlocks(save: ParsedSave): CharacterBlock[] {
  const blocks: CharacterBlock[] = [];
  const { entries } = save;
  let index = 0;
  while (index < entries.length) {
    const header = entries[index];
    if (
      header &&
      entryTag(header) === CHARACTER_HEADER_TAG &&
      entryDataLength(header) === 1 &&
      payloadLength(header) === 2
    ) {
      const fields: SaveEntry[] = [];
      let next = index + 1;
      for (let field = entries[next]; field && fields.length < 12 && isCharacterField(field); field = entries[next]) {
        fields.push(field);
        next += 1;
      }
      if (fields.length >= 10) {
        blocks.push({ fields });
        index = next;
        continue;
      }
    }
    index += 1;
  }
  return blocks;
}

function loadEditable(bytes: Uint8Array): EditableSave {
  const save = parseSave(bytes);
  return { save, coinEntry: coinEntryOf(save), charBlocks: characterBlocks(save) };
}

function requireAllCharacters(context: EditableSave): void {
  if (context.charBlocks.length < 16) {
    throw new Error(`Character blocks not found correctly (found ${context.charBlocks.length}).`);
  }
}

const hexCache = new Map<string, Uint8Array>();

function bytesFromHex(hex: string): Uint8Array {
  const cached = hexCache.get(hex);
  if (cached) return cached;
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0) throw new Error("Invalid hex payload length.");
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    const value = parseInt(clean.slice(index, index + 2), 16);
    if (!Number.isInteger(value)) throw new Error("Invalid hex payload.");
    out[index / 2] = value;
  }
  hexCache.set(hex, out);
  return out;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function applyCoins(save: ParsedSave, coins: number): boolean {
  const entry = coinEntryOf(save);
  if (readU32LE(entry.raw, entry.payloadOff) === coins) return false;
  writeU32LE(entry.raw, entry.payloadOff, coins);
  return true;
}

/** The writable entry for a known key; character data is refused so a hash clash cannot damage it. */
function patchableEntry(save: ParsedSave, keyHash: number, label: string, expectedLength: number): SaveEntry {
  const entry = first(save, keyHash);
  if (!entry) throw new Error(`${label} entry not found.`);
  if (entryTag(entry) === CHARACTER_FIELD_TAG)
    throw new Error(`${label} entry points to character data; refusing to modify it.`);
  if (payloadLength(entry) !== expectedLength) {
    throw new Error(`${label} entry has unexpected size (${payloadLength(entry)} != ${expectedLength}).`);
  }
  return entry;
}

function setPayloadExact(save: ParsedSave, keyHash: number, label: string, value: Uint8Array): boolean {
  const entry = patchableEntry(save, keyHash, label, value.length);
  if (bytesEqual(payload(entry), value)) return false;
  entry.raw.set(value, entry.payloadOff);
  return true;
}

/** Cup details are only written over a cup nobody has played, never over real results. */
function setCupDetailIfEmpty(save: ParsedSave, spec: PayloadSpec): boolean {
  const completed = bytesFromHex(spec.payloadHex);
  const entry = patchableEntry(save, spec.keyHash, spec.label, completed.length);
  const current = payload(entry);
  if (bytesEqual(current, completed) || !bytesEqual(current, bytesFromHex(EMPTY_CUP_RUN_HEX))) return false;
  entry.raw.set(completed, entry.payloadOff);
  return true;
}

export function completeCupsAndUnlockBushido(save: ParsedSave): boolean {
  let changed = false;
  for (const spec of [...CUP_BATTLE_PROGRESS, ...CUP_GLOBAL_STATE]) {
    changed = setPayloadExact(save, spec.keyHash, spec.label, bytesFromHex(spec.payloadHex)) || changed;
  }
  for (const spec of CUP_COMPLETED_DETAILS) changed = setCupDetailIfEmpty(save, spec) || changed;
  return setPayloadExact(save, BUSHIDO_UNLOCK_HASH, "Bushido unlock", new Uint8Array([1])) || changed;
}

export function ownAllGear(context: EditableSave): boolean {
  let changed = false;
  context.charBlocks.forEach((block, blockIndex) => {
    for (const part of GEAR_PARTS) {
      const byteIndex = BYTE_INDEX_BY_PART[part];
      for (const fieldPos of SET_FIELD_POSITIONS) {
        const field = block.fields[fieldPos];
        if (!field) continue;
        const rawOffset = field.payloadOff + byteIndex;
        if (rawOffset < 0 || rawOffset >= field.raw.length) {
          throw new Error(`Unexpected gear field size in character block ${blockIndex + 1}.`);
        }
        if (field.raw[rawOffset] !== 1) {
          field.raw[rawOffset] = 1;
          changed = true;
        }
      }
    }
  });
  return changed;
}

export function characterName(id: number): string {
  return CHARACTER_NAMES[id - 1] ?? `Character ${id}`;
}

/** The entry holding a character's equipped gear: Mario's own entry, else field 10 of the block before. */
function loadoutEntry(context: EditableSave, characterIndex: number): SaveEntry {
  const entry =
    characterIndex === 0
      ? first(context.save, MARIO_LOADOUT_HASH)
      : (context.charBlocks[characterIndex - 1]?.fields[10] ?? null);
  const name = characterName(characterIndex + 1);
  if (!entry) throw new Error(`Equipped gear entry not found for ${name}.`);
  if (entryTag(entry) !== CHARACTER_FIELD_TAG || payloadLength(entry) !== 4) {
    throw new Error(`Equipped gear entry has unexpected format for ${name}.`);
  }
  return entry;
}

/** Equips a character's preset and marks every non-default piece as bought. */
function writeGearPreset(
  context: EditableSave,
  preset: GearPresetCharacter,
): { changed: boolean; usesBushido: boolean } {
  const block = context.charBlocks[preset.id - 1];
  if (!block) throw new Error(`Character block not found for id ${preset.id}.`);
  const equipped = loadoutEntry(context, preset.id - 1);
  let changed = false;
  let usesBushido = false;

  GEAR_PARTS.forEach((part, partIndex) => {
    const digit = Number(preset.build.charAt(partIndex));
    const byteIndex = BYTE_INDEX_BY_PART[part];
    const loadoutId = BUILDER_DIGIT_TO_LOADOUT_ID[digit];
    if (loadoutId === undefined) throw new Error("Gear preset import failed: unsupported gear digit.");

    const loadoutOffset = equipped.payloadOff + byteIndex;
    if (equipped.raw[loadoutOffset] !== loadoutId) {
      equipped.raw[loadoutOffset] = loadoutId;
      changed = true;
    }
    if (digit === 0) return;
    if (digit === 6) usesBushido = true;

    const purchase = block.fields[SET_FIELD_POSITIONS[digit - 1] ?? -1];
    if (!purchase) throw new Error(`Purchase gear entry not found for ${characterName(preset.id)}.`);
    const purchaseOffset = purchase.payloadOff + byteIndex;
    if (purchaseOffset < 0 || purchaseOffset >= purchase.raw.length) {
      throw new Error(`Purchase gear entry has unexpected size for ${characterName(preset.id)}.`);
    }
    if (purchase.raw[purchaseOffset] !== 1) {
      purchase.raw[purchaseOffset] = 1;
      changed = true;
    }
  });
  return { changed, usesBushido };
}

/** Applies Gear Builder presets; Bushido gear also needs the cups completed to be usable. */
export function applyGearPreset(context: EditableSave, characters: readonly GearPresetCharacter[]): GearPresetResult {
  let changed = false;
  let usesBushido = false;
  for (const character of characters) {
    const result = writeGearPreset(context, character);
    changed = result.changed || changed;
    usesBushido = result.usesBushido || usesBushido;
  }
  if (usesBushido) changed = completeCupsAndUnlockBushido(context.save) || changed;
  return { changed, characterCount: characters.length, usesBushido };
}

export function parseCoins(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const text = raw.trim();
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(value) || value < 0 || value > MAX_COINS) {
    return { ok: false, error: "Coins must be an integer between 0 and 4294967295." };
  }
  return { ok: true, value };
}

/** Parses a save, checks that all 16 characters are found and returns its bytes and coins. */
export function readSave(bytes: Uint8Array): PatchResult {
  return patchSave(bytes, () => false);
}

/** Runs a patch on a fresh parse of the bytes; nothing changes when it throws. */
export function patchSave(bytes: Uint8Array, patcher: (context: EditableSave) => PatchOutcome): PatchResult {
  const context = loadEditable(bytes);
  requireAllCharacters(context);
  const outcome = patcher(context);
  const coinEntry = coinEntryOf(context.save);
  return {
    bytes: saveToBytes(context.save),
    changed: typeof outcome === "object" ? outcome.changed : outcome,
    info: {
      entryCount: context.save.entryCount,
      charBlockCount: context.charBlocks.length,
      coins: readU32LE(coinEntry.raw, coinEntry.payloadOff),
    },
  };
}

export function setCoins(context: EditableSave, coins: number): boolean {
  return applyCoins(context.save, coins);
}
