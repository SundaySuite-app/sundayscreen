// The group panel's size formula, in numbers.
//
// The stylesheet owns the SIZE: `.group > *` in groups.module.css computes
// `--name-size` from the panel's own container-query units and three inputs
// this module hands it (`--lines`, `--chip-cols`, `--name-em`). What the
// stylesheet cannot do is CHOOSE — one column or two is a comparison of two
// results, and CSS has no way to branch on which of two calc()s is larger.
// So the formula lives twice: in cq units over there, in pixels here, and
// `sizeFor` is the pixel twin the choice is made with. The e2e tier pins
// that the two agree on a rendered panel (readability.spec) — the constants
// below are the seam, and a retune that touches one language and not the
// other turns that pin red.
//
// Names are MEASURED, not counted (R7-funn S2-1). «Andreas» is 4,06 em in
// Inter 600 and «Kristin» 3,14, at the same seven characters; a per-character
// budget wide enough for the first turns the second into a poster, and one
// narrow enough for the second wraps the first — and a wrapped name is a
// line the height term never budgeted, which is how the last pupil in the
// panel ended up under the clipping edge. `measure` is injected: canvas in
// the widget, a per-character estimate where nothing can measure.

export interface Box {
  w: number;
  h: number;
}

/** The three inputs the stylesheet's formula runs on. `lines` is per COLUMN
 *  — the stylesheet never sees the group size, only what one column has to
 *  hold. */
export interface FitInputs {
  lines: number;
  cols: 1 | 2;
  /** The widest name on the board, in em of the name size (its width at
   *  `font-size: 1em`). */
  nameEm: number;
}

/** A name's width at font-size 1em. */
export type Measure = (name: string) => number;

/* ── The constants shared with the stylesheet ─────────────────────────────
 * Every one of these is a number in `groups.module.css`'s `--name-size`
 * rule, spelled there as a literal because a custom property cannot be read
 * from a module. Change them TOGETHER. */

/** One line of names in units of the name size: the `.chip` line-height
 *  (1.25) plus the `.chips` row gap (0.14) — a hair over, since `.group`
 *  clips and a cut-off pupil is worse than a small one. */
export const LINE_UNITS = 1.42;
/** «GRUPPE 1» and its margin, in the same units. */
export const HEADING_UNITS = 1.1;
/** `.chips { column-gap: 1em }` — one name size between two columns, which
 *  is why the width term can carry it as a plain `(cols − 1)`. */
export const COLUMN_GAP_UNITS = 1;
/** Headroom over the measured width: hinting and sub-pixel placement can add
 *  a fraction of a pixel to what `measureText` promised, and the price of
 *  running out is an ellipsis on a name that was supposed to fit. */
export const FIT_MARGIN = 1.04;

/* ── Names ──────────────────────────────────────────────────────────────── */

/** Em per character when nothing can measure — on the wide side of Inter 600
 *  (its letters run 0,40–0,67), so the estimate errs towards small type
 *  rather than towards an ellipsis. */
export const NAME_EM_FALLBACK = 0.6;
/** The floor keeps a class of «Bo» and «Li» from turning two names into a
 *  poster (about six characters). */
export const NAME_EM_MIN = 3.5;
/** The ceiling keeps one outlier from shrinking the whole board; the name
 *  beyond it loses its tail to `text-overflow: ellipsis`, never its
 *  neighbours. Set above the longest name a real class list carries —
 *  «Mohammed Abdullahi Hassan» measures 14,4 em — so «…» is for the
 *  exception, not the long surname. */
export const NAME_EM_MAX = 15;

export function estimateEm(name: string): number {
  return name.length * NAME_EM_FALLBACK;
}

/** The widest name on the board, clamped to the floor and ceiling above. An
 *  empty board measures as the floor — the formula divides by it. */
export function longestNameEm(groups: string[][], measure: Measure): number {
  const widest = groups.reduce(
    (max, g) => g.reduce((m, n) => Math.max(m, measure(n)), max),
    0,
  );
  return Math.min(Math.max(widest, NAME_EM_MIN), NAME_EM_MAX);
}

export function longestGroup(groups: string[][]): number {
  return groups.reduce((max, g) => Math.max(max, g.length), 0);
}

