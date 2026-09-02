// The screen switcher: the class's default screen plus the global library.
// Same trigger/backdrop/upward-menu pattern as the class switcher. «Lagre
// som ny skjerm …» copies what is on screen into the library; each library
// row can be renamed inline or deleted behind a two-step confirm.

import { useState } from "preact/hooks";

import { t, tDyn, tn } from "../i18n";
import { localDateStr } from "../planner/date-core";
import { activeClass, activeScene } from "../state/layout";
import {
  deleteScene,
  renameScene,
  saveCurrentAsScene,
  sceneMenuOpen,
  SCENE_THEMES,
  scenes,
  setSceneTheme,
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
  /**
   * How many lessons still point at this screen — `null` while the answer is
   * on its way, and `null` FOREVER if the read failed.
   *
   * The distinction is the whole point: `scene_usage` rejects rather than
   * returning a typed zero, because «Slett skjermen» and «Brukes av 0 timer —
   * slett likevel?» are different sentences and only one of them is a claim.
   * A failed read falls back to the wording that makes no claim at all.
   */
  usage: number | null;
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

  /**
   * Arm the delete, and ASK — in that order.
   *
   * The confirmation appears immediately with its plain wording; the count
   * arrives when it arrives and rewrites the button in place. Blocking the
   * arming on a database read would put a spinner between the teacher and a
   * confirmation she may well want to dismiss, and a backend that is not
   * answering would make the trash button look broken.
   *
   * `today` comes from the frontend because JS owns the wall clock (the
   * command counts overrides from today FORWARD — the past cannot be affected
   * by a deletion made now). The answer is dropped unless the SAME screen is
   * still the armed one: arming A, changing your mind and arming B must not
   * put A's number on B's button.
   */
  const arm = (id: string) => {
    setArmedDelete({ id, armedAt: Date.now(), usage: null });
    window.api
      .sceneUsage(id, localDateStr(new Date()))
      .then((usage) => {
        setArmedDelete((prev) =>
          prev && prev.id === id
            ? { ...prev, usage: usage.weekSlots + usage.futureOverrides }
            : prev,
        );
      })
      .catch((e) => {
        // Not a toast: the teacher asked to delete a screen, not to hear
        // about a count she never asked for. The button keeps the wording
        // that claims nothing.
        console.warn("[scenes] usage read failed", e);
      });
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
                      {/* The count only ever ADDS to the sentence. Zero and
                          «we could not find out» both read as the plain
                          «Slett skjermen» — never «Brukes av 0 timer», which
                          would be a claim the app has not earned. */}
                      {armedDelete.usage != null && armedDelete.usage > 0
                        ? tn("scene.deleteInUse", armedDelete.usage)
                        : t("scene.deleteConfirm")}
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
                        onClick={() => arm(s.id)}
                      >
                        <Icon name="trash" size="sm" />
                      </button>
                    </>
                  )}
                </div>
              ),
            )}
            {/* The BACKDROP colour of the screen that is on the board right
             * now — a row, not a submenu: five swatches read in one glance,
             * and the board behind the menu recolours on the click so the
             * choice is its own preview.
             *
             * It applies to the ACTIVE screen whichever kind it is; a class's
             * default screen is the one on the wall most of the week, so
             * leaving it out would have hidden the feature from the teacher
             * who never saves a library screen at all.
             *
             * `role="group"` with a name, rather than five loose buttons: a
             * screen reader announces «Skjermfarge, gruppe» once instead of
             * spelling out five colours with no shared heading. And NOT
             * `menuitem`s — these are settings inside the menu, not five more
             * ways to leave it. */}
            {scene && (
              <>
                <div class={styles.divider} />
                <div
                  class={styles.themeRow}
                  role="group"
                  aria-label={t("theme.title")}
                >
                  <span class={styles.themeLabel}>{t("theme.title")}</span>
                  <div class={styles.swatches}>
                    {SCENE_THEMES.map((option) => (
                      <button
                        key={option}
                        class={styles.swatch}
                        // The pair from tokens.css, bound by CSS — the swatch
                        // paints itself in the backdrop it stands for and
                        // marks itself in that backdrop's own ink, so an
                        // unreadable pair would be visible HERE first.
                        data-theme={option}
                        aria-label={tDyn("theme.name", option)}
                        title={tDyn("theme.name", option)}
                        aria-pressed={scene.theme === option}
                        onClick={() => void setSceneTheme(option).catch(fail)}
                      >
                        <span class={styles.swatchMark} />
                      </button>
                    ))}
                  </div>
                </div>
              </>
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
