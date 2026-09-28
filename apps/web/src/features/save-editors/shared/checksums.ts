// Checksums of the MSC files: the CRC32 in the header of Strikers2 and Online, and the CRC8 in friend
// codes.

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (0xedb88320 ^ (value >>> 1)) >>> 0 : value >>> 1;
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

/** Standard CRC32 of bytes[start..]. */
export function crc32(bytes: Uint8Array, start = 0): number {
  const lookup = table();
  let crc = 0xffffffff;
  for (let offset = start; offset < bytes.length; offset += 1) {
    crc = ((lookup[(crc ^ (bytes[offset] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Writes the header CRC of an MSC file: CRC32 over 0x08..end, big-endian at 0x04. */
export function writeHeaderCrc32(bytes: Uint8Array): void {
  const crc = crc32(bytes, 8);
  bytes[4] = (crc >>> 24) & 0xff;
  bytes[5] = (crc >>> 16) & 0xff;
  bytes[6] = (crc >>> 8) & 0xff;
  bytes[7] = crc & 0xff;
}

/** CRC8 (polynomial 0x07) as friend codes use it. */
export function crc8(bytes: readonly number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte & 0xff;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}
