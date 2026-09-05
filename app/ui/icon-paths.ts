// The icon vocabulary — pure path data, no JSX, so node tests can import it.
//
// Every icon is drawn on a 24×24 grid for a thin, calm line style: stroke
// 1.75, round caps/joins, no fills (dots are zero-ish-length strokes whose
// round caps render as filled points). Colour is always `currentColor` — the
// surrounding button's CSS class decides. Render only at the token sizes
// (--icon-sm/md/lg = 16/20/24) so strokes land on consistent half-pixel
// boundaries.

export const ICON_STROKE_WIDTH = 1.75;

/** A dot: a 0.02-long stroke whose round cap paints a point. */
const dot = (x: number, y: number) => `M${x} ${y - 0.01}v.02`;

export const ICON_PATHS = {
  // ---------------------------------------------------------- widget kinds
  text: ["M4 6h16", "M4 11.5h11", "M4 17h7.5"],
  clock: [
    "M12 20.5a8.5 8.5 0 1 1 0-17 8.5 8.5 0 0 1 0 17z",
    "M12 7.5V12l3.2 1.9",
  ],
  timer: [
    "M12 20.5a7.25 7.25 0 1 1 0-14.5 7.25 7.25 0 0 1 0 14.5z",
    "M12 9.75v3.5l2.4 1.4",
    "M9.75 3h4.5",
    "M12 3v3",
  ],
  namepicker: [
    "M4 7h16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 20 17H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 7z",
    "M15.5 8.75v1.5",
    "M15.5 11.25v1.5",
    "M15.5 13.75v1.5",
    "M6.5 10h5",
    "M6.5 13.5h3.5",
  ],
  groups: [
    "M7 9.4a2.15 2.15 0 1 1 0-4.3 2.15 2.15 0 0 1 0 4.3z",
    "M17 9.4a2.15 2.15 0 1 1 0-4.3 2.15 2.15 0 0 1 0 4.3z",
    "M12 17.4a2.15 2.15 0 1 1 0-4.3 2.15 2.15 0 0 1 0 4.3z",
    "M3.5 13.4c.5-1.5 1.9-2.4 3.5-2.4s3 .9 3.5 2.4",
    "M13.5 13.4c.5-1.5 1.9-2.4 3.5-2.4s3 .9 3.5 2.4",
    "M8.5 21.4c.5-1.5 1.9-2.4 3.5-2.4s3 .9 3.5 2.4",
  ],
  dice: [
    "M6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4z",
    dot(8.75, 8.75),
    dot(15.25, 8.75),
    dot(8.75, 15.25),
    dot(15.25, 15.25),
  ],
  trafficlight: [
    "M10.5 3h3A2.5 2.5 0 0 1 16 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-3A2.5 2.5 0 0 1 8 18.5v-13A2.5 2.5 0 0 1 10.5 3z",
    dot(12, 7.25),
    dot(12, 12),
    dot(12, 16.75),
  ],
  worksymbol: [
    "M9 12V4.9a1.4 1.4 0 0 1 2.8 0V11",
    "M11.8 11V3.9a1.4 1.4 0 0 1 2.8 0V11",
    "M14.6 11V5.4a1.4 1.4 0 0 1 2.8 0v7.8a7 7 0 0 1-7 7.3c-2.7 0-4.3-1-5.8-3.2l-2.2-3.5a1.35 1.35 0 0 1 2.2-1.55L6.2 15",
    "M9 12.3V6.4a1.4 1.4 0 0 0-2.8 0V13",
  ],
  deadline: [
    "M5 5.5h14A1.5 1.5 0 0 1 20.5 7v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5z",
    "M3.5 10h17",
    "M8 3v4",
    "M16 3v4",
    "M12 12.75v3",
    dot(12, 18.25),
  ],
  checklist: [
    "M4 6.75l1.6 1.6 3-3.1",
    "M12.5 7h8",
    "M4 13.75l1.6 1.6 3-3.1",
    "M12.5 14h8",
    "M12.5 21h5.5",
    "M4 20.75l1.6 1.6 3-3.1",
  ],
  agenda: [
    "M6 3.5h12A1.5 1.5 0 0 1 19.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z",
    "M8 8h8",
    "M8 11.75h4",
    "M14.75 15.5a3 3 0 1 0 6 0 3 3 0 0 0-6 0z",
    "M17.75 14.2v1.3l1 0.65",
  ],
  today: [
    "M5 5.5h14A1.5 1.5 0 0 1 20.5 7v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5z",
    "M3.5 10h17",
    "M8 3v4",
    "M16 3v4",
    "M10.6 13.25h2.8v2.8h-2.8z",
  ],
  // Two chain links on the 45° diagonal. Each is an open "U": two parallel
  // sides closed by an exact semicircle (r = 3.6, so the chord is 7.2 and
  // the arc meets the straight sides tangentially — no kink at the joint).
  //
  // The sides are DELIBERATELY unequal, and that asymmetry is the whole
  // icon. Every side lies on one of the two lines 3.6 either side of the
  // diagonal, so a symmetric pair of U's puts both links' sides on top of
  // each other and the thing renders as one plain capsule — measured, not
  // guessed: the first draft did exactly that. Giving each link one long
  // side (which crosses the middle) and one short one staggers the two
  // gaps, and the eye reads two links passing through one another.
  link: [
    "M12.42 6.48L13.41 5.49a3.6 3.6 0 0 1 5.1 5.1L12.99 16.1",
    "M11.58 17.52L10.59 18.51a3.6 3.6 0 0 1-5.1-5.1L11.01 7.9",
  ],
  // A framed photograph: the frame, a sun high on the left, and two ridges
  // running INTO the bottom-right corner. The ridges deliberately stop at the
  // frame's inner edge rather than at its stroke — at 16 px the two lines
  // would otherwise merge into one thick corner.
  image: [
    "M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5z",
    "M8.75 10.4a1.65 1.65 0 1 1 0-3.3 1.65 1.65 0 0 1 0 3.3z",
    "M3.6 16.4l4.15-4.15 5.25 5.25",
    "M11.5 15.75l3-3 5.4 5.4",
  ],
  // ------------------------------------------------ sibling-track surfaces
  scene: [
    "M8.5 3.75H19A1.25 1.25 0 0 1 20.25 5v10.5",
    "M5 7.5h10.5A1.5 1.5 0 0 1 17 9v9.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V9A1.5 1.5 0 0 1 5 7.5z",
  ],
  planner: [
    "M5 5.5h14A1.5 1.5 0 0 1 20.5 7v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5z",
    "M3.5 10h17",
    "M8 3v4",
    "M16 3v4",
    dot(8, 13.5),
    dot(12, 13.5),
    dot(16, 13.5),
    dot(8, 17),
    dot(12, 17),
  ],
  hourglass: [
    "M7 3.5h10",
    "M7 20.5h10",
    "M8 3.5v3.2c0 2.6 4 3.7 4 5.3s-4 2.7-4 5.3v3.2",
    "M16 3.5v3.2c0 2.6-4 3.7-4 5.3s4 2.7 4 5.3v3.2",
  ],
  "clock-digital": [
    "M4.5 7h15A1.5 1.5 0 0 1 21 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7z",
    "M8.25 10.25v3.5",
    "M11.25 10.25v3.5",
    "M13.75 11v0.02",
    "M13.75 13v0.02",
    "M16.25 10.25v3.5",
  ],
  // ------------------------------------------------------------------ chrome
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  check: ["M4.5 12.5l4.7 4.7L19.5 6.8"],
  "chevron-down": ["M6 9.5l6 6 6-6"],
  "chevron-up": ["M6 14.5l6-6 6 6"],
  fullscreen: [
    "M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9",
    "M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9",
    "M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15",
    "M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15",
  ],
  "fullscreen-exit": [
    "M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4",
    "M15 4v3.5A1.5 1.5 0 0 0 16.5 9H20",
    "M20 15h-3.5A1.5 1.5 0 0 0 15 16.5V20",
    "M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20",
  ],
  class: [
    "M12 4L2.5 8.75 12 13.5l9.5-4.75L12 4z",
    "M6.25 11v4.1c0 1.35 2.55 2.65 5.75 2.65s5.75-1.3 5.75-2.65V11",
    "M21.5 8.75v4.75",
  ],
  // ----------------------------------------------------------------- actions
  pencil: [
    "M15.9 4.6a2.05 2.05 0 0 1 2.9 0l.6.6a2.05 2.05 0 0 1 0 2.9L8.9 18.6l-4.4 1 1-4.4L15.9 4.6z",
    "M14.25 6.25l3.5 3.5",
  ],
  trash: [
    "M4.5 6.5h15",
    "M9.5 6.5V5.25A1.75 1.75 0 0 1 11.25 3.5h1.5a1.75 1.75 0 0 1 1.75 1.75V6.5",
    "M6.25 6.5l.8 12.1a1.9 1.9 0 0 0 1.9 1.9h6.1a1.9 1.9 0 0 0 1.9-1.9l.8-12.1",
    "M10 10.5v6",
    "M14 10.5v6",
  ],
  bell: [
    "M6.75 9.75a5.25 5.25 0 0 1 10.5 0c0 4.6 1.9 5.6 1.9 7H4.85c0-1.4 1.9-2.4 1.9-7z",
    "M10.4 19.75a1.8 1.8 0 0 0 3.2 0",
  ],
  "bell-off": [
    "M8.4 5A5.25 5.25 0 0 1 17.25 9.75c0 3 .8 4.5 1.4 5.55",
    "M6.9 8.5c-.1.4-.15.8-.15 1.25 0 4.6-1.9 5.6-1.9 7h10.9",
    "M10.4 19.75a1.8 1.8 0 0 0 3.2 0",
    "M4.5 4l15 15",
  ],
  rotate: ["M19.5 12a7.5 7.5 0 1 1-2.2-5.3", "M19.5 4.75V9.5H14.75"],
  refresh: [
    "M4.5 12a7.5 7.5 0 0 1 12.8-5.3l2.2 2.05",
    "M19.5 4.5v4.25h-4.25",
    "M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15.25",
    "M4.5 19.5v-4.25h4.25",
  ],
  download: ["M12 4v10.5", "M7.5 10.5l4.5 4.5 4.5-4.5", "M4.5 19.5h15"],
  save: [
    "M6 4.5h9.75L19.5 8.25V18A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5z",
    "M8 4.5V9h7V4.5",
    "M7.5 19.5v-5.75h9v5.75",
  ],
  // Two DIAGONAL arrows, deliberately not the four corner brackets above:
  // `fullscreen`/`fullscreen-exit` mean the WINDOW, and «Vis stort» is one
  // card growing inside a board that is already fullscreen. Two controls that
  // do different things must not wear the same glyph on the same screen.
  expand: ["M14.5 9.5L20 4", "M15 4h5v5", "M9.5 14.5L4 20", "M9 20H4v-5"],
  collapse: ["M14 10L20 4", "M20 10h-6V4", "M10 14L4 20", "M4 14h6v6"],
  copy: [
    "M6 8h8a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 14 20.5H6A1.5 1.5 0 0 1 4.5 19V9.5A1.5 1.5 0 0 1 6 8z",
    "M8.5 8V5.5A1.5 1.5 0 0 1 10 4h8a1.5 1.5 0 0 1 1.5 1.5V14a1.5 1.5 0 0 1-1.5 1.5h-2.5",
  ],
} as const;

export type IconName = keyof typeof ICON_PATHS;

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];
