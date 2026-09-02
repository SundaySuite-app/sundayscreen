// A small picture of a screen: one box per widget, its kind's mark inside.
//
// The planner's old answer to «which screen is this lesson on» was a NAME in
// a dropdown, and a teacher with «Morgensamling», «Stillelesing» and
// «Prøve» cannot tell from three words which one has the timer on it. The
// geometry is `scene-thumb-core.ts`; the rows come from `state/scene-thumbs`;
// this file only draws.
//
// ## The one thing it must never do
//
// Render an empty board for a screen it could not read. A failed
// `layout_load` and a screen with nothing on it look identical, and the
// difference matters exactly when the teacher is deciding whether to reuse
// the screen. So `error` gets its own visible state and its own
// `data-thumb-state` — the F13 lie, refused in the one place it would appear.

import { useEffect } from "preact/hooks";

import { t } from "../i18n";
import { defaultSceneId } from "@lib/scene-ids";
import type { Size } from "../screen/coords-core";
import { ensureThumb, thumbCache } from "../state/scene-thumbs";
import { Icon } from "../ui/Icon";
import { WIDGET_REGISTRY, type WidgetDef } from "../widgets/registry";
import { thumbSpec } from "./scene-thumb-core";
import styles from "./SceneThumb.module.css";

/** The default picture size: the reference surface's 16:10, small enough to
 *  sit inside a week-grid cell and still show four cards apart. */
export const DEFAULT_THUMB_SIZE: Size = { w: 112, h: 70 };

/** What the thumbnail is currently able to say. Rendered as
 *  `data-thumb-state` so the CSS — and an e2e test — can tell the four
 *  apart without reading pixels. */
type ThumbState = "ready" | "loading" | "error" | "unknown";

/**
 * Look a kind up WITHOUT narrowing it first.
 *
 * `WIDGET_REGISTRY` is `Record<WidgetKind, WidgetDef>`, which promises a def
 * for every key — true of the kinds this build knows, and false of a kind
 * left behind by a newer one (promise 3). The widened index is what makes
 * `?.icon` meaningful instead of decorative.
 */
const REGISTRY = WIDGET_REGISTRY as Record<string, WidgetDef | undefined>;

export function SceneThumb(props: {
  /** The screen to picture. `null` = the class's default screen. */
  sceneId: string | null;
  /** Which class's default to picture when `sceneId` is null. Without it a
   *  null `sceneId` is only a LABEL — there is no board to name yet. */
  classIdForDefault?: string | null;
  size?: Size;
}) {
  const size = props.size ?? DEFAULT_THUMB_SIZE;
  const isDefault = props.sceneId == null;
  const id =
    props.sceneId ??
    (props.classIdForDefault != null
      ? defaultSceneId(props.classIdForDefault)
      : null);

  // Reads the signal, and thereby subscribes: this cell re-renders when ITS
  // screen arrives, and so does every other cell pointing at the same one.
  const entry = id != null ? thumbCache.value.get(id) : undefined;

  // No dependency list on purpose. `ensureThumb` is a no-op once an entry of
  // any kind exists, so the guard lives in the cache rather than in a
  // dependency array that would have to list `entry === undefined` and get
  // it right forever. The loop it looks like cannot happen: the first call
  // writes `loading` synchronously.
  useEffect(() => {
    if (id != null && entry === undefined) void ensureThumb(id);
  });

  const state: ThumbState =
    id == null ? "unknown" : (entry?.status ?? "loading");
  const boxes =
    entry?.status === "ready"
      ? thumbSpec(
          entry.items.map((w) => ({
            rect: w.rect,
            kind: w.config.kind,
            z: w.z,
          })),
          size,
        )
      : [];

  return (
    <div
      class={styles.thumb}
      data-thumb-state={state}
      data-default={isDefault || undefined}
      style={{ width: `${size.w}px`, height: `${size.h}px` }}
    >
      {boxes.map((b, i) => {
        // An unknown kind resolves to `undefined` and draws as a bare box —
        // promise 3 all the way to the picture: a widget this build cannot
        // name is still a widget that is THERE.
        const def = REGISTRY[b.kind];
        return (
          <span
            // Position IS the identity here: two widgets of the same kind are
            // told apart by where they sit, and the list is rebuilt from
            // scratch on every load anyway.
            key={`${b.kind}-${i}`}
            class={styles.box}
            style={{
              left: `${b.box.x}px`,
              top: `${b.box.y}px`,
              width: `${b.box.w}px`,
              height: `${b.box.h}px`,
            }}
          >
            {b.showIcon && def && (
              <Icon name={def.icon} size="sm" class={styles.mark} />
            )}
          </span>
        );
      })}
      {/* Neither a board nor a claim about one: the two states where the
          picture is genuinely unknown get a quiet placeholder bar, and the
          `error` one gets the dashed frame its data-attribute names. */}
      {(state === "loading" || state === "error" || state === "unknown") && (
        <span class={styles.placeholder} />
      )}
      {isDefault && <span class={styles.badge}>{t("scene.default")}</span>}
    </div>
  );
}
