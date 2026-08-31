// WHAT THE RENDERER SAYS ABOUT ITSELF, on the die's own root.
//
// `paintDie` writes two attributes that nothing else in the widget writes and
// that two different readers depend on:
//
//   - `data-back-faces` — the stylesheet's switch for drawing the far side.
//   - `data-face-up`    — the die's own word for what is turned at the room,
//                         which `e2e/dice.spec.ts` reads as protocol.
//
// Both were found lying in R5 (funn M2 and L2), and both are DOM writes, so
// neither can be reduced to a `*-core.ts` the way the house style asks. The
// stand-in below is four methods wide and is not a DOM: it is the smallest
// object `paintDie` can be handed, which is the only reason this file is not
// jsdom. Everything geometric is tested against the real cores next door.

import { describe, expect, it } from "vitest";

import { paintDie } from "./DiceWidget";
import { PIP_FACES } from "./dice-core";
import { DIE_MATERIALS, MATERIAL_TRAITS } from "./die-materials-core";
import { QUAT_IDENTITY } from "./die-orient-core";
import { solidFor } from "./die-solids-core";
import { idleOrientationFor, restOrientationForValue } from "./die-spin-core";

const cube = solidFor(PIP_FACES);

interface Stub {
  dataset: Record<string, string>;
  plate: { style: { display: string }; attrs: Record<string, string> };
  el: SVGSVGElement;
}

/** The narrowest thing `paintDie` will accept: an empty face pool, one plate
 *  node, a dataset and one attribute lookup. The empty FACE pool is
 *  deliberate — every geometric write lands on a node that is not there,
 *  which leaves exactly the writes this file is about. */
function stubSvg(ariaHidden = false): Stub {
  const dataset: Record<string, string> = {};
  const plate = {
    style: { display: "" },
    attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    },
  };
  const el = {
    dataset,
    querySelectorAll: () => [],
    querySelector: (sel: string) => (sel === "[data-plate]" ? plate : null),
    getAttribute: (name: string) =>
      name === "aria-hidden" && ariaHidden ? "true" : null,
  } as unknown as SVGSVGElement;
  return { dataset, plate, el };
}

function paint(
  stub: Stub,
  material: (typeof DIE_MATERIALS)[number],
  solid = cube,
  q = QUAT_IDENTITY,
): void {
  paintDie(stub.el, solid, q, {
    traits: MATERIAL_TRAITS[material],
    poolKey: `${solid.sides}:${material}`,
  });
}

describe("data-back-faces follows the traits table", () => {
  it("is present for exactly the finishes that ask for back faces", () => {
    // The behaviour used to live in a `[data-material="glass"]` selector and
    // `MaterialTraits.backFaces` was read by nobody — so a sixth finish with
    // `backFaces: true` would have passed every test in
    // `die-materials-core.test.ts` and drawn no far edges at all. This is the
    // wire that makes that table load-bearing.
    for (const material of DIE_MATERIALS) {
      const stub = stubSvg();
      paint(stub, material);
      expect("backFaces" in stub.dataset, material).toBe(
        MATERIAL_TRAITS[material].backFaces,
      );
    }
  });

  it("is REMOVED when the same die changes finish", () => {
    // Preact reuses these elements when only the material changes (the same
    // reason `paintDie` clears the inline grain fill explicitly), so a
    // present/absent attribute has to be actively taken away — an ivory die
    // wearing glass's far edges is the same class of bug as a metal die
    // wearing wood's pattern.
    const stub = stubSvg();
    paint(stub, "glass");
    expect("backFaces" in stub.dataset).toBe(true);
    paint(stub, "ivory");
    expect("backFaces" in stub.dataset).toBe(false);
  });

  it("is written for a swatch too", () => {
    // The appearance panel's glass swatch is the one place a teacher sees the
    // finishes side by side; a swatch without its far edges would be showing
    // her a die she is not going to get.
    const stub = stubSvg(true);
    paint(stub, "glass");
    expect("backFaces" in stub.dataset).toBe(true);
  });
});

describe("the glass plate marks an ANSWER, never a tie", () => {
  const d20 = solidFor(20);

  it("is drawn under the numeral of a die that has landed", () => {
    const stub = stubSvg();
    paint(stub, "glass", d20, restOrientationForValue(d20, 17));
    expect(stub.plate.style.display).toBe("");
    expect(Number(stub.plate.attrs.r)).toBeGreaterThan(0);
  });

  it("is NOT drawn on a die standing on its corner", () => {
    // The plate is a white disc behind ONE numeral. On the idle pose three to
    // five faces are turned at the class by exactly the same amount, so
    // singling one of them out is the die pointing at an answer it has not
    // been asked for — the same defect `idleOrientationFor` was written to
    // remove (R5-funn H1). Seen on a glass d20 in «Vis stort».
    const stub = stubSvg();
    paint(stub, "glass", d20, idleOrientationFor(d20));
    expect(stub.plate.style.display).toBe("none");
  });

  it("is never drawn on a pip face, landed or not", () => {
    const stub = stubSvg();
    paint(stub, "glass", cube, restOrientationForValue(cube, 4));
    expect(stub.plate.style.display).toBe("none");
  });
});

describe("data-face-up is only claimed by a die the class is reading", () => {
  it("a die on the card publishes what is turned at the room", () => {
    const stub = stubSvg();
    paint(stub, "ivory");
    expect(stub.dataset.faceUp).toMatch(/^[1-6]$/);
  });

  it("an aria-hidden swatch publishes nothing", () => {
    // Five 40 px decorations in a material picker used to assert the
    // attribute that is documented as «what the class is reading NOW»
    // (R5-funn L2). They are `aria-hidden` for the same reason they should be
    // silent here: nobody is meant to read an answer off them.
    const stub = stubSvg(true);
    paint(stub, "ivory");
    expect("faceUp" in stub.dataset).toBe(false);
  });
});