/* ── The formula ────────────────────────────────────────────────────────── */

/**
 * The name size, in px, that `lines` names per column of `cols` columns fit
 * into a panel with the content box `box`. The stylesheet's rule, in pixels:
 *
 *   height — `100cqh / (lines × 1.42 + 1.1)`
 *   width  — `100cqw / (cols × nameEm × 1.04 + (cols − 1))`
 *
 * The width term folds the column gap into the divisor rather than
 * subtracting it: the gap is `1em` of the NAME size, so in name-size units
 * a two-column row is `2 × nameEm × margin + 1` wide. (Subtracting `1em`
 * inside the stylesheet's `calc()` would resolve against the wrong font —
 * `em` in a `font-size` declaration is the PARENT's size.)
 *
 * `min()` of the two, so whichever runs out first decides.
 */
export function sizeFor(box: Box, { lines, cols, nameEm }: FitInputs): number {
  const byHeight = box.h / (lines * LINE_UNITS + HEADING_UNITS);
  const byWidth =
    box.w / (cols * nameEm * FIT_MARGIN + (cols - 1) * COLUMN_GAP_UNITS);
  return Math.min(byHeight, byWidth);
}

/** Two columns only when they are worth more than a rounding error — a
 *  choice that flips on the third decimal would flip on every frame of a
 *  resize. */
const SPLIT_GAIN = 1.01;

/**
 * One column or two, by RESULT: the size each layout would give, and the
 * larger wins. Splitting halves the lines a column holds and (a little more
 * than) halves the width a name gets, so it pays exactly when the height
 * term is the one that binds — ten first names in a 189×171 panel are 20 px
 * split and 11 px in one column; thirteen full names are 8,7 px in one
 * column and 7,7 px split. The old rule («eight names and a wide enough
 * panel») guessed at that from the counts and was wrong for every list of
 * long names (R7-funn S2-2).
 *
 * `box` is `null` until the panel has been measured: one column then, and
 * the ResizeObserver's first report re-decides before the class sees it.
 */
export function chooseLayout(
  box: Box | null,
  groupSize: number,
  nameEm: number,
): FitInputs {
  const one: FitInputs = { lines: groupSize, cols: 1, nameEm };
  if (!box || groupSize < 2) return one;
  const two: FitInputs = { lines: Math.ceil(groupSize / 2), cols: 2, nameEm };
  return sizeFor(box, two) > sizeFor(box, one) * SPLIT_GAIN ? two : one;
}

/* ── The grid ───────────────────────────────────────────────────────────── */

/**
 * Column count from HOW MANY groups there are — flex-wrap gave 3-per-row
 * always, so four groups broke into 3 + 1 and the last one was clipped.
 * Near-square reads best on a board: 2→2, 3→3, 4→2×2, 5–6→3, 7–9→3,
 * more→4.
 */
export function gridShape(count: number): { cols: number; rows: number } {
  const cols = count <= 3 ? count : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  return { cols, rows: Math.ceil(count / cols) };
}

/**
 * The inline style on `.result`: the grid, and the three custom properties
 * that are the INPUTS to the size formula. Nothing here is a font size —
 * what a name measures is decided in the stylesheet, against the panel it
 * stands in.
 *
 * Rows are spelled out as `1fr` for the same reason the panels are size
 * containers (see groups.module.css): a panel with `contain: size` no longer
 * grows to its names, so the row heights have to be the grid's decision, and
 * equal rows are what makes one shared name size honest.
 */
export function gridStyle(count: number, fit: FitInputs): string {
  if (count === 0) return "";
  const { cols, rows } = gridShape(count);
  return [
    `grid-template-columns: repeat(${cols}, minmax(0, 1fr))`,
    `grid-template-rows: repeat(${rows}, minmax(0, 1fr))`,
    `--lines: ${fit.lines}`,
    `--chip-cols: ${fit.cols}`,
    // Three decimals: the value is a divisor in the stylesheet, and a long
    // float in an inline style is noise in every DOM snapshot.
    `--name-em: ${fit.nameEm.toFixed(3)}`,
  ].join("; ");
}
