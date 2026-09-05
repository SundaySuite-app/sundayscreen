// The CONTRAST FLOOR for every token the app uses as INK.
//
// SundayScreen is read off a projector from the back of a lit classroom, so
// «muted» is a hierarchy and never a licence to disappear. Before this guard
// existed, `--ink-3` sat at 3.21:1 on --surface across ~38 usages — times,
// hints, empty states, all of it pupil-facing — and nothing in `npm run check`
// had an opinion. A palette falls under the floor one considered nudge at a
// time; this file is what makes each nudge answerable.
//
// The gate reads `tokens.css` as TEXT on purpose. Vitest is node-env here (see
// vitest.config.ts — the house rule is no jsdom), so there is no cascade to
// query; a regex over the dictionary is the whole surface, and the dictionary
// is the one file where every colour is required to live.
//
// ## What is NOT expressed here
//
// «--ink-faint is only ever used on icons» and friends are rules about WHERE a
// token is applied. A regex cannot see that, and a guard that pretends to
// check something it cannot see is worse than no guard: it converts a real
// question into a green tick. Scope is the reviewer's job. The floor is this
// file's job.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(root, "app", "styles", "tokens.css"), "utf8");

/** WCAG 2.x AA for body text. */
const FLOOR = 4.5;

type Rgb = [number, number, number];
/** A colour that may be translucent — `a` is 1 for every opaque token. */
interface Paint {
  rgb: Rgb;
  a: number;
}

// ── Parsing ────────────────────────────────────────────────────────────────

/** Custom-property declarations, comments stripped so documentation prose
 *  that happens to quote a hex (this palette explains itself) is never read
 *  as a declaration. */
function declarations(source: string): Map<string, string> {
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  const out = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) out.set(m[1], m[2].trim());
  return out;
}

const TOKENS = declarations(css);

function parsePaint(value: string): Paint | null {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    return {
      rgb: [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ],
      a: 1,
    };
  }
  const rgba = value.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i,
  );
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  return null;
}

function paint(name: string): Paint {
  const raw = TOKENS.get(name);
  if (raw === undefined) throw new Error(`tokens.css has no ${name}`);
  const p = parsePaint(raw);
  if (p === null) throw new Error(`${name} is not a colour literal: ${raw}`);
  return p;
}

// ── WCAG arithmetic ────────────────────────────────────────────────────────

/** sRGB relative luminance (WCAG 2.1 §Relative luminance). */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over: what the eye actually receives when a translucent tint is
 *  painted on a known ground. A soft plate is never its own rgb on screen. */
function over(fg: Paint, ground: Rgb): Rgb {
  return fg.rgb.map((c, i) => c * fg.a + ground[i] * (1 - fg.a)) as Rgb;
}

// ── The grounds every card in this app is actually made of ────────────────

const GROUNDS: { name: string; rgb: Rgb }[] = [
  { name: "--surface", rgb: paint("--surface").rgb },
  { name: "--raised", rgb: paint("--raised").rgb },
];

/** The ink tokens, and the tinted plate each one is allowed to sit on. A
 *  triad's own soft is the only tint it is checked against — that IS the
 *  design rule (one rgb in three strengths), and a red word on a green plate
 *  is a bug no contrast number would have excused anyway. */
const INKS: { name: string; soft: string | null }[] = [
  { name: "--ink", soft: null },
  { name: "--ink-2", soft: null },
  { name: "--ink-3", soft: null },
  { name: "--warn-ink", soft: "--warn-soft" },
  { name: "--good", soft: "--good-soft" },
  { name: "--bad", soft: "--bad-soft" },
];

