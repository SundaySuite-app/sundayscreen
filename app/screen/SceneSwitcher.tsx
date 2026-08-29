// The screen switcher: the class's default screen plus the global library.
// Same trigger/backdrop/upward-menu pattern as the class switcher. «Lagre
// som ny skjerm …» copies what is on screen into the library; each library
// row can be renamed inline or deleted behind a two-step confirm.

import { useState } from "preact/hooks";

import { t } from "../i18n";
import { activeClass, activeScene } from "../state/layout";
import {
  deleteScene,
  renameScene,
  saveCurrentAsScene,
  sceneMenuOpen,
  scenes,
  switchScene,
} from "../state/scenes";
import { Icon } from "../ui/Icon";
import { toast } from "../ui/toast";
import styles from "./SceneSwitcher.module.css";

/**
 * How long a delete confirmation stays inert after it is armed.
 *
 * `.confirmDelete` renders EXACTLY where the pencil and trash buttons stood,
 * and a library screen is a whole setup that `deleteScene` cannot undo
 * (removing a single widget at least has the snackbar). So a double-click
 * aimed at «Gi nytt navn» or «Slett» must not walk straight through the
 * confirmation.
 *
 * A time check rather than a `disabled` attribute on purpose: a button that
 * flips disabled → enabled in front of a class reads as a FAULT on the
 * projector. This one simply ignores the impossibly fast second click.
 */
export const CONFIRM_ARM_MS = 400;

/** Has an armed confirmation been on screen long enough to be MEANT? */
export function confirmArmed(armedAt: number, now: number): boolean {
  return now - armedAt >= CONFIRM_ARM_MS;
}

interface ArmedDelete {
  id: string;
  armedAt: number;
}

