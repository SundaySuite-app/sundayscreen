// The design session: the planner BORROWS the board.
//
// «Rediger skjermen for onsdag, 3. time» must not put that screen on the
// projector — the class is watching the one that is already there. But the
// editor the teacher gets has to be the REAL one: Surface, WidgetShell,
// useDrag, the add menu, the layout store's undo slot and its serialised
// persister. So instead of a second, parameterised store (twelve widget
// folders threaded with a context, two persisters, two undo stacks, two
// truths), the session borrows the GLOBALS for as long as the planner panel
// covers the screen, and hands them back on the way out.
//
// Since this is a one-window app, «designing never touches what the class
// sees» is not a pixel invariant. It is three STATE invariants, and they are
// what `design-session.test.ts` is about:
//
//   1. WRITE ISOLATION. Every `layout_save` made during a session carries the
//      DESIGN scene's id. The lesson's rows are never written.
//   2. POINTER ISOLATION. Nothing here touches `settings.activeSceneId`, the
//      backend's pointer, or the class and its members. A crash mid-session is
//      therefore not a mess to clean up: the next boot's `class_ensure_active`
//      lands on the lesson's screen because nothing ever said otherwise.
//   3. RESTITUTION. Every way out of the panel runs through `exitDesign`,
//      which flushes the design scene BEFORE the globals go back.
//
// ## The dangerous line
//
// The FLUSH ORDER, both ways. The persister reads `activeScene` at WRITE time
// (state/layout.ts), not at queue time — which is exactly what makes it safe
// under a swap, and exactly what makes it lethal under a badly ordered one: a
// debounced design edit that lands AFTER the restore is written into the
// LESSON's scene, silently, with the class in front of the board. Hence
// `flushPending()` before the borrow and before the hand-back, and hence the
// first test in the file next door.
//
// ## Imports, deliberately narrow
//
// layout, surface, i18n, toast — and never `state/planner.ts` or
// `state/scenes.ts`. Those two import THIS module (the auto-switch guard and
// the `switchLesson` belt), so the arrow may only point one way.

import { batch, signal } from "@preact/signals";

import type { Scene } from "../bindings/Scene";
import type { WidgetInstance } from "../bindings/WidgetInstance";
import { t } from "../i18n";
import type { Size } from "../screen/coords-core";
import { toast } from "../ui/toast";
import { invalidateThumb } from "./scene-thumbs";
import {
  activeScene,
  adoptDesignBoard,
  flushPending,
  layoutHydrated,
  widgets,
} from "./layout";
import { surfaceSize } from "./surface";

/** The board to hand back when the session ends — held in MEMORY, never
 *  re-read: the lesson's rows on disk were not touched, so a re-read would be
 *  a second chance to fail at something that cannot have changed. */
export interface DesignReturn {
  scene: Scene | null;
  widgets: WidgetInstance[];
  hydrated: boolean;
}

export interface DesignSession {
  /** The screen being edited — the write key for every save in the session. */
  scene: Scene;
  /**
   * The REAL surface's size when the session opened, so the panel's little
   * board can carry the projector's proportion. Captured before the borrow:
   * the design Surface's own ResizeObserver overwrites `surfaceSize` the
   * moment it mounts, and by then the number is about the frame, not the wall.
   */
  aspect: Size;
  /**
   * Where to go back to — or `null` for SAME-SCENE mode, which is what
   * «design the screen that is already on the board» is. Editing the lesson's
   * own screen IS editing the board; a restore there would throw the work
   * away the moment the teacher pressed «Ferdig».
   */
  returnTo: DesignReturn | null;
}

export const designSession = signal<DesignSession | null>(null);

/**
 * Open the editor on `scene` without putting it on the projector.
 *
 * Rejection of the load ABORTS without swapping anything (F9-funn S#4). The
 * store's writes are replace-all, so borrowing a scene whose rows we failed to
 * read and then saving once would wipe that screen — the failure mode is not
 * «the panel opened empty», it is «the screen the teacher was about to edit no
 * longer exists». A toast, and nothing moves.
 */
export async function enterDesign(scene: Scene): Promise<void> {
  // Re-entry is a NO-OP, not a nested session. Two «Design»-buttons on the
  // same panel (the week grid's and the day card's) are one mis-aimed click
  // apart, and a second borrow would overwrite `returnTo` with the DESIGN
  // board — the way home, replaced by where we already are.
  if (designSession.peek()) return;

  const current = activeScene.peek();
  if (current !== null && current.id === scene.id) {
    batch(() => {
      // No swap — but the view state is still cleared, through the same one
      // door the borrow path uses: the board is about to be drawn at a
      // fraction of its size inside a panel, and a selection, an enlarged
      // card or a pending undo carried across that change is at best noise.
      adoptDesignBoard(current, widgets.peek(), layoutHydrated.peek());
      designSession.value = {
        scene: current,
        aspect: surfaceSize.peek(),
        returnTo: null,
      };
    });
    return;
  }

  // The lesson's debounced write lands BEFORE the borrow (F-funn B7). After
  // this line `activeScene` may move; before it, everything queued belongs to
  // the screen on the wall and is written under its id.
  await flushPending();

  let loaded: WidgetInstance[];
  try {
    loaded = await window.api.layoutLoad(scene.id);
  } catch (e) {
    console.warn("[design] layout_load failed — the session is not opened", e);
    toast("error", t("manage.actionFailed"));
    return;
  }

  batch(() => {
    designSession.value = {
      scene,
      aspect: surfaceSize.peek(),
      returnTo: {
        scene: current,
        widgets: widgets.peek(),
        hydrated: layoutHydrated.peek(),
      },
    };
    adoptDesignBoard(scene, loaded);
  });
}

/**
 * Close the session and hand the board back. The ONE door out — «Ferdig», the
 * panel's close button, Escape and the `switchLesson` belt all arrive here, so
 * that the flush below cannot be routed around.
 *
 * A write that FAILS here leaves `saveError` standing (the shell's sticky
 * chip; the house never fabricates a success) and the restore runs anyway:
 * refusing to give the projector its screen back because a save failed would
 * turn one lost edit into a lesson spent looking at the wrong board.
 */
export async function exitDesign(): Promise<void> {
  const session = designSession.peek();
  if (!session) return;

  // FIRST, and while `activeScene` is still the design scene: the persister
  // reads it at write time, so anything still debounced is written under the
  // design scene's id here — or under the LESSON's id, three lines later.
  await flushPending();

  const back: DesignReturn = session.returnTo ?? {
    // Same-scene mode: there is nothing to hand back, because the board on
    // screen already IS the lesson's board. Re-adopting it unchanged is how
    // the view state gets cleared through the same door as the borrow path,
    // rather than a second copy of that rule living here.
    scene: activeScene.peek(),
    widgets: widgets.peek(),
    hydrated: layoutHydrated.peek(),
  };

  batch(() => {
    // From MEMORY. `back.hydrated` travels with it for a reason: the lesson's
    // board may have been un-hydrated when the session opened (a failed
    // `layout_load` at boot), and handing it back as hydrated would unblock
    // replace-all writes over a layout nobody ever read — S#4, from the other
    // end.
    adoptDesignBoard(back.scene, back.widgets, back.hydrated);
    designSession.value = null;
  });

  // The scene's thumbnail in the planner is stale now — this is the only
  // place that knows a screen was just edited off-board. (scene-thumbs
  // imports nothing of the planner states, so no cycle.)
  invalidateThumb(session.scene.id);
}
