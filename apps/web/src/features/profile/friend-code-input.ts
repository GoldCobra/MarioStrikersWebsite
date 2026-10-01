// The three four-digit fields of a friend code. Only the digits 0-9 ever land in them: typing, pasting,
// dropping, autofill and phone keyboards (composition) all pass through the same filter. Leading zeros
// stay, since the fields hold text. A full field moves the focus on; Backspace in an empty field and the
// arrow keys at a field's edge move between the fields of one code.

import { FRIEND_CODE_BLOCK_LENGTH, digitsOnly, pastedFriendCodeDigits } from "@ms/shared/friend-codes";

export const PASTE_REJECTED = "Paste a 12-digit friend code (digits only).";

export interface Spread {
  readonly values: string[];
  /** The field and caret position after the inserted digits. */
  readonly field: number;
  readonly caret: number;
}

/**
 * Inserts digits into field `index` in place of its selection. The fields from there on behave like one
 * text: what follows the insertion moves along into the next fields, and digits beyond the last field
 * are dropped. Fields before `index` keep their digits.
 */
export function spreadDigits(
  values: readonly string[],
  index: number,
  digits: string,
  selection: { readonly start: number; readonly end: number } = {
    start: values[index]?.length ?? 0,
    end: values[index]?.length ?? 0,
  },
): Spread {
  const next = values.map((value) => digitsOnly(value));
  const current = next[index] ?? "";
  const inserted = digitsOnly(digits);
  const capacity = (next.length - index) * FRIEND_CODE_BLOCK_LENGTH;
  const stream = (
    current.slice(0, selection.start) +
    inserted +
    current.slice(selection.end) +
    next.slice(index + 1).join("")
  ).slice(0, capacity);
  for (let field = index; field < next.length; field += 1) {
    const offset = (field - index) * FRIEND_CODE_BLOCK_LENGTH;
    next[field] = stream.slice(offset, offset + FRIEND_CODE_BLOCK_LENGTH);
  }
  // The caret stays behind the last inserted digit; at a field's end it stays in that field.
  const position = Math.min(selection.start + inserted.length, stream.length);
  const full = position > 0 && position % FRIEND_CODE_BLOCK_LENGTH === 0;
  const field = Math.min(index + Math.floor(position / FRIEND_CODE_BLOCK_LENGTH) - (full ? 1 : 0), next.length - 1);
  const caret = full ? FRIEND_CODE_BLOCK_LENGTH : position % FRIEND_CODE_BLOCK_LENGTH;
  return { values: next, field, caret };
}

export interface FriendCodeInputOptions {
  /** After every change of a value. */
  readonly onChange: () => void;
  /** A paste or drop was refused because of characters other than digits. */
  readonly onRejected: (message: string) => void;
}

/** Binds the behaviour to the three fields of one code. */
export function bindFriendCodeInput(fields: readonly HTMLInputElement[], options: FriendCodeInputOptions): void {
  const values = (): string[] => fields.map((field) => field.value);
  const apply = (spread: Spread): void => {
    spread.values.forEach((value, index) => {
      const field = fields[index];
      if (field && field.value !== value) field.value = value;
    });
    const target = fields[spread.field];
    if (target) {
      target.focus();
      target.setSelectionRange(spread.caret, spread.caret);
    }
    options.onChange();
  };
  const insertText = (index: number, text: string): void => {
    const digits = pastedFriendCodeDigits(text);
    if (digits === null || digits.length > FRIEND_CODE_BLOCK_LENGTH * fields.length) {
      options.onRejected(PASTE_REJECTED);
      return;
    }
    const field = fields[index];
    // A whole code always fills all three fields, wherever it is pasted.
    if (digits.length === FRIEND_CODE_BLOCK_LENGTH * fields.length) {
      apply(spreadDigits(["", "", ""], 0, digits, { start: 0, end: 0 }));
      return;
    }
    const start = field?.selectionStart ?? field?.value.length ?? 0;
    const end = field?.selectionEnd ?? start;
    apply(spreadDigits(values(), index, digits, { start, end }));
  };

  fields.forEach((field, index) => {
    field.addEventListener("beforeinput", (event) => {
      // Pastes and drops are handled below; typed characters other than digits never arrive.
      if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") return;
      if (event.inputType.startsWith("insert") && event.data !== null && /\D/.test(event.data)) event.preventDefault();
    });
    field.addEventListener("input", (event) => {
      if (event.isComposing) return;
      const clean = digitsOnly(field.value);
      if (clean.length > FRIEND_CODE_BLOCK_LENGTH) {
        // Autofill or a keyboard that ignores maxlength: the rest continues in the next fields.
        apply(
          spreadDigits(
            values().map((value, at) => (at === index ? "" : value)),
            index,
            clean,
            { start: 0, end: 0 },
          ),
        );
        return;
      }
      if (clean !== field.value) {
        const caret = Math.max(0, (field.selectionStart ?? clean.length) - (field.value.length - clean.length));
        field.value = clean;
        field.setSelectionRange(caret, caret);
      }
      const typed = event.inputType.startsWith("insert");
      const next = fields[index + 1];
      if (typed && clean.length === FRIEND_CODE_BLOCK_LENGTH && field.selectionStart === clean.length && next) {
        next.focus();
        next.select();
      }
      options.onChange();
    });
    field.addEventListener("compositionend", () => {
      const clean = digitsOnly(field.value);
      if (clean !== field.value) field.value = clean.slice(0, FRIEND_CODE_BLOCK_LENGTH);
      options.onChange();
    });
    field.addEventListener("paste", (event) => {
      event.preventDefault();
      insertText(index, event.clipboardData?.getData("text") ?? "");
    });
    field.addEventListener("drop", (event) => {
      event.preventDefault();
      insertText(index, event.dataTransfer?.getData("text") ?? "");
    });
    field.addEventListener("keydown", (event) => {
      const atStart = field.selectionStart === 0 && field.selectionEnd === 0;
      const atEnd = field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
      const previous = fields[index - 1];
      const next = fields[index + 1];
      if (event.key === "Backspace" && field.value === "" && previous) {
        event.preventDefault();
        previous.focus();
        previous.setSelectionRange(previous.value.length, previous.value.length);
      } else if (event.key === "ArrowLeft" && atStart && previous) {
        event.preventDefault();
        previous.focus();
        previous.setSelectionRange(previous.value.length, previous.value.length);
      } else if (event.key === "ArrowRight" && atEnd && next) {
        event.preventDefault();
        next.focus();
        next.setSelectionRange(0, 0);
      }
    });
  });
}
