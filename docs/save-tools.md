# Browser save tools

All tools read, patch and export user-selected files in the browser. They do
not upload saves or friendlists. Keep original files for comparison and use
synthetic fixtures when adding repository tests.

## MSBL: Gear Builder and save editor

The Gear Builder at `/msbl-gear-builder` stores preset drafts in
`sessionStorage` and exports edited character builds as XML:

```xml
<msbl-gear-presets version="1">
  <character id="..." name="..." build="1234" />
</msbl-gear-presets>
```

There is one entry per edited character. Build digits are Head, Arms, Body and
Legs, using Gear Builder values `0..9`. See
[Gear Builder maintenance](msbl-gear-builder-snapshot.md) before importing
upstream assets or scripts.

The save editor at `/msbl-save-editor` is implemented by
`js/msbl-save-editor-contract.js` and `js/msbl-save-editor.js`. It loads
`strkrs.save`, edits Coins as an unsigned 32-bit value, imports Gear Builder
presets and applies character loadouts. It can complete all Cups, unlock Bushido
Gear and apply Have All Gear for all 16 characters. Export preserves the original
filename and byte length.

## MSC: Strikers2 saves

The SAVE mode at `/msc-save-editor` uses `js/msc-save-editor-contract.js`
and `js/msc-save-editor.js`.

| Property | Value |
| --- | --- |
| Filename | `Strikers2` |
| Length | `35616` bytes |
| Regions | `R4QP01`, `R4QE01`, `R4QJ01`, `R4QK01` |
| Header checksum | CRC32 stored at `0x0004..0x0007`, covering `0x0008..EOF` |

The editor validates region, size and magic, edits all 12 captain team presets,
offers visual captain/sidekick selection and imports/exports XML presets.
The contract writes default competitive settings. Export applies the current
in-browser draft, updates the checksum and preserves the save length.

## MSC: Online friendlists

The FRIENDLIST mode on the same page uses `js/msc-online-editor.js`.

| Property | Value |
| --- | --- |
| Filename | Usually `Online` |
| Profile headers | `R4QP`, `R4QE`, `R4QJ`, `R4QK` |
| FriendData offset | `profileOffset + 0x1C` |
| Friend-name offset | `profileOffset + 0x31C` |
| Capacity | 64 entries per profile |
| Header checksum | Same CRC32 range as `Strikers2` |

The editor detects profiles and displays name, region, own friend code and
roster count. It parses established friends and pending friend-key tokens;
entries without a stored name display a pending fallback.

Friend codes use a profile ID and CRC8 over `PID little-endian + reversed
game id`. The 12-digit friend key is `(checkValue << 32) | profileId`,
displayed as `####-####-####`.

Adding codes accepts one per line as `1234-5678-9012`, `123456789012` or
`123456 789012`. Invalid nonempty lines abort the entire addition. Own codes,
existing codes and duplicate inputs are skipped with a summary. Additions must
fit within 64 slots; new entries use pending tokens `0x00001000` and numeric
pending labels.

Deleting selected entries affects only the active profile. It compacts
FriendData so no entry remains after an empty slot, and rebuilds the aligned
friend-name block. Export downloads the patched `Online` file with an updated
checksum and unchanged byte length.

Add/delete operations use an in-memory copy. Patching, checksum or reparse
failures restore the previous byte buffer.

## Validation when changing tools

Check supported regions, malformed/incorrect-size inputs and import/export
round trips. Verify that exports preserve file length, relevant checksums and
unmodified fields. For friendlists, cover duplicates, own codes, capacity,
multiple profiles and name alignment after deletion. Compare the parsed result
after export, not only the displayed editor state.
