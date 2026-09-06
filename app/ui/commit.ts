// The edit-in-place commit contract — the ONE copy.
//
// Five widgets carried it by hand, with comments that cross-referenced each
// other («the deadline's contract», «the text-widget contract») rather than a
// shared thing to point at. The contract has two halves and BOTH have to hold
// or a teacher loses her last keystroke:
//
//   1. streaming — every keystroke writes, DEBOUNCED, so a burst of typing
//      collapses into one `layout_save` instead of one per character;
//   2. landing — leaving the field (Enter, Escape, blur) writes AT ONCE.
//      The debounce is a 500 ms window in which nothing has been persisted,
//      and a quit inside that window takes the edit with it. `saveNow`
//      cancels the pending timer and flushes, so «leave the field» and «it is
//      on disk» are the same event.
//
// Copy number six is the one that forgets half 2, and nothing in the gates
// can see it: the config is right in memory, the tests pass, and only the
// restart is wrong. So there is no copy number six.

import { saveNow } from "../state/layout";

/** The props to spread onto an edit-in-place field. */
export interface CommitFieldProps {
  onInput: (e: Event) => void;
  onBlur: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

export interface CommitFieldOptions {
  /** Write this value into the widget's config. `debounce` is the streaming
   *  half — the caller owns the config shape, this owns the timing. */
  write: (value: string, opts: { debounce: boolean }) => void;
  /** Leave edit mode, if the widget has one. */
  close?: () => void;
  /**
   * Does Enter finish the edit?
   *
   * `false` for a multi-line field — the text widget's message is a textarea
   * and Enter is a line break there, so its only landings are blur and the
   * global Escape (which blurs, see `app/screen/keyboard.ts`). Omitted means
   * `true`: a single-line field commits on Enter.
   */
  enterCommits?: boolean;
}

export function commitField(opts: CommitFieldOptions): CommitFieldProps {
  const land = () => {
    opts.close?.();
    saveNow();
  };
  const props: CommitFieldProps = {
    onInput: (e) =>
      opts.write(
        (e.target as HTMLInputElement | HTMLTextAreaElement).value,
        // The streaming write. Never the landing one — a keystroke is not a
        // decision to stop.
        { debounce: true },
      ),
    onBlur: land,
  };
  if (opts.enterCommits !== false) {
    props.onKeyDown = (e) => {
      // Escape is handled here AND by the global chain, which blurs the field
      // — so the edit lands either way, and landing twice writes the same
      // config twice, which is what replace-all is for.
      if (e.key === "Enter" || e.key === "Escape") land();
    };
  }
  return props;
}
