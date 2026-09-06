// THE LOADING BOUNDARY for the modal panels (ADR-019) — one helper, so the
// boundary is spelled once and cannot drift into a copy per panel.
//
// ## The rule this file exists to hold
//
// All three modal panels — `manage/ManagePanel`, `planner/PlannerPanel` and
// `manage/AttendancePanel` — are reached ONLY through the `import()` calls in
// `Shell.tsx`. A static `import { PlannerPanel } from "./planner/PlannerPanel"`
// anywhere melts the whole cluster — the planner's three tabs, the design
// panel, the scene picker and its thumbnails, the transfer forms — back into
// the index chunk, which every teacher parses on every boot whether or not she
// opens a panel that day. `LazyQr.tsx` is the precedent (ADR-017),
// `scripts/check-bundle-budget.mjs` is what notices when it stops being true:
// an async chunk counts in the dist TOTAL, never in the largest single JS
// file.
//
// The rule that holds the boundary is not «use `import()`» — it is that a
// panel file exports UI and nothing else, and openers live in `state/*`. The
// attendance panel is the lesson: for a while `screen/ClassSwitcher.tsx`
// imported `openAttendanceFromMenu` from the panel file, and that ONE static
// import pinned the module in the index chunk whatever the shell did. The
// opener lives in `state/attendance.ts` now (ADR-019), and a helper that
// «fits so nicely» next to its panel is the same regression waiting to happen.
//
// ## Cached ONCE per session, and the failure is not cached
//
// A chunk that landed is remembered as a MODULE, so the second open mounts in
// the same commit as the click — no second fetch, no blank frame. A chunk that
// would not load is remembered as nothing at all: the promise is dropped, so
// the next open asks again.
//
// ⚠️ …and the ENGINE does not forget, which is why the copy says what it says.
// Measured (Chromium, e2e/lazy-panels.spec.ts): after a failed fetch, the
// second `import()` of the same specifier never reaches the network — the
// module map keeps the failure for the life of the document. So this cache is
// the half we control, not a promise that a retry works: dropping the promise
// means the app adds no SECOND memory on top of the platform's (and an engine
// that does allow a re-fetch gets one), while `error.panelLoadFailed` is the
// sentence that is true either way. `manage.actionFailed` — «Noe gikk galt —
// prøv igjen» — was the obvious reuse and is rejected for exactly that: it
// promises a retry this failure class cannot honour, and sends a teacher
// clicking instead of restarting.
//
// ## What the load WINDOW looks like, and why nothing is drawn in it
//
// The open signal flips first, the panel arrives a tick later. In between the
// board is already `inert` (Shell.tsx reads `modalPanelOpen`, not the mounted
// panel) and Escape already peels the panel's rung (`screen/keyboard.ts` reads
// the same signal) — so the window has no state a teacher can get stuck in:
// Escape in it closes the panel that was opening, and nothing appears
// afterwards. Measured off local disk the window is a few milliseconds, which
// is why there is no spinner: a plate that flashes for one frame is worse on a
// projector than nothing at all.
//
// One thing the window DOES own: the keyboard. The panel's own focus hook
// (`useDialogFocus`) hands the keyboard back to the opener on unmount — and it
// only exists once the panel has mounted. A panel closed inside the window
// (Escape, or a chunk that failed and closed itself) had blurred the opener
// when the wall went inert and had nobody to send the keyboard back:
// measured, `document.activeElement` was `<body>`, one Tab from the top of the
// document. So the boundary remembers the opener at the same moment the load
// starts and restores it from its own cleanup — only when the panel never
// landed, because once it has, the hook owns the way back and two `focus()`
// calls for one close is the kind of pair that gets one of them deleted.

import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";

import { t } from "../i18n";
import { rememberOpener } from "./dialog-focus";
import { toast } from "./toast";

/** A chunk that is fetched at most once — plus the synchronous answer to
 *  «is it already here?», which is what keeps a re-open from flashing. */
export interface ChunkCache<T> {
  /** The module if it has ALREADY landed, else `null`. Never starts a load. */
  ready(): T | null;
  /** The module, fetching it if this is the first ask. Rejects like the
   *  loader does — and then forgets, so the next ask tries again. */
  load(): Promise<T>;
}

/**
 * Cache one dynamic `import()`.
 *
 * Pure and loader-injected on purpose: cache-once and retry-after-failure are
 * the two behaviours worth pinning, and neither needs a DOM to be true
 * (`lazy-panel.test.ts` runs them in the node pass, house style).
 */
