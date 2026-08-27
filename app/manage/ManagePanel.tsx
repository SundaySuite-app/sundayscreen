// The manage overlay: classes (create/rename/delete-with-typed-confirm) and
// the active class's name list as a PASTE-FRIENDLY textarea — teachers paste
// from Excel, one name per line. Deleting a class is real data loss, so it
// takes typing the class name; deleting a widget is a snackbar, not a
// dialog — the asymmetry is deliberate.

import { useEffect, useState } from "preact/hooks";

import { t, tf, tn } from "../i18n";
import {
  classes,
  createClass,
  deleteClass,
  managePanelOpen,
  members,
  renameClass,
  saveMembers,
  switchClass,
} from "../state/classes";
import { activeClass } from "../state/layout";
import styles from "./ManagePanel.module.css";
import { namesToText, parseNameList } from "./name-list-core";

export function ManagePanel() {
  const current = activeClass.value;

  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteDraft, setDeleteDraft] = useState("");
  const [namesDraft, setNamesDraft] = useState(() =>
    namesToText(members.peek().map((m) => m.name)),
  );
  const [savedReceipt, setSavedReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the textarea whenever the ACTIVE CLASS changes (a switch inside
  // the panel) — not on every members change, or typing would fight the
  // store.
  useEffect(() => {
    setNamesDraft(namesToText(members.peek().map((m) => m.name)));
    setSavedReceipt(false);
  }, [current?.id]);

  // Escape is handled centrally (screen/keyboard.ts): text field first, then
  // the class menu, then this panel, then fullscreen — one layer per press.

  const run = (work: Promise<unknown>) => {
    setError(null);
    work.catch((e) => {
      console.warn("[manage] action failed", e);
      setError(t("manage.actionFailed"));
    });
  };

  const parsedCount = parseNameList(namesDraft).length;
  const deletingClass = classes.value.find((c) => c.id === deletingId);

  return (
    <div class={styles.scrim}>
      <section class={styles.panel} aria-label={t("manage.title")}>
        <header class={styles.header}>
          <h2 class={styles.title}>{t("manage.title")}</h2>
          <button
            class={styles.close}
            aria-label={t("manage.close")}
            onClick={() => {
              managePanelOpen.value = false;
            }}
          >
            ×
          </button>
        </header>

        {error && <p class={styles.error}>{error}</p>}

        <div class={styles.columns}>
          {/* ── Classes ─────────────────────────────────────────────── */}
          <div class={styles.classColumn}>
            <ul class={styles.classList}>
              {classes.value.map((cls) => (
                <li key={cls.id} class={styles.classRow}>
                  {renamingId === cls.id ? (
                    <input
                      class={styles.renameInput}
                      aria-label={t("manage.rename")}
                      value={renameDraft}
                      autofocus
                      onInput={(e) =>
                        setRenameDraft((e.target as HTMLInputElement).value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          run(renameClass(cls.id, renameDraft));
                          setRenamingId(null);
                        }
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => setRenamingId(null)}
                    />
                  ) : (
                    <button
                      class={styles.classSelect}
                      data-current={cls.id === current?.id || undefined}
                      onClick={() => run(switchClass(cls.id))}
                    >
                      {cls.name}
                    </button>
                  )}
                  <button
                    class={styles.rowAction}
                    aria-label={t("manage.rename")}
                    title={t("manage.rename")}
                    onClick={() => {
                      setRenamingId(cls.id);
                      setRenameDraft(cls.name);
                      setDeletingId(null);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    class={styles.rowAction}
                    aria-label={t("manage.delete")}
                    title={t("manage.delete")}
                    onClick={() => {
                      setDeletingId(cls.id);
                      setDeleteDraft("");
                      setRenamingId(null);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            {deletingClass && (
              <div class={styles.deleteConfirm}>
                <input
                  class={styles.deleteInput}
                  placeholder={tf("manage.deleteTypePlaceholder", {
                    name: deletingClass.name,
                  })}
                  value={deleteDraft}
                  autofocus
                  onInput={(e) =>
                    setDeleteDraft((e.target as HTMLInputElement).value)
                  }
                />
                <div class={styles.deleteButtons}>
                  <button
                    class={styles.deleteGo}
                    disabled={deleteDraft.trim() !== deletingClass.name}
                    onClick={() => {
                      run(deleteClass(deletingClass.id));
                      setDeletingId(null);
                    }}
                  >
                    {t("manage.deleteConfirm")}
                  </button>
                  <button
                    class={styles.deleteCancel}
                    onClick={() => setDeletingId(null)}
                  >
                    {t("manage.cancel")}
                  </button>
                </div>
              </div>
            )}

            <form
              class={styles.newClass}
              onSubmit={(e) => {
                e.preventDefault();
                const name = newName.trim();
                if (!name) return;
                run(createClass(name));
                setNewName("");
              }}
            >
              <input
                class={styles.newClassInput}
                placeholder={t("manage.newClassPlaceholder")}
                value={newName}
                onInput={(e) =>
                  setNewName((e.target as HTMLInputElement).value)
                }
              />
              <button class={styles.newClassAdd} type="submit">
                {t("manage.add")}
              </button>
            </form>
          </div>

          {/* ── Names for the active class ──────────────────────────── */}
          <div class={styles.namesColumn}>
            <h3 class={styles.namesTitle}>
              {tf("manage.namesFor", { name: current?.name ?? "…" })}
            </h3>
            <textarea
              class={styles.namesArea}
              value={namesDraft}
              placeholder={t("manage.pasteHint")}
              onInput={(e) => {
                setNamesDraft((e.target as HTMLTextAreaElement).value);
                setSavedReceipt(false);
              }}
            />
            <div class={styles.namesFooter}>
              <span class={styles.nameCount}>
                {tn("manage.nameCount", parsedCount)}
              </span>
              {savedReceipt && (
                <span class={styles.receipt}>{t("manage.savedReceipt")}</span>
              )}
              <button
                class={styles.saveNames}
                onClick={() =>
                  run(
                    saveMembers(parseNameList(namesDraft)).then(() => {
                      setNamesDraft(
                        namesToText(members.peek().map((m) => m.name)),
                      );
                      setSavedReceipt(true);
                    }),
                  )
                }
              >
                {t("manage.saveNames")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
