// The Strikers2 layout the MSC save editor relies on (see docs/save-tools.md): team preset offsets per
// captain, the sidekick numbering of the save and the competitive default settings every export writes.

export const FILE_NAME = "Strikers2";
export const FILE_SIZE = 35616;
export const FILE_MAGIC = 0x00008b02;

export interface Character {
  readonly id: number;
  readonly name: string;
  /** File name part of the icon, e.g. "bowserjr". */
  readonly key: string;
}

export const CAPTAINS: readonly Character[] = [
  { id: 1, name: "Mario", key: "mario" },
  { id: 2, name: "Peach", key: "peach" },
  { id: 3, name: "DK", key: "dk" },
  { id: 4, name: "Waluigi", key: "waluigi" },
  { id: 5, name: "Luigi", key: "luigi" },
  { id: 6, name: "Wario", key: "wario" },
  { id: 7, name: "Bowser", key: "bowser" },
  { id: 8, name: "Yoshi", key: "yoshi" },
  { id: 9, name: "Daisy", key: "daisy" },
  { id: 10, name: "Bowser Jr.", key: "bowserjr" },
  { id: 11, name: "Diddy Kong", key: "diddykong" },
  { id: 12, name: "Petey", key: "petey" },
];

export const SIDEKICKS: readonly Character[] = [
  { id: 1, name: "Koopa", key: "koopa" },
  { id: 2, name: "Toad", key: "toad" },
  { id: 3, name: "Dry Bones", key: "drybones" },
  { id: 4, name: "Boo", key: "boo" },
  { id: 5, name: "Birdo", key: "birdo" },
  { id: 6, name: "Hammer Bros.", key: "hammerbros" },
  { id: 7, name: "Monty Mole", key: "montymole" },
  { id: 8, name: "Shy Guy", key: "shyguy" },
];

/** Offsets of each captain's top, bottom and back sidekick. */
export const TEAM_PRESET_OFFSETS: Readonly<Record<number, { top: number; bottom: number; back: number }>> = {
  1: { top: 139, bottom: 143, back: 147 },
  2: { top: 199, bottom: 203, back: 207 },
  3: { top: 175, bottom: 179, back: 183 },
  4: { top: 211, bottom: 215, back: 219 },
  5: { top: 187, bottom: 191, back: 195 },
  6: { top: 223, bottom: 227, back: 231 },
  7: { top: 151, bottom: 155, back: 159 },
  8: { top: 235, bottom: 239, back: 243 },
  9: { top: 163, bottom: 167, back: 171 },
  10: { top: 247, bottom: 251, back: 255 },
  11: { top: 259, bottom: 263, back: 267 },
  12: { top: 271, bottom: 275, back: 279 },
};

/** Sidekick id in the editor (SIDEKICKS order) → value in the save. */
export const SIDEKICK_UI_TO_SAVE: Readonly<Record<number, number>> = { 1: 1, 2: 0, 3: 5, 4: 4, 5: 3, 6: 2, 7: 6, 8: 7 };
export const SIDEKICK_SAVE_TO_UI: Readonly<Record<number, number>> = { 0: 2, 1: 1, 2: 6, 3: 5, 4: 4, 5: 3, 6: 7, 7: 8 };

/**
 * Competitive defaults, written to the local and the online settings block on every export: skill 3,
 * first to 10 goals, series of 3, Secure Stadia on, power-up and player cheats off.
 */
export const COMPETITIVE_SETTINGS = {
  skillLevel: 3,
  gameType: 1, // 0 minutes, 1 goals
  goals: 10,
  seriesLength: 3,
  environmentCheat: 0, // 0 Secure Stadia, 3 Field Tilt, 8 none
  powerUpCheat: 1, // 0 Bombs Away, 1 none, 4 Shells
  playerCheat: 0, // 0 none, 2 Safe Megastrike, 4 Classic Mode
} as const;

export const SETTINGS_BLOCKS: readonly Readonly<Record<keyof typeof COMPETITIVE_SETTINGS, number>>[] = [
  {
    skillLevel: 47,
    gameType: 51,
    goals: 59,
    seriesLength: 63,
    environmentCheat: 75,
    powerUpCheat: 79,
    playerCheat: 83,
  },
  {
    skillLevel: 87,
    gameType: 91,
    goals: 99,
    seriesLength: 103,
    environmentCheat: 115,
    powerUpCheat: 119,
    playerCheat: 123,
  },
];

/** Camera: type byte (0 static) and level as big-endian float, (level - 1) / 4; the default is static, level 1. */
export const CAMERA_TYPE_OFFSET = 36;
export const CAMERA_VALUE_OFFSET = 40;