export function chunkCache<T>(importChunk: () => Promise<T>): ChunkCache<T> {
  let landed: T | null = null;
  let pending: Promise<T> | null = null;

  return {
    ready: () => landed,
    load(): Promise<T> {
      if (pending) return pending;
      // The async wrapper is not decoration: it turns a loader that throws
      // SYNCHRONOUSLY into a rejected promise, so the `pending = p` below
      // always runs and the forget-on-failure branch below can always undo
      // it. Without it a synchronous throw would escape past both.
      const p = (async (): Promise<T> => {
        const mod = await importChunk();
        landed = mod;
        return mod;
      })();
      pending = p;
      // FORGET a failure. Not «remember that it failed» — a broken read off a
      // sleeping disk is exactly the kind of failure that succeeds the second
      // time, and the app must not be the reason the second time never
      // happens (the ⚠️ at the top is about the half that is not ours).
      // Registered HERE, before the caller gets `p`, so this handler runs
      // before any caller's: the slot is
      // clear again by the time the panel decides what to do about it. It also
      // means the promise always has a handler, so a caller that gave up (an
      // unmounted panel) cannot leave an unhandled rejection behind.
      p.catch(() => {
        pending = null;
      });
      return p;
    },
  };
}

/**
 * Wrap a panel in its own loading boundary.
 *
 * Returns a component the shell mounts exactly where the eager one stood — it
 * renders the panel and NOTHING else, no wrapper element. That is load-bearing
 * for two things the shell already promises: the panels are counted as direct
 * children of `<main>` outside `[data-wall]` (panels-a11y.spec.ts), and a
 * design session's `<Surface/>` must sit where ADR-016 says it sits.
 *
 * `onFailed` closes the panel's own state. It is passed in rather than derived
 * because the planner has ONE door (`closePlanner`, which hands the borrowed
 * board back) while the other two are plain signals — the house rule about who
 * may set `plannerPanelOpen` does not get an exception for this file.
 */
export function lazyPanel(
  importChunk: () => Promise<ComponentType>,
  onFailed: () => void,
): ComponentType {
  const chunk = chunkCache(importChunk);

  return function LazyPanel() {
    // Seeded from the cache, so a panel opened for the second time is on
    // screen in the click's own commit.
    const [Panel, setPanel] = useState<ComponentType | null>(() =>
      chunk.ready(),
    );

    // Mount only: this component exists exactly as long as the panel is open
    // (the shell gates it on the signal), so there is no change a dependency
    // list could catch.
    useEffect(() => {
      if (chunk.ready()) return;
      // Who opened us — taken NOW, while the tracker still says the opener
      // (the window has nothing else to focus), and used only from the
      // cleanup below when the panel never got to hand it back itself.
      const restoreOpener = rememberOpener();
      let live = true;
      let landed = false;
      chunk.load().then(
        (Loaded) => {
          // The updater form, or `useState` would call the component.
          //
          // `live` is symmetry here, not machinery: Preact drops a state
          // update on an unmounted component by itself, so no test can tell
          // this branch with the flag from one without it. It is the other
          // branch that needs it, and one arm of a pair that checks and one
          // that does not is how the checked arm gets deleted later.
          if (live) {
            landed = true;
            setPanel(() => Loaded);
          }
        },
        (e: unknown) => {
          // A chunk that will not load is a broken install (ADR-017's reading
          // of the same failure), so it is logged where a developer looks and
          // said once where the teacher looks. Silence here would leave her
          // clicking «Planlegger» at a board that never changes.
          console.warn("[shell] panel chunk failed to load", e);
          // …but not if she has already closed it. A receipt for an action she
          // cancelled is noise, and the state it would «fix» is closed already.
          if (!live) return;
          toast("error", t("error.panelLoadFailed"));
          onFailed();
        },
      );
      return () => {
        live = false;
        // A flag rather than the `Panel` state: this effect is mount-only, so
        // `Panel` in its closure is forever the seed value. Once the panel has
        // landed its own hook owns the way back; before that, nobody does but
        // us. The failed-load branch needs no call of its own — `onFailed()`
        // closes the panel's signal, the shell unmounts this component, and
        // this cleanup runs with `landed` still false.
        if (!landed) restoreOpener();
      };
    }, []);

    return Panel ? <Panel /> : null;
  };
}
