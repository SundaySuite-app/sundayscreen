// THE MATERIAL RAMPS, AS ARITHMETIC.
//
// Thirty dice exist — six colour families × five finishes — and every one of
// them prints numerals a pupil reads from the back of a lit classroom. The
// families themselves are proved in `app/styles/tokens.css` (see the
// `terningfamiliene` block in tokens.test.ts): body, ink, 4.5:1. What that
// proof does NOT cover is what happens once a material MIXES the body into
// five shaded steps — which is what the die actually draws.
//
// This file closes that gap by reading `dice.module.css` as TEXT. Vitest is
// node-env here (house rule: never jsdom), so there is no cascade to query —
// but there is nothing to query anyway: `color-mix(in srgb, …)` is a pure
// function of two colours and a percentage, and sRGB mixing is exactly the
// per-channel blend `tokens.test.ts`'s `over()` already computes. Same
// arithmetic, same floor, one file over.
//
// ## Why `in srgb` is a rule and not a preference
//
// The gate in `scripts/check-app-css-tokens.mjs` bans colour LITERALS outside
// the dictionary; it has no opinion about interpolation spaces. So an `oklch`
// ramp would pass every gate in the repo and be unverifiable here — the
// numbers below could not be computed without shipping a colour-space
// conversion into a test. The ban lives here, next to the arithmetic that
// depends on it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TONES } from "./die-project-core";
import { DIE_COLORS, DIE_MATERIALS } from "./die-materials-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const rampCss = readFileSync(join(here, "dice.module.css"), "utf8");
const tokenCss = readFileSync(
  join(root, "app", "styles", "tokens.css"),
  "utf8",
);

/** WCAG 2.x AA for body text — the floor a numeral on the face the class is
 *  reading has to clear. */
const FLOOR = 4.5;

/**
 * …and the floor for the OTHER four steps.
 *
 * A numeral on a face that is not square to the class is a numeral seen at an
 * angle, sliding off the silhouette — WCAG's own large-text/graphics floor is
 * the honest one for it. It is not a relaxation the ramps were tuned to hide
 * behind: it is reached only by the extremes, and only on the tightest family
 * (red carries near-white ink on a body already at 4.78:1, so it has almost
 * no headroom in either direction — lighten it at all and the ink follows the
 * body up).
 */
const GRAZING_FLOOR = 3;

/** The step a face turned square to the class always lands on. Fixed by the
 *  light, not by taste: `toneFor` in die-project-core resolves a normal of
 *  (0,0,1) under the standing lamp to `round(0.577 × 4)`. */
const FRONT_TONE = 2;

// ── Reading the two stylesheets ────────────────────────────────────────────

type Rgb = [number, number, number];

function declarations(source: string): Map<string, string> {
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  const out = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) out.set(m[1], m[2].trim());
  return out;
}

const TOKENS = declarations(tokenCss);

function hex(name: string): Rgb {
  const raw = TOKENS.get(name);
  if (raw === undefined) throw new Error(`tokens.css has no ${name}`);
  const m = raw.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`${name} is not a six-digit hex: ${raw}`);
  return [
    parseInt(m[1].slice(0, 2), 16),
    parseInt(m[1].slice(2, 4), 16),
    parseInt(m[1].slice(4, 6), 16),
  ];
}

/** The body of one rule, by its selector — comments stripped first so the
 *  prose above each ramp (which quotes selectors) is never read as one. */