export function SceneSwitcher() {
  const open = sceneMenuOpen.value;
  const scene = activeScene.value;
  const cls = activeClass.value;
  const isDefault = scene?.classId != null;
  const [saveDraft, setSaveDraft] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [armedDelete, setArmedDelete] = useState<ArmedDelete | null>(null);

  const fail = (e: unknown) => {
    console.warn("[scenes] action failed", e);
    toast("error", t("manage.actionFailed"));
  };
  const closeEditors = () => {
    setSaveDraft(null);
    setRenamingId(null);
    setArmedDelete(null);
  };

  // The two inline fields used to drop the draft on BLUR: the teacher typed a
  // name, clicked somewhere else and it was gone without a word. `onBlur` is
  // gone entirely rather than turned into a commit — mousedown on the tick
  // fires blur BEFORE click, the field unmounts, and the click would never
  // land. The ways in and out are now Enter or the tick to save, Escape or
  // closing the menu to cancel.
  const commitSave = () => {
    if (saveDraft == null || saveDraft.trim() === "" || !scene) return;
    void saveCurrentAsScene(scene.id, saveDraft).catch(fail);
    setSaveDraft(null);
  };
  const commitRename = (id: string) => {
    if (renameDraft.trim() === "") return;
    void renameScene(id, renameDraft).catch(fail);
    setRenamingId(null);
  };

  return (
    <div class={styles.wrap}>
      <button
        class={styles.trigger}
        aria-label={t("scene.switch")}
        title={t("scene.switch")}
        aria-expanded={open}
        onClick={() => {
          closeEditors();
          sceneMenuOpen.value = !open;
        }}
      >
        <Icon name="scene" size="sm" class={styles.sceneIcon} />
        {/* «Standard skjerm», not the bare «Standard» — the label has to say
         * what it is a default OF. `scene.default` keeps its shorter wording
         * because it doubles as an <option> inside the planner.
         *
         * Its own element so the name can be TRUNCATED: a teacher names her
         * screens freely, the toolbar is one row on a 1024×768 projector, and
         * an unbounded name is the one input that can wrap it. The full name
         * is a click away in the menu below. */}
        <span class={styles.triggerLabel}>
          {isDefault ? t("scene.defaultLabel") : (scene?.name ?? "…")}
        </span>
        <Icon name="chevron-down" size="sm" class={styles.chevron} />
      </button>
      {open && (
        <>
          <button
            class={styles.backdrop}
            aria-label={t("manage.close")}
            onClick={() => {
              sceneMenuOpen.value = false;
            }}
          />
          <div class={styles.menu} role="menu">
            <button
              role="menuitem"
              class={styles.item}
              data-current={isDefault || undefined}
              onClick={() => void switchScene(null).catch(fail)}
            >
              {cls ? `${t("scene.default")} — ${cls.name}` : t("scene.default")}
            </button>
            {/* An empty library explained itself with nothing at all. A
             * paragraph, NOT a `role="menuitem"` — a sentence that answers
             * to the arrow keys is a menu choice that does nothing. */}
            {scenes.value.length === 0 && (
              <p class={styles.emptyHint}>{t("scene.emptyHint")}</p>
            )}
            {scenes.value.length > 0 && <div class={styles.divider} />}
            {scenes.value.map((s) =>
              renamingId === s.id ? (
                <div key={s.id} class={styles.row}>
                  <input
                    class={styles.inlineInput}
                    aria-label={t("manage.rename")}
                    placeholder={t("scene.renamePlaceholder")}
                    value={renameDraft}
                    autofocus
                    onInput={(e) =>
                      setRenameDraft((e.target as HTMLInputElement).value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(s.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                  <button
                    class={styles.rowAction}
                    aria-label={t("scene.confirmName")}
                    title={t("scene.confirmName")}
                    onClick={() => commitRename(s.id)}
                  >
                    <Icon name="check" size="sm" />
                  </button>
                </div>
              ) : (
                <div key={s.id} class={styles.row}>
                  <button
                    role="menuitem"
                    class={styles.item}
                    data-current={scene?.id === s.id || undefined}
                    onClick={() => void switchScene(s.id).catch(fail)}
                  >
                    {s.name}
                  </button>
                  {armedDelete?.id === s.id ? (
                    <button
                      class={styles.confirmDelete}
                      onClick={() => {
                        if (!confirmArmed(armedDelete.armedAt, Date.now()))
                          return;
                        setArmedDelete(null);
                        void deleteScene(s.id).catch(fail);
                      }}
                    >
                      {t("scene.deleteConfirm")}
                    </button>
                  ) : (
                    <>
                      <button
                        class={styles.rowAction}
                        aria-label={t("manage.rename")}
                        title={t("manage.rename")}
                        onClick={() => {
                          setRenamingId(s.id);
                          setRenameDraft(s.name);
                          setArmedDelete(null);
                        }}
                      >
                        <Icon name="pencil" size="sm" />
                      </button>
                      <button
                        class={styles.rowAction}
                        aria-label={t("manage.delete")}
                        title={t("manage.delete")}
                        onClick={() =>
                          setArmedDelete({ id: s.id, armedAt: Date.now() })
                        }
                      >
                        <Icon name="trash" size="sm" />
                      </button>
                    </>
                  )}
                </div>
              ),
            )}
            <div class={styles.divider} />
            {saveDraft === null ? (
              <button
                role="menuitem"
                class={styles.saveAs}
                onClick={() => setSaveDraft("")}
              >
                <Icon name="save" size="sm" />
                {t("scene.saveAs")}
              </button>
            ) : (
              <div class={styles.row}>
                <input
                  class={styles.inlineInput}
                  placeholder={t("scene.namePlaceholder")}
                  aria-label={t("scene.namePlaceholder")}
                  value={saveDraft}
                  autofocus
                  onInput={(e) =>
                    setSaveDraft((e.target as HTMLInputElement).value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSave();
                    if (e.key === "Escape") setSaveDraft(null);
                  }}
                />
                <button
                  class={styles.rowAction}
                  aria-label={t("scene.confirmName")}
                  title={t("scene.confirmName")}
                  onClick={commitSave}
                >
                  <Icon name="check" size="sm" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
