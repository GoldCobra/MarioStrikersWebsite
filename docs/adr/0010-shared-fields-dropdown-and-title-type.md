# 0010: One field, one dropdown and one title type for every view

Status: accepted (2026-10-02)

## Context

The player popup, the Discord card (`/player-card`) and the profile page show
the same fields: a heading over grey one-line boxes (the friend codes, the
country, the player title). Each view had grown its own numbers for them, and
the profile page had a second box for an open field and its own dropdown type:

- The country and title lists sat inside containers that cut off what overflows
  them (`.popup-card` `overflow: hidden`, `.player-popup-content`
  `overflow-y: auto`) and under the floating save bar, so a list near the end of
  a short card was cut off or covered.
- Their field and options set 16px type (against zoom on phones) while the
  line's value was 15px, and options were 32px tall.
- A title in the profile's field and list took the page's letter spacing and
  was cut at its top and bottom by the value's `overflow: hidden` (glow
  included), while the popup and the card used the title's own spacing.
- The Reporter face puts its capitals about a pixel above the middle of its
  line box, an open line was 8.8px taller than a closed one, and the heading
  gap differed between popup and card.
- The Discord card took the phone rules of `mobile.css` and a `vw`-sized name
  when the bot's window was narrow: the same CSS numbers gave a visibly
  different card depending on that window.

## Decision

- **Field tokens** in `styles/base.css` (`--field-*`): type, box height (26px),
  control height (24px: pencils, dropdown fields, digits), box padding and the
  heading gap. `.player-popup-code-row` and the profile's open line
  (`.profile-edit-row`) are the same box; an open line is as tall as a closed
  one.
- **Field text** (`.player-popup-code-prefix`, `.player-popup-code-value`,
  `.dropdown-text`) is trimmed to its capitals with
  `text-box: trim-both cap alphabetic`, so the box's flex centring centres the
  letters whatever the face's metrics; long values end in an ellipsis
  (`overflow-x: clip`) and are never cut at top or bottom; a glow keeps
  `--field-glow-room` at both ends. Browsers without `text-box` centre the line
  box (a pixel higher with this face).
- **One dropdown** (`src/lib/dropdown.ts`, `styles/dropdown.css`) for a choice
  whose options a native `<select>` cannot show (flags, title looks). The open
  list is a manual popover in the top layer, placed next to its field by
  `dropdownPlacement()`: below, or above when there is more room there, never
  taller than 280px or the room it has; it scrolls and follows the field. Field
  and options inherit the line's type; option spacing comes from
  `--dropdown-*` (24px rows, 28px on touch screens), which the account menu and
  the MSC profile menu use too. A plain text choice stays a native `<select>`
  in the line's type (16px only on iOS, which zooms into smaller fields).
- **One title type**: `.player-title` (`styles/player-popup.css`) holds the
  face, size, spacing (`--player-title-letter-spacing`, 0.45 of the Reporter
  spacing), FULL CAPS, colour and glow; `playerTitleHtml()` /
  `showPlayerTitle()` (`player-profile-view.ts`) build every title, with its
  ball, in the popup, on the card, in the profile's field and in the title
  dropdown's field and options.
- **The Discord card is viewport-independent**: `:root, .player-popup.is-card`
  declare the Reporter tokens together, the popup's phone rules in `mobile.css`
  exclude the card (`:where(:not(.is-card, .is-card *))`, no change in weight)
  and the card's name has the popup's wide-window size.

## Consequences

- A change of field type, box height, heading gap, dropdown spacing or title
  type is one token or one rule and reaches every view; the e2e flows in
  `tests/e2e/specs/csp.spec.ts` check that the views agree (title look, value
  centring, heading gaps, open and closed line height), that a dropdown is
  never cut off or covered and reaches every option, and that the card is
  pixel-identical in windows 550 to 1440px wide.
- A new dropdown on the site uses `createDropdown()`; its width comes from the
  class the caller passes.
- Native selects (save editors, an MSC code's region and platform) keep the
  operating system's list; their option spacing is the system's.

## Open points

- The bot's window size is not recorded in this repository. The card is the
  same in every window at least 550px wide; a narrower window cannot show the
  550px card whole anyway.
- Firefox does not support `text-box` yet: there a value sits about a pixel
  above the middle of its box, as before. Digits in the open Switch and MSC
  fields are text inputs, which `text-box` does not reach either.