function ruleBody(selector: string): string {
  const cleaned = rampCss.replace(/\/\*[\s\S]*?\*\//g, " ");
  const at = cleaned.indexOf(selector);
  if (at < 0) throw new Error(`dice.module.css has no rule «${selector}»`);
  const open = cleaned.indexOf("{", at);
  const close = cleaned.indexOf("}", open);
  if (open < 0 || close < 0) throw new Error(`«${selector}» has no body`);
  return cleaned.slice(open + 1, close);
}

/** The `{ body, ink }` token names one family declares. */
function familyTokens(colour: string): { body: string; ink: string } {
  const body = declarations(ruleBody(`.look[data-color="${colour}"]`));
  const read = (name: string): string => {
    const raw = body.get(name);
    if (raw === undefined) throw new Error(`${colour} declares no ${name}`);
    const m = raw.match(/^var\((--[a-z0-9-]+)\)$/i);
    if (!m) throw new Error(`${colour}'s ${name} is not a plain token: ${raw}`);
    return m[1];
  };
  return { body: read("--die-body"), ink: read("--die-ink") };
}

/** sRGB mixing is the per-channel blend, which is why the ramps are written
 *  `in srgb` — see the file header. */
function mix(a: Rgb, share: number, b: Rgb): Rgb {
  return a.map((c, i) => c * share + b[i] * (1 - share)) as Rgb;
}

/**
 * One material's five steps, resolved against one family.
 *
 * Accepts exactly two spellings and nothing else: `var(--die-body)` (the
 * middle step, which is the family itself) and `color-mix(in srgb,
 * var(--die-body) P%, var(--pole))`. Anything else throws rather than being
 * skipped — a step this parser did not understand must not read as a step
 * that passed.
 */
function ramp(material: string, family: { body: string; ink: string }): Rgb[] {
  const body = declarations(ruleBody(`.look[data-material="${material}"]`));
  const bodyRgb = hex(family.body);
  return Array.from({ length: TONES }, (_, step) => {
    const raw = body.get(`--t${step}`);
    if (raw === undefined) throw new Error(`${material} has no --t${step}`);
    if (raw === "var(--die-body)") return bodyRgb;
    const m = raw.match(
      /^color-mix\(in srgb,\s*var\(--die-body\)\s*([\d.]+)%,\s*var\((--[a-z0-9-]+)\)\)$/i,
    );
    if (!m) throw new Error(`${material} --t${step} is not a srgb mix: ${raw}`);
    return mix(bodyRgb, Number(m[1]) / 100, hex(m[2]));
  });
}

// ── WCAG, the same arithmetic tokens.test.ts uses ──────────────────────────

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

// ── The guard ──────────────────────────────────────────────────────────────

describe("every material declares a whole ramp", () => {
  for (const material of DIE_MATERIALS) {
    it(`${material}: all ${TONES} steps, in srgb`, () => {
      // `ramp()` throws on a missing or unparseable step, so reaching the
      // assertion is most of the test.
      const steps = ramp(material, familyTokens("classic"));
      expect(steps).toHaveLength(TONES);
    });

    it(`${material}: the front step IS the family`, () => {
      // Colour and material are two axes, and this is what keeps them
      // independent: the face the class reads is always the family's own
      // body, so the proven 4.5:1 pair in tokens.css is what a pupil is
      // actually looking at, on all five finishes.
      const raw = declarations(
        ruleBody(`.look[data-material="${material}"]`),
      ).get(`--t${FRONT_TONE}`);
      expect(raw).toBe("var(--die-body)");
    });

    it(`${material}: the ramp goes dark to light, without repeating`, () => {
      // Five steps that are not five distinguishable tones would leave the
      // renderer quantising into a ramp that cannot show the difference.
      const steps = ramp(material, familyTokens("classic")).map(luminance);
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i], `--t${i} is not above --t${i - 1}`).toBeGreaterThan(
          steps[i - 1],
        );
      }
    });
  }
});

describe("thirty dice, and a numeral you can read on every one", () => {
  for (const colour of DIE_COLORS) {
    for (const material of DIE_MATERIALS) {
      it(`${colour} × ${material}`, () => {
        const family = familyTokens(colour);
        const ink = hex(family.ink);
        const steps = ramp(material, family);

        expect(
          contrast(ink, steps[FRONT_TONE]),
          `${colour}/${material}: the face the class reads`,
        ).toBeGreaterThanOrEqual(FLOOR);

        steps.forEach((tone, i) => {
          if (i === FRONT_TONE) return;
          expect(
            contrast(ink, tone),
            `${colour}/${material} --t${i}: a numeral on a grazing face`,
          ).toBeGreaterThanOrEqual(GRAZING_FLOOR);
        });
      });
    }
  }

  it("covers all thirty", () => {
    // A family or a finish quietly dropped from one of the lists would take
    // its six or five guards with it and leave nothing red.
    expect(DIE_COLORS.length * DIE_MATERIALS.length).toBe(30);
  });
});

describe("the stylesheet stays inside what this file can check", () => {
  it("mixes in srgb and nowhere else", () => {
    const cleaned = rampCss.replace(/\/\*[\s\S]*?\*\//g, " ");
    // Not «no oklch anywhere» — the WORD may perfectly well appear in the
    // prose explaining why it is not used. Only the code is scanned.
    expect(cleaned).not.toMatch(/\b(?:oklch|oklab|lch|lab)\s*\(/i);
    for (const m of cleaned.matchAll(/color-mix\(\s*in\s+([a-z-]+)/gi)) {
      expect(m[1], "a ramp mixed outside srgb cannot be checked").toBe("srgb");
    }
  });

  it("mixes toward the house's own poles, never an imported black or white", () => {
    const poles = new Set<string>();
    for (const material of DIE_MATERIALS) {
      const body = declarations(ruleBody(`.look[data-material="${material}"]`));
      for (let step = 0; step < TONES; step++) {
        const raw = body.get(`--t${step}`) ?? "";
        const m = raw.match(/var\((--[a-z0-9-]+)\)\)$/);
        if (m) poles.add(m[1]);
      }
    }
    expect([...poles].sort()).toEqual(["--ink", "--raised"]);
  });

  it("actually parsed something — an empty read must not read green", () => {
    // The whole file is a text parse, and every assertion above is vacuous if
    // the parse came back with nothing. This is the mutation guard: break the
    // reader and this goes red before the floors quietly stop being checked.
    expect(TOKENS.size).toBeGreaterThan(30);
    expect(rampCss.length).toBeGreaterThan(2000);
    expect(ruleBody('.look[data-color="classic"]')).toContain("--die-body");
    expect(() => ruleBody('.look[data-color="chartreuse"]')).toThrow();
    expect(() => ramp("velvet", familyTokens("classic"))).toThrow();
  });
});
