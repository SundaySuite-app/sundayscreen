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

export function SceneSwitcher() {
  const open = sceneMenuOpen.value;
  const scene = activeScene.value;
  const cls = activeClass.value;
  const isDefault = scene?.classId != null;
  const [saveDraft, setSaveDraft] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fail = (e: unknown) => {
    console.warn("[scenes] action failed", e);
    toast("error", t("manage.actionFailed"));
  };
  const closeEditors = () => {
    setSaveDraft(null);
    setRenamingId(null);
    setConfirmDeleteId(null);
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
        {isDefault ? t("scene.default") : (scene?.name ?? "…")}
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
            {scenes.value.length > 0 && <div class={styles.divider} />}
            {scenes.value.map((s) =>
              renamingId === s.id ? (
                <input
                  key={s.id}
                  class={styles.inlineInput}
                  aria-label={t("manage.rename")}
                  value={renameDraft}
                  autofocus
                  onInput={(e) =>
                    setRenameDraft((e.target as HTMLInputElement).value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renameDraft.trim()) {
                      void renameScene(s.id, renameDraft).catch(fail);
                      setRenamingId(null);
                    }
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => setRenamingId(null)}
                />
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
                  {confirmDeleteId === s.id ? (
                    <button
                      class={styles.confirmDelete}
                      onClick={() => {
                        setConfirmDeleteId(null);
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
                          setConfirmDeleteId(null);
                        }}
                      >
                        <Icon name="pencil" size="sm" />
                      </button>
                      <button
                        class={styles.rowAction}
                        aria-label={t("manage.delete")}
                        title={t("manage.delete")}
                        onClick={() => setConfirmDeleteId(s.id)}
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
                  if (e.key === "Enter" && saveDraft.trim() && scene) {
                    void saveCurrentAsScene(scene.id, saveDraft).catch(fail);
                    setSaveDraft(null);
                  }
                  if (e.key === "Escape") setSaveDraft(null);
                }}
                onBlur={() => setSaveDraft(null)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
