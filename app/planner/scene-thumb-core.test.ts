import { describe, expect, it } from "vitest";

import {
  thumbSpec,
  THUMB_ICON_MIN_PX,
  type ThumbItem,
} from "./scene-thumb-core";

const SIZE = { w: 112, h: 70 };

const item = (over: Partial<ThumbItem> = {}): ThumbItem => ({
  rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
  kind: "clock",
  z: 0,
  ...over,
});

describe("thumbSpec — geometry", () => {
  it("converts through fromNorm, per axis", () => {
    const [only] = thumbSpec(
      [item({ rect: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 } })],
      SIZE,
    );
    expect(only.box).toEqual({ x: 28, y: 35, w: 56, h: 17.5 });
  });

  it("keeps the kind verbatim, unknown ones included (promise 3)", () => {
    const spec = thumbSpec([item({ kind: "hologram-from-v9" })], SIZE);
    expect(spec).toHaveLength(1);
    expect(spec[0].kind).toBe("hologram-from-v9");
  });

  it("scales with the thumbnail, not with the board", () => {
    const one = item({ rect: { x: 0, y: 0, w: 1, h: 1 } });
    expect(thumbSpec([one], { w: 200, h: 100 })[0].box).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
  });
});

describe("thumbSpec — showIcon", () => {
  // The short side decides, not the area: the 4th row is the wide banner
  // that has plenty of pixels and no room.
  const cases: [string, { w: number; h: number }, boolean][] = [
    ["comfortably above the floor", { w: 0.3, h: 0.3 }, true],
    ["exactly at the floor", { w: 0.5, h: THUMB_ICON_MIN_PX / SIZE.h }, true],
    [
      "one hair below the floor",
      { w: 0.5, h: (THUMB_ICON_MIN_PX - 0.5) / SIZE.h },
      false,
    ],
    ["wide but flat", { w: 0.8, h: 0.08 }, false],
    ["tall but narrow", { w: 0.05, h: 0.9 }, false],
    ["a zero-area rect", { w: 0, h: 0 }, false],
  ];

  for (const [name, size, expected] of cases) {
    it(`${name} → showIcon ${expected}`, () => {
      const spec = thumbSpec(
        [item({ rect: { x: 0, y: 0, w: size.w, h: size.h } })],
        SIZE,
      );
      expect(spec[0].showIcon).toBe(expected);
    });
  }

  it("drops the mark, never the box", () => {
    const spec = thumbSpec(
      [
        item({ rect: { x: 0, y: 0, w: 0.9, h: 0.02 }, kind: "text" }),
        item({ rect: { x: 0, y: 0.5, w: 0.3, h: 0.3 }, kind: "clock" }),
      ],
      SIZE,
    );
    expect(spec.map((s) => s.kind)).toEqual(["text", "clock"]);
    expect(spec.map((s) => s.showIcon)).toEqual([false, true]);
  });
});

describe("thumbSpec — stacking", () => {
  it("sorts ascending by z (painter's order, bottom first)", () => {
    const spec = thumbSpec(
      [
        item({ kind: "a", z: 4 }),
        item({ kind: "b", z: 0 }),
        item({ kind: "c", z: 2 }),
      ],
      SIZE,
    );
    expect(spec.map((s) => s.kind)).toEqual(["b", "c", "a"]);
  });

  it("keeps input order among equal z (stable)", () => {
    const spec = thumbSpec(
      [
        item({ kind: "first", z: 1 }),
        item({ kind: "second", z: 1 }),
        item({ kind: "third", z: 1 }),
      ],
      SIZE,
    );
    expect(spec.map((s) => s.kind)).toEqual(["first", "second", "third"]);
  });

  it("does not mutate the input array", () => {
    const items = [item({ kind: "a", z: 9 }), item({ kind: "b", z: 1 })];
    thumbSpec(items, SIZE);
    expect(items.map((i) => i.kind)).toEqual(["a", "b"]);
  });
});

describe("thumbSpec — degenerate surfaces", () => {
  const bad: [string, { w: number; h: number }][] = [
    ["zero width", { w: 0, h: 70 }],
    ["zero height", { w: 112, h: 0 }],
    ["both zero", { w: 0, h: 0 }],
    ["negative", { w: -112, h: -70 }],
  ];

  for (const [name, size] of bad) {
    it(`${name} → empty list`, () => {
      expect(thumbSpec([item()], size)).toEqual([]);
    });
  }

  it("an empty board is an empty list", () => {
    expect(thumbSpec([], SIZE)).toEqual([]);
  });
});
