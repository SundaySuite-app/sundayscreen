// The manage overlay: classes (create/rename/delete-with-typed-confirm) and
// the active class's name list as a PASTE-FRIENDLY textarea — teachers paste
// from Excel, one name per line. Deleting a class is real data loss, so it
// takes typing the class name; deleting a widget is a snackbar, not a
// dialog — the asymmetry is deliberate.

import { useEffect, useState } from "preact/hooks";

import type { UpdateStatus } from "../bindings/UpdateStatus";
import { t, tf, tn } from "../i18n";
import { appVersion } from "../state/app-info";
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
import { settings } from "../state/settings";
import styles from "./ManagePanel.module.css";
import { Icon } from "../ui/Icon";
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
  const [updStatus, setUpdStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

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

  const setChannel = (channel: "stable" | "beta") => {
    const prev = settings.peek();
    if (prev.updateChannel === channel) return;
    const next = { ...prev, updateChannel: channel };
    settings.value = next;
    setUpdStatus(null);
    setError(null);
    // A failed save must REVERT the highlight (F9-funn U#6) — a receipt
    // that lies is worse than the error.
    window.api.saveSettings(next).catch((e) => {
      console.warn("[manage] channel save failed", e);
      settings.value = prev;
      setError(t("manage.actionFailed"));
    });
  };

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      // A successful install restarts the app — this resolves only for the
      // honest "the feed emptied since the check" answer.
      setUpdStatus(await window.api.updateInstall());
    } catch (e) {
      console.warn("[manage] update install failed", e);
      setError(t("manage.actionFailed"));
    } finally {
      setInstalling(false);
    }
  };

  const checkUpdate = async () => {
    setChecking(true);
    setUpdStatus(null);
    setError(null);
    try {
      setUpdStatus(await window.api.updateCheck());
    } catch (e) {
      console.warn("[manage] update check failed", e);
      setError(t("manage.actionFailed"));
    } finally {
      setChecking(false);
    }
  };

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
            <Icon name="close" size="md" />
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
                    /* No `onBlur` that discards: the teacher typed a name,
                       clicked somewhere, and it vanished without a word. The
                       ways out are Enter or the tick to save, Escape to
                       cancel. Committing on blur is the other trap — the
                       tick's mousedown fires blur BEFORE click, the field
                       unmounts, and the click lands nowhere. */
                    <>
                      <input
                        class={styles.renameInput}
                        aria-label={t("manage.rename")}
                        placeholder={t("manage.renamePlaceholder")}
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
                      />
                      <button
                        class={styles.rowAction}
                        aria-label={t("manage.confirmName")}
                        title={t("manage.confirmName")}
                        onClick={() => {
                          run(renameClass(cls.id, renameDraft));
                          setRenamingId(null);
                        }}
                      >
                        <Icon name="check" size="sm" />
                      </button>
                    </>
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
                    <Icon name="pencil" size="sm" />
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
                    <Icon name="trash" size="sm" />
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

        {/* ── About / updates ─────────────────────────────────────────── */}
        <div class={styles.about}>
          <span class={styles.aboutVersion}>
            {tf("update.version", { v: appVersion.value })}
          </span>
          <span class={styles.channel}>
            <span class={styles.channelLabel}>{t("update.channelLabel")}</span>
            <button
              class={styles.channelBtn}
              data-current={
                settings.value.updateChannel === "stable" || undefined
              }
              onClick={() => setChannel("stable")}
            >
              {t("update.channelStable")}
            </button>
            <button
              class={styles.channelBtn}
              data-current={
                settings.value.updateChannel === "beta" || undefined
              }
              onClick={() => setChannel("beta")}
            >
              {t("update.channelBeta")}
            </button>
          </span>
          <button
            class={styles.checkBtn}
            disabled={checking}
            onClick={() => void checkUpdate()}
          >
            {t("update.check")}
          </button>
          {updStatus?.phase === "upToDate" && (
            <span class={styles.updGood}>{t("update.upToDate")}</span>
          )}
          {updStatus?.phase === "error" && (
            <span class={styles.updBad}>{t("update.error")}</span>
          )}
          {updStatus?.phase === "disabled" && (
            <span class={styles.updMuted}>{t("update.disabled")}</span>
          )}
          {updStatus?.phase === "available" && (
            <>
              <span class={styles.updGood}>
                {tf("update.available", { v: updStatus.version })}
              </span>
              <button
                class={styles.installBtn}
                disabled={installing}
                onClick={() => void install()}
              >
                {t("update.install")}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
