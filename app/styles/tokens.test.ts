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