describe("tokens.css holds every ink above the AA floor", () => {
  for (const { name, soft } of INKS) {
    for (const ground of GROUNDS) {
      it(`${name} on ${ground.name}`, () => {
        const ink = paint(name);
        expect(ink.a, `${name} is ink — it must be opaque`).toBe(1);
        expect(contrast(ink.rgb, ground.rgb)).toBeGreaterThanOrEqual(FLOOR);
      });
    }

    if (soft === null) continue;

    for (const ground of GROUNDS) {
      it(`${name} on ${soft} composited over ${ground.name}`, () => {
        // The tint is translucent, so the plate the ink lands on depends on
        // the card under it — check BOTH cards the app builds out of.
        const plate = over(paint(soft), ground.rgb);
        expect(contrast(paint(name).rgb, plate)).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }
});

describe("a semantic triad is one colour in three strengths", () => {
  for (const base of ["--good", "--bad"]) {
    it(`${base}, ${base}-soft and ${base}-line share one rgb`, () => {
      const ink = paint(base);
      for (const suffix of ["-soft", "-line"]) {
        const tint = paint(base + suffix);
        expect(tint.rgb, `${base}${suffix} drifted from ${base}`).toEqual(
          ink.rgb,
        );
        expect(tint.a, `${base}${suffix} must be a tint`).toBeLessThan(1);
      }
    });
  }
});

describe("gold is a surface, not ink", () => {
  it("--on-gold clears the floor on a --gold fill", () => {
    expect(
      contrast(paint("--on-gold").rgb, paint("--gold").rgb),
    ).toBeGreaterThanOrEqual(FLOOR);
  });

  it("--gold itself does NOT clear it as text — hence the rule", () => {
    // Not a wish: the number is why `color: var(--gold)` is banned outside
    // the two non-text usages. If a future gold ever passes this, delete the
    // rule deliberately rather than discovering it by accident.
    expect(contrast(paint("--gold").rgb, paint("--raised").rgb)).toBeLessThan(
      FLOOR,
    );
  });
});

describe("the traffic light signals with brightness, not just hue", () => {
  // The half-second read from eight metres is «which lamp is BRIGHT», and the
  // squint test only works if the lit lamp wins on luminance. Before this, an
  // unlit lamp out-shone a lit red three to one.
  const housing = paint("--ink").rgb;
  const off = paint("--light-off").rgb;

  it("every lit lamp out-shines the unlit one", () => {
    for (const lamp of ["--light-red", "--light-yellow", "--light-green"]) {
      expect(
        luminance(paint(lamp).rgb),
        `${lamp} must out-shine --light-off`,
      ).toBeGreaterThan(luminance(off));
    }
  });

  it("an unlit lamp sits close to its housing", () => {
    expect(contrast(off, housing)).toBeLessThan(2);
  });

  it("every lit lamp separates from the housing", () => {
    for (const lamp of ["--light-red", "--light-yellow", "--light-green"]) {
      expect(contrast(paint(lamp).rgb, housing), lamp).toBeGreaterThanOrEqual(
        3,
      );
    }
  });
});

/** A die COLOUR FAMILY is a PAIR — the body it is cut from and the one ink
 *  allowed on it — which is why these are declared as pairs and never as a
 *  flat colour list. The material ramps mix out of them, so a floor proved
 *  here is a floor thirty colour × material combinations inherit.
 *
 *  ⚠️ These `-ink` tokens are deliberately NOT in `INKS` above, and the
 *  reason is a number rather than a preference: `--die-slate-ink` is PALE
 *  ink for a near-black die. `INKS` measures every entry against --surface
 *  and --raised, so it would read that one at 1.10:1 and go red —
 *  a false alarm about the most legible pair in the file. Ink is only ever
 *  «readable» against the thing it is printed ON, and for a die that thing
 *  is the die. The pairing below is what encodes that. */
const DIE_FAMILIES = [
  { name: "classic", body: "--die-classic", ink: "--die-classic-ink" },
  { name: "red", body: "--die-red", ink: "--die-red-ink" },
  { name: "blue", body: "--die-blue", ink: "--die-blue-ink" },
  { name: "green", body: "--die-green", ink: "--die-green-ink" },
  { name: "gold", body: "--die-gold", ink: "--die-gold-ink" },
  { name: "slate", body: "--die-slate", ink: "--die-slate-ink" },
];

/** A die is an OBJECT on the card, not a tinted region of it. Below this
 *  ratio against --surface the classic die stops having a visible edge. */
const OBJECT_FLOOR = 1.35;

/** The smallest relative-luminance step between two families. */
const LADDER_STEP = 0.05;

describe("terningfamiliene: a body, and the one ink it carries", () => {
  for (const { name, body, ink } of DIE_FAMILIES) {
    it(`${name}: its numerals clear the AA floor on its own body`, () => {
      const b = paint(body);
      const i = paint(ink);
      expect(b.a, `${body} is a body — it must be opaque`).toBe(1);
      expect(i.a, `${ink} is ink — it must be opaque`).toBe(1);
      expect(contrast(i.rgb, b.rgb)).toBeGreaterThanOrEqual(FLOOR);
    });

    it(`${name}: the body reads as an object on --surface`, () => {
      expect(
        contrast(paint(body).rgb, paint("--surface").rgb),
      ).toBeGreaterThanOrEqual(OBJECT_FLOOR);
    });

    it(`${name}: its ink is checked against the DIE, never the card`, () => {
      // The ⚠️ above, as a guard. Adding a die ink to INKS looks like
      // thoroughness and is the one edit that would make this file lie:
      // three of the six are pale, and the list's floor is measured
      // against --surface.
      expect(INKS.map((entry) => entry.name)).not.toContain(ink);
    });
  }

  it("no two families are the same die to a colour-blind eye", () => {
    // The traffic light's lesson, one widget over. There the failure was a
    // lit lamp dimmer than an unlit one; here it would be six dice a pupil
    // can only tell apart by hue — and «take the green one» is exactly how
    // these get used. So the six are a LADDER first and a palette second.
    for (let i = 0; i < DIE_FAMILIES.length; i++) {
      for (let j = i + 1; j < DIE_FAMILIES.length; j++) {
        const a = DIE_FAMILIES[i];
        const b = DIE_FAMILIES[j];
        const gap = Math.abs(
          luminance(paint(a.body).rgb) - luminance(paint(b.body).rgb),
        );
        expect(
          gap,
          `${a.name} and ${b.name} are one rung`,
        ).toBeGreaterThanOrEqual(LADDER_STEP);
      }
    }
  });

  it("all six families are actually declared", () => {
    // `paint()` throws on a missing token, so every `it` above is real —
    // but a family DELETED from the list above would take its own guard
    // with it and leave nothing red. Six is the enum in layout.rs.
    expect(DIE_FAMILIES).toHaveLength(6);
  });
});

/** A SCENE THEME is a PAIR — the backdrop the board is drawn on and the one
 *  ink allowed directly on it (the empty board's signpost). Declared as pairs
 *  for the same reason the die families are: «readable» is only ever a
 *  statement about the thing the ink is printed ON.
 *
 *  ⚠️ `--scene-tavle-ink` is deliberately NOT in `INKS` above, and the reason
 *  is a number: it is chalk-white ink for a near-black board, so the list's
 *  --surface floor would read it as 1.06:1 and go red about the most legible
 *  pair in the file. Same trap as `--die-slate-ink`. */
const SCENE_THEMES = [
  { name: "standard", bg: "--scene-standard-bg", ink: "--scene-standard-ink" },
  { name: "papir", bg: "--scene-papir-bg", ink: "--scene-papir-ink" },
  { name: "varm", bg: "--scene-varm-bg", ink: "--scene-varm-ink" },
  { name: "kjolig", bg: "--scene-kjolig-bg", ink: "--scene-kjolig-ink" },
  { name: "tavle", bg: "--scene-tavle-bg", ink: "--scene-tavle-ink" },
];

/** The four LIGHT boards, in the order the picker offers them. `tavle` is the
 *  one dark board and is held to its own bound below. */
const LIGHT_THEMES = ["standard", "papir", "varm", "kjolig"];

/** How far apart two light backdrops must be in relative luminance for a
 *  teacher to tell their swatches apart at a glance. */
const SCENE_LADDER_STEP = 0.02;
/** A backdrop brighter than this stops being a tint and becomes glare. */
const SCENE_LIGHT_MAX = 0.95;
/** …and one darker than this stops being a light board at all. */
const SCENE_LIGHT_MIN = 0.6;
/** The dark board's ceiling — it must read as a chalkboard, not as a tint. */
const SCENE_DARK_MAX = 0.06;

/** The alpha `Surface.module.css` puts the empty board's HINT line at on a
 *  themed board, so the title and the hint are two levels there the way they
 *  are on the default board (R6/F9). Read out of the dictionary rather than
 *  restated: two numbers for one dim is the seam bug this house keeps
 *  finding, and the number is what decides whether the hint clears AA. */
const SCENE_HINT_DIM = Number(TOKENS.get("--scene-hint-dim"));

describe("skjermtemaene: a backdrop, and the one ink it carries", () => {
  for (const { name, bg, ink } of SCENE_THEMES) {
    it(`${name}: the empty-board text clears the AA floor on its own backdrop`, () => {
      const b = paint(bg);
      const i = paint(ink);
      expect(b.a, `${bg} is a backdrop — it must be opaque`).toBe(1);
      expect(i.a, `${ink} is ink — it must be opaque`).toBe(1);
      expect(contrast(i.rgb, b.rgb)).toBeGreaterThanOrEqual(FLOOR);
    });

    it(`${name}: its ink is checked against the BOARD, never the card`, () => {
      // The ⚠️ above, as a guard. Adding a scene ink to INKS looks like
      // thoroughness and is the one edit that would make this file lie:
      // `tavle`'s is chalk on a blackboard.
      expect(INKS.map((entry) => entry.name)).not.toContain(ink);
    });

    // `standard` renders --ink-2/--ink-3 and is deliberately not dimmed.
    if (name === "standard") continue;

    it(`${name}: the DIMMED hint line still clears the AA floor`, () => {
      // The guard above proves the INK. It does not prove what RENDERS: on a
      // themed board the empty-state hint is drawn at `--scene-hint-dim` so it
      // reads as a level under the title (R6/F9), and an alpha is a contrast
      // change. `varm` is the tight one — 4.60:1 at 0.9, 4.14:1 at 0.85 — so
      // a considered nudge to either the dim or an ink goes red here first,
      // which is the whole reason the number lives in tokens.css.
      const b = paint(bg);
      const dimmed = over({ rgb: paint(ink).rgb, a: SCENE_HINT_DIM }, b.rgb);
      expect(contrast(dimmed, b.rgb)).toBeGreaterThanOrEqual(FLOOR);
    });
  }

  it("the hint dim is a real alpha, and a DIM", () => {
    // `Number("")` is 0 and `Number(undefined)` is NaN — both would make every
    // assertion above pass or throw for the wrong reason. And a dim of 1 is
    // the collapsed hierarchy the rule exists to undo, silently green.
    expect(Number.isFinite(SCENE_HINT_DIM)).toBe(true);
    expect(SCENE_HINT_DIM).toBeGreaterThan(0);
    expect(SCENE_HINT_DIM).toBeLessThan(1);
  });

  it("the default theme IS today's board, byte for byte", () => {
    // The promise to a teacher who never opens the picker: nothing moved.
    // Compared as declared TEXT, not as parsed rgb — `#f6f3ec` and
    // `rgb(246, 243, 236)` are the same colour and would hide a divergence
    // in how the two are maintained.
    expect(TOKENS.get("--scene-standard-bg")).toBe(TOKENS.get("--bg"));
    expect(TOKENS.get("--scene-standard-ink")).toBe(TOKENS.get("--ink-2"));
  });

  it("the four light boards are a ladder, not four whites", () => {
    // The dice lesson, one layer out: five swatches in a menu are told apart
    // by brightness before hue.
    for (let i = 0; i < LIGHT_THEMES.length; i++) {
      for (let j = i + 1; j < LIGHT_THEMES.length; j++) {
        const a = SCENE_THEMES.find((t) => t.name === LIGHT_THEMES[i])!;
        const b = SCENE_THEMES.find((t) => t.name === LIGHT_THEMES[j])!;
        const gap = Math.abs(
          luminance(paint(a.bg).rgb) - luminance(paint(b.bg).rgb),
        );
        expect(gap, `${a.name} and ${b.name} are one board`).toBeGreaterThan(
          SCENE_LADDER_STEP,
        );
      }
    }
  });

  it("a light board stays light, and never becomes glare", () => {
    for (const name of LIGHT_THEMES) {
      const theme = SCENE_THEMES.find((t) => t.name === name)!;
      const l = luminance(paint(theme.bg).rgb);
      expect(l, `${name} is too dark to be a light board`).toBeGreaterThan(
        SCENE_LIGHT_MIN,
      );
      expect(l, `${name} is glare on a projector`).toBeLessThanOrEqual(
        SCENE_LIGHT_MAX,
      );
    }
  });

  it("tavle is the one dark board, and it is properly dark", () => {
    expect(luminance(paint("--scene-tavle-bg").rgb)).toBeLessThanOrEqual(
      SCENE_DARK_MAX,
    );
  });

  it("all five themes are actually declared", () => {
    // `paint()` throws on a missing token, so every `it` above is real — but
    // a theme DELETED from the list would take its own guard with it and
    // leave nothing red. Five is the enum in `core/src/theme.rs`.
    expect(SCENE_THEMES).toHaveLength(5);
    expect(LIGHT_THEMES).toHaveLength(4);
  });
});

describe("the popover layer sits between the chrome and the modals", () => {
  const layer = (name: string) => {
    const raw = TOKENS.get(name);
    if (raw === undefined) throw new Error(`tokens.css has no ${name}`);
    return Number(raw);
  };

  it("--z-popover clears the toolbar and stays under an overlay", () => {
    // A widget's own panel must not open BEHIND the toolbar the teacher
    // pressed to reach it, and must not float OVER a modal — a modal that
    // something else covers has stopped being modal.
    expect(layer("--z-popover")).toBeGreaterThan(layer("--z-chrome"));
    expect(layer("--z-popover")).toBeLessThan(layer("--z-overlay"));
    // And above the focused widget: a panel opened during «Vis stort» is
    // the reason this token is not simply --z-chrome + 1.
    expect(layer("--z-popover")).toBeGreaterThan(layer("--z-widget-active"));
  });
});

describe("the focus ring is the system's own ink", () => {
  it("--focus is a real colour that clears 3:1 on both cards", () => {
    for (const ground of GROUNDS) {
      expect(
        contrast(paint("--focus").rgb, ground.rgb),
        ground.name,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the guard's own arithmetic", () => {
  // A contrast checker that is silently wrong is the most expensive kind of
  // green tick, so it is pinned to values anyone can look up.
  it("black on white is 21:1 and a colour on itself is 1:1", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([18, 52, 86], [18, 52, 86])).toBeCloseTo(1, 5);
  });

  it("compositing a 50 % black tint on white lands halfway", () => {
    expect(over({ rgb: [0, 0, 0], a: 0.5 }, [255, 255, 255])).toEqual([
      127.5, 127.5, 127.5,
    ]);
  });

  it("reads shorthand hex and both rgba spellings", () => {
    expect(parsePaint("#fff")?.rgb).toEqual([255, 255, 255]);
    expect(parsePaint("rgba(1, 2, 3, 0.4)")).toEqual({
      rgb: [1, 2, 3],
      a: 0.4,
    });
    expect(parsePaint("rgb(1, 2, 3)")?.a).toBe(1);
    expect(parsePaint("var(--ink)")).toBeNull();
  });

  it("ignores hexes that appear only in the file's own prose", () => {
    const parsed = declarations("/* --fake: #abcdef; */\n--real: #123456;");
    expect(parsed.has("--fake")).toBe(false);
    expect(parsed.get("--real")).toBe("#123456");
  });

  it("actually found the dictionary — an empty parse must not read green", () => {
    expect(TOKENS.size).toBeGreaterThan(30);
  });
});
