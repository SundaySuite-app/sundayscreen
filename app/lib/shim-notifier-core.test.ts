import { describe, expect, it } from "vitest";

import { createNotifierSlot, type ShimNotifier } from "./shim-notifier-core";

function defaults(log: string[]): ShimNotifier {
  return {
    toast: (kind, msg) => log.push(`default-toast:${kind}:${msg}`),
    navigate: (page) => log.push(`default-nav:${page}`),
    t: (key, fallback) => fallback ?? key,
  };
}

describe("createNotifierSlot", () => {
  it("uses the defaults until a host installs an override", () => {
    const log: string[] = [];
    const slot = createNotifierSlot(defaults(log));
    slot.current().toast("error", "x");
    expect(log).toEqual(["default-toast:error:x"]);
  });

  it("a PARTIAL override keeps the defaults for what it leaves out", () => {
    const log: string[] = [];
    const slot = createNotifierSlot(defaults(log));
    slot.set({ toast: (kind, msg) => log.push(`host:${kind}:${msg}`) });
    slot.current().toast("error", "a");
    slot.current().navigate("home");
    expect(log).toEqual(["host:error:a", "default-nav:home"]);
  });

  it("an explicitly-undefined field does not clobber the default", () => {
    const log: string[] = [];
    const slot = createNotifierSlot(defaults(log));
    slot.set({ toast: undefined });
    expect(() => slot.current().toast("error", "still works")).not.toThrow();
    expect(log).toEqual(["default-toast:error:still works"]);
  });

  it("set(null) restores the defaults", () => {
    const log: string[] = [];
    const slot = createNotifierSlot(defaults(log));
    slot.set({ toast: () => log.push("host") });
    slot.set(null);
    slot.current().toast("error", "b");
    expect(log).toEqual(["default-toast:error:b"]);
  });
});
