// The four work-mode glyphs — CONTENT, not chrome: they render at 34cqmin on
// the board, so they live on their own 96×96 grid with a bolder stroke (5 ≈
// 1.25 at 24-equivalent) for across-the-room legibility. Stroke width is in
// user units on purpose: it scales WITH the box (vector-effect:
// non-scaling-stroke would render hairlines at board size). The settings-row
// buttons reuse the very same components at icon size, so the picker matches
// the display.

import type { WorkMode } from "../../bindings/WorkMode";

function Glyph(props: { paths: string[]; class?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      stroke-width="5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {props.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Stille: a speech bubble, crossed out. */
const SILENT = [
  "M20 18h56a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8H46L30 76V62H20a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8z",
  "M16 82 80 12",
];

/** Hviskestemme: a small, quiet bubble with three soft dots. */
const WHISPER = [
  "M26 30h44a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7H50L38 72V62H26a7 7 0 0 1-7-7V37a7 7 0 0 1 7-7z",
  "M36 46v0.05",
  "M48 46v0.05",
  "M60 46v0.05",
];

/** Samarbeide: two bubbles in conversation. */
const COLLABORATE = [
  "M16 16h30a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7H34l-9 8v-8h-9a7 7 0 0 1-7-7V23a7 7 0 0 1 7-7z",
  "M50 44h30a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7h-9v8l-9-8H50a7 7 0 0 1-7-7V51a7 7 0 0 1 7-7z",
];

/** Rekk opp hånda: the raised hand (the toolbar icon's big sibling). */
const RAISEHAND = [
  "M36 48V19.6a5.6 5.6 0 0 1 11.2 0V44",
  "M47.2 44V15.6a5.6 5.6 0 0 1 11.2 0V44",
  "M58.4 44V21.6a5.6 5.6 0 0 1 11.2 0v31.2a28 28 0 0 1-28 29.2c-10.8 0-17.2-4-23.2-12.8l-8.8-14a5.4 5.4 0 0 1 8.8-6.2L24.8 60",
  "M36 49.2V25.6a5.6 5.6 0 0 0-11.2 0V52",
];

const GLYPH_PATHS: Record<WorkMode, string[]> = {
  silent: SILENT,
  whisper: WHISPER,
  collaborate: COLLABORATE,
  raisehand: RAISEHAND,
};

export function WorkGlyph(props: { mode: WorkMode; class?: string }) {
  return <Glyph paths={GLYPH_PATHS[props.mode]} class={props.class} />;
}
