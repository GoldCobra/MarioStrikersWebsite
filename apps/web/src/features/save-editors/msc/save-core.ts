// Reading and writing MSC Strikers2 saves: region detection, the 12 captains' team presets, the
// competitive default settings and the header checksum. Pure functions over bytes.

import { writeHeaderCrc32 } from "../shared/checksums.ts";
import {
  CAMERA_TYPE_OFFSET,
  CAMERA_VALUE_OFFSET,
  CAPTAINS,
  COMPETITIVE_SETTINGS,
  FILE_MAGIC,
  FILE_SIZE,
  SETTINGS_BLOCKS,
  SIDEKICKS,
  SIDEKICK_SAVE_TO_UI,
  SIDEKICK_UI_TO_SAVE,
  TEAM_PRESET_OFFSETS,
} from "./save-format.ts";

export interface Region {
  readonly code: string;
  readonly label: string;
}

export const REGIONS = {
  PAL: { code: "R4QP01", label: "PAL" },
  NTSC_U: { code: "R4QE01", label: "NTSC-U" },
  NTSC_J: { code: "R4QJ01", label: "NTSC-J" },
  NTSC_K: { code: "R4QK01", label: "NTSC-K" },
  UNKNOWN: { code: "R4Q?01", label: "UNKNOWN" },
} as const satisfies Record<string, Region>;

/** Sidekick ids (1..8, editor order) of one captain's team. */
export interface Team {
  readonly top: number;
  readonly bottom: number;
  readonly back: number;
}

export type SaveCheck = { ok: true; region: Region; regionKnown: boolean } | { ok: false; error: string };

export function captainName(id: number): string {
  return CAPTAINS.find((captain) => captain.id === id)?.name ?? `Captain ${id}`;
}

export function sidekickName(id: number): string {
  return SIDEKICKS.find((sidekick) => sidekick.id === id)?.name ?? `Sidekick ${id}`;
}

/** Checks size and header of a raw Strikers2 file and tells its region from the trailer bytes. */
export function checkSave(bytes: Uint8Array): SaveCheck {
  if (bytes.length === 0) {
    return {
      ok: false,
      error: "This file is empty. Please select the raw Strikers2 save file (35616 bytes), not the region marker file.",
    };
  }
  if (bytes.length !== FILE_SIZE) {
    return {
      ok: false,
      error: `Unsupported file size (${bytes.length}). Expected a raw Strikers2 file (35616 bytes).`,
    };
  }
  if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false) !== FILE_MAGIC) {
    return { ok: false, error: "Invalid Strikers2 header. This does not look like a supported raw save." };
  }
  const trailerA = bytes[0x8b00];
  const trailerB = bytes[0x8b01];
  if (trailerA === 0xff && trailerB === 0xff) {
    const ntscUMarks = [35535, 35543, 35547, 35551, 35555, 35563].filter((offset) => bytes[offset] === 0x03).length;
    return { ok: true, region: ntscUMarks >= 4 ? REGIONS.NTSC_U : REGIONS.PAL, regionKnown: true };
  }
  if (trailerA === 0x10 && trailerB === 0x00) {
    return { ok: true, region: bytes[135] === 0x65 ? REGIONS.NTSC_K : REGIONS.NTSC_J, regionKnown: true };
  }
  return { ok: true, region: REGIONS.UNKNOWN, regionKnown: false };
}

function sidekickFromSave(value: number | undefined): number {
  const saveValue = value ?? Number.NaN;
  return SIDEKICK_SAVE_TO_UI[saveValue] ?? saveValue;
}

/** A captain's team as stored in the save (unknown save values come through unmapped). */
export function readTeam(bytes: Uint8Array, captainId: number): Team | null {
  const offsets = TEAM_PRESET_OFFSETS[captainId];
  if (!offsets) return null;
  return {
    top: sidekickFromSave(bytes[offsets.top]),
    bottom: sidekickFromSave(bytes[offsets.bottom]),
    back: sidekickFromSave(bytes[offsets.back]),
  };
}

/** The save with the given teams, the competitive defaults and a fresh header checksum. */
export function writeTeams(bytes: Uint8Array, teams: Readonly<Record<string, Team>>): Uint8Array {
  const next = new Uint8Array(bytes);
  for (const [captainId, team] of Object.entries(teams)) {
    const offsets = TEAM_PRESET_OFFSETS[Number(captainId)];
    if (!offsets) continue;
    next[offsets.top] = SIDEKICK_UI_TO_SAVE[team.top] ?? team.top;
    next[offsets.bottom] = SIDEKICK_UI_TO_SAVE[team.bottom] ?? team.bottom;
    next[offsets.back] = SIDEKICK_UI_TO_SAVE[team.back] ?? team.back;
  }
  for (const block of SETTINGS_BLOCKS) {
    for (const [setting, offset] of Object.entries(block)) {
      next[offset] = COMPETITIVE_SETTINGS[setting as keyof typeof COMPETITIVE_SETTINGS];
    }
  }
  next[CAMERA_TYPE_OFFSET] = 0;
  new DataView(next.buffer, next.byteOffset, next.byteLength).setFloat32(CAMERA_VALUE_OFFSET, 0, false);
  writeHeaderCrc32(next);
  return next;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The XML the XML-Export button saves: all 12 captains' teams. */
export function presetXml(teams: Readonly<Record<string, Team>>, region: Region): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<msc-presets version="1" region="${escapeXml(region.code)}">`,
    ...CAPTAINS.map((captain) => {
      const team = teams[String(captain.id)];
      return `  <captain id="${captain.id}" name="${escapeXml(captain.name)}" top="${team?.top}" bottom="${team?.bottom}" back="${team?.back}" />`;
    }),
    "</msc-presets>",
  ];
  return lines.join("\n");
}
