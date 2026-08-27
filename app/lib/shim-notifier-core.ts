// The host-injection seam for the shell services `api-shim.ts` uses — pure,
// no DOM, no Tauri.
//
// The shim is the ONE door into the backend, and it needs three things from
// whatever shell sits on top of it: a way to SAY something went wrong, a way
// to NAVIGATE (the `?goto=` hook), and a way to TRANSLATE the copy for the
// first. A SLOT holds them; the defaults are what is honest before a host
// installs anything (console for messages, a loud decline for navigation).

/** The toast kinds the shell's toast surface accepts. Mirrored (not imported)
 *  so this module stays free of the DOM module graph. */
export type ShimToastKind = "info" | "success" | "warn" | "error";

/** Options the shim's one `navigate` call site passes. */
export interface ShimNavigateOpts {
  tab?: string;
}

/** The three host services `api-shim.ts` reaches for. */
export interface ShimNotifier {
  /** Surface a message. The shim only ever sends `"error"`. */
  toast(kind: ShimToastKind, msg: string): void;
  /** Go to a page. Only used by the `?goto=` hook. */
  navigate(page: string, opts?: ShimNavigateOpts): void;
  /** Translate a key, falling back to the given literal. */
  t(key: string, fallback?: string): string;
}

/** A live, replaceable `ShimNotifier`. */
export interface NotifierSlot {
  /** The notifier in force right now. Read per call — a host may install its
   *  own after the shim module has already evaluated. */
  current(): ShimNotifier;
  /** Install an override (merged over the defaults), or `null` to restore
   *  the defaults. */
  set(override: Partial<ShimNotifier> | null): void;
}

/** Drop explicitly-`undefined` fields so `{ toast: undefined }` does not
 *  clobber the default with a hole that then throws at the call site. */
function defined(override: Partial<ShimNotifier>): Partial<ShimNotifier> {
  const out: Partial<ShimNotifier> = {};
  if (typeof override.toast === "function") out.toast = override.toast;
  if (typeof override.navigate === "function") out.navigate = override.navigate;
  if (typeof override.t === "function") out.t = override.t;
  return out;
}

/** Create the slot. `defaults` is what the shim behaves like when nobody has
 *  injected anything. */
export function createNotifierSlot(defaults: ShimNotifier): NotifierSlot {
  let active: ShimNotifier = defaults;
  return {
    current: () => active,
    set(override) {
      active = override ? { ...defaults, ...defined(override) } : defaults;
    },
  };
}
