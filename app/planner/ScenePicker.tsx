// «Which screen is this lesson on» — the ONE control, shared by the week
// grid's cell editor and the day tab's override editor.
//
// It replaces two hand-rolled `<select>`s that had drifted into copies of
// each other, and it adds the two things a bare dropdown could not:
//
//   - a PICTURE of the screen that is selected (SceneThumb), because three
//     screen names are three words and a teacher cannot tell from them which
//     one has the timer on it;
//   - a way to make a NEW screen right here. `scene_create` has existed in the
//     backend since 0003 with no door in the UI at all: the only way to get a
//     library screen was «Lagre som ny skjerm …», which copies the board that
//     happens to be on the projector. Planning next Wednesday's lesson is
//     exactly when the teacher wants an EMPTY one.
//
// ## What this component does not do
//
// It does not write the slot or the override, and it does not open the
// editor. `onChange` and `onDesign` hand both back to the editor that owns the
// draft — which is what lets «Design» save the pending change FIRST (wave 3),
// so entering the design session cannot be the moment a half-typed lesson is
// lost. A picker that saved on its own would have to know which of the two
// editors it was standing in, and that is the coupling this file exists to
// remove.

import { useState } from "preact/hooks";

import type { Scene } from "../bindings/Scene";
import { t } from "../i18n";
import { LIMITS } from "@lib/limits.generated";
import { loadScenes, scenes } from "../state/scenes";
import { Icon } from "../ui/Icon";
import { toast } from "../ui/toast";
import { SceneThumb } from "./SceneThumb";
import styles from "./ScenePicker.module.css";

export interface ScenePickerProps {
  /** The scene id the lesson points at. `null` = the class's default screen. */
  value: string | null;
  onChange(id: string | null): void;
  /**
   * «Design» was pressed. The argument is the library scene to open, or
   * `null` for «the default screen of `classIdForDefault`» — the caller
   * synthesises that `Scene` (the class default is deliberately not in the
   * library, see commands/scenes.rs) and then calls `enterDesign`.
   *
   * Never fired with `null` when `value` is set: an id that no longer
   * resolves to a scene disables the button instead, so «Design» can never
   * quietly open the DEFAULT screen when the teacher asked for a named one.
   */
  onDesign(scene: Scene | null): void;
  /** Whose default screen `null` means, here. `null` when the lesson has no
   *  class yet — then there is no default to picture or to design. */
  classIdForDefault: string | null;
  disabled?: boolean;
}

export function ScenePicker(props: ScenePickerProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const disabled = props.disabled ?? false;

  const selected =
    props.value != null
      ? (scenes.value.find((s) => s.id === props.value) ?? null)
      : null;

  // A named screen that is not in the library any more (deleted in another
  // tab of the panel) is the one case where we know the id but not the
  // scene. Disabled beats guessing.
  const canDesign =
    props.value == null ? props.classIdForDefault != null : selected != null;

  const create = async (name: string) => {
    try {
      const created = await window.api.sceneCreate(name);
      await loadScenes();
      props.onChange(created.id);
    } catch (e) {
      console.warn("[scenes] create failed", e);
      toast("error", t("manage.actionFailed"));
    }
  };

  // Enter or the tick — never blur. A name that vanishes because the teacher
  // clicked elsewhere is the bug SceneSwitcher already fixed once; the same
  // rule, for the same reason (mousedown on the tick fires blur first, the
  // field unmounts, and the click never lands).
  const commit = () => {
    const name = draft?.trim();
    if (!name) return;
    setDraft(null);
    void create(name);
  };

  return (
    <div class={styles.picker}>
      <div class={styles.top}>
        <label class={styles.field}>
          {t("planner.scene")}
          <select
            aria-label={t("planner.scene")}
            value={props.value ?? ""}
            disabled={disabled}
            onChange={(e) =>
              props.onChange((e.target as HTMLSelectElement).value || null)
            }
          >
            <option value="">{t("scene.default")}</option>
            {scenes.value.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <SceneThumb
          sceneId={props.value}
          classIdForDefault={props.classIdForDefault}
        />
      </div>
      {draft === null ? (
        <div class={styles.actions}>
          <button
            type="button"
            class={styles.secondary}
            disabled={disabled}
            onClick={() => setDraft("")}
          >
            <Icon name="plus" size="sm" />
            {t("planner.newSceneForLesson")}
          </button>
          <button
            type="button"
            class={styles.primary}
            disabled={disabled || !canDesign}
            onClick={() => props.onDesign(selected)}
          >
            <Icon name="scene" size="sm" />
            {t("planner.design")}
          </button>
        </div>
      ) : (
        <div class={styles.row}>
          <input
            class={styles.inlineInput}
            aria-label={t("planner.newSceneName")}
            placeholder={t("planner.newSceneName")}
            value={draft}
            autofocus
            /* The backend truncates a longer name silently
               (`valid_scene_name`), so the cap belongs at the keyboard: a
               teacher should not name a screen and then find it renamed. */
            maxLength={LIMITS.CLASS_NAME_MAX_CHARS}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft(null);
            }}
          />
          <button
            type="button"
            class={styles.rowAction}
            aria-label={t("scene.confirmName")}
            title={t("scene.confirmName")}
            onClick={commit}
          >
            <Icon name="check" size="sm" />
          </button>
        </div>
      )}
    </div>
  );
}
