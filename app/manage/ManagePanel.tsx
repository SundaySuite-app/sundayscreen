// The manage overlay: classes (create/rename/delete-with-typed-confirm) and
// the active class's name list as a PASTE-FRIENDLY textarea — teachers paste
// from Excel, one name per line. Deleting a class is real data loss, so it
// takes typing the class name; deleting a widget is a snackbar, not a
// dialog — the asymmetry is deliberate.
//
// The name list is also the one place a FAILED READ could destroy data: the
// textarea is a draft over a replace-all write, so it is seeded only from a
// list that actually arrived, and when the read failed the column says so and
// offers to read again instead of showing an empty class (R4-spor 3.1).

import { useEffect, useRef, useState } from "preact/hooks";

import type { ImportReceipt } from "../bindings/ImportReceipt";
import type { UpdateStatus } from "../bindings/UpdateStatus";
import { t, tf, tn } from "../i18n";
import { localDateStr } from "../planner/date-core";
import { appVersion, updateReady } from "../state/app-info";
import {
  classes,
  createClass,
  deleteClass,
  loadClasses,
  loadMembers,
  managePanelOpen,
  members,
  membersHydrated,
  membersHydratedFor,
  membersReadFailed,
  renameClass,
  saveMembers,
  switchClass,
} from "../state/classes";
import { activeClass, flushPending } from "../state/layout";
import { refreshPlanner, refreshToday } from "../state/planner";
import { loadScenes } from "../state/scenes";
import { settings } from "../state/settings";
import styles from "./ManagePanel.module.css";
import { Icon } from "../ui/Icon";
import { namesToText, parseNameList } from "./name-list-core";

export function ManagePanel() {
  const current = activeClass.value;
  /** Is the list on screen an actual READ of the class on screen? The whole
   *  names column hangs off this: what is rendered, and whether the save
   *  button exists at all. */
  const hydrated = membersHydrated(current?.id);
  /** …and did it fail, as opposed to not having landed yet? */
  const readFailed = !hydrated && membersReadFailed.value;

  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteDraft, setDeleteDraft] = useState("");

  // ── The names draft, and the seed rule that used to delete classes ───────
  //
  // The old effect seeded the textarea from `members.peek()` on
  // `[current?.id]` ALONE. A failed `members_get` answered `[]`, so the draft
  // was seeded empty, and one click on «Lagre navneliste» sent that emptiness
  // through a replace-all reconcile: every pupil in the class gone, from a
  // panel that had said nothing was wrong (R4-spor 3.1).
  //
  // Two rules now, and both are load-bearing:
  //   - seed ONLY from a list that was actually read for the class on screen;
  //   - seed each class at most once, and never over something the teacher
  //     has typed — names that land WHILE the panel is open still fill an
  //     untouched textarea, which is the behaviour the old effect intended.
  // The refs, not `members.value.length` in the dep list: a members change is
  // not a reason to re-seed, and a dep that grows with the list would fight
  // every keystroke that adds a line.
  const [mountSeed] = useState(() => {
    const id = activeClass.peek()?.id ?? null;
    return id !== null && membersHydratedFor.peek() === id
      ? { id, text: namesToText(members.peek().map((m) => m.name)) }
      : null;
  });
  const [namesDraft, setNamesDraft] = useState(mountSeed?.text ?? "");
  /** Which class the draft belongs to. */
  const draftFor = useRef<string | null>(mountSeed?.id ?? null);
  /** Has this class's draft been seeded from a read list? */
  const seeded = useRef(mountSeed !== null);
  /** Has the teacher typed since then? */
  const edited = useRef(false);

  const [savedReceipt, setSavedReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updStatus, setUpdStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  /** The transfer section's own receipt line, and its own busy flag: a native
   *  file dialog is open for as long as the teacher takes, and both buttons
   *  must be dead while it is. */
  const [transferReceipt, setTransferReceipt] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);

  useEffect(() => {
    const id = current?.id ?? null;
    if (draftFor.current !== id) {
      // Another class is on screen (a switch inside the panel) — the draft
      // that belonged to the old one must not survive into it.
      draftFor.current = id;
      seeded.current = false;
      edited.current = false;
      setNamesDraft("");
      setSavedReceipt(false);
    }
    if (id === null || !hydrated || seeded.current || edited.current) return;
    seeded.current = true;
    setNamesDraft(namesToText(members.peek().map((m) => m.name)));
    setSavedReceipt(false);
  }, [current?.id, hydrated]);

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

  /**
   * «Eksporter oppsett …» — the board on screen IS what goes in the file.
   *
   * `flushPending()` first (the B7 lesson): the layout store debounces, so a
   * widget the teacher moved two seconds ago is still only in memory. Without
   * this the file would record a screen she is not looking at.
   */
  const doExport = async () => {
    setTransferBusy(true);
    setError(null);
    setTransferReceipt(null);
    try {
      await flushPending();
      const path = await window.api.transferExport(
        t("transfer.exportDialog"),
        `${t("transfer.fileStem")}-${localDateStr(new Date())}.json`,
      );
      // `null` is the teacher closing the dialog — not a failure, and not a
      // receipt either. Silence is the honest answer.
      if (path !== null) setTransferReceipt(tf("transfer.exported", { path }));
    } catch (e) {
      console.warn("[manage] setup export failed", e);
      setError(t("manage.actionFailed"));
    } finally {
      setTransferBusy(false);
    }
  };

  /** The sentence for an import that LANDED: what came, and what the school
   *  day did — the part a teacher must not have to discover on Monday. */
  const importedText = (r: ImportReceipt): string => {
    const what = [
      tn("transfer.classCount", r.classes),
      tn("transfer.sceneCount", r.scenes),
      tn("transfer.nameCount", r.members),
    ].join(", ");
    const planner = r.plannerImported
      ? ` ${t("transfer.plannerImported")}`
      : r.plannerSkipped
        ? ` ${t("transfer.plannerSkipped")}`
        : "";
    return `${tf("transfer.imported", { what })}${planner}`;
  };

  /** …and for one that did not. Every refusal wrote NOTHING, and each has
   *  its own remedy, so they may not collapse into one message. */
  const refusedText = (r: ImportReceipt): string => {
    if (r.outcome === "notOurFile") return t("transfer.notOurFile");
    if (r.outcome === "tooLarge") return t("transfer.tooLarge");
    if (r.outcome === "tooNew") {
      return r.fileAppVersion
        ? tf("transfer.tooNew", { v: r.fileAppVersion })
        : t("transfer.tooNewUnknown");
    }
    return t("transfer.unreadable");
  };

  /**
   * «Importer oppsett …» — always ADDS. Nothing is overwritten, and the
   * settings blob (which class and screen are on the board) is not touched,
   * so importing mid-lesson changes nothing the pupils can see.
   *
   * The reloads afterwards are not optional: `classes`/`scenes` are signals
   * the backend cannot push to, so without them the new classes exist in the
   * database and in no menu.
   */
  const doImport = async () => {
    setTransferBusy(true);
    setError(null);
    setTransferReceipt(null);
    try {
      // Same sequencing discipline as every other write that reaches past
      // the board (`switchClass`, `saveCurrentAsScene`): let the debounced
      // layout write land BEFORE a long transaction opens, rather than have
      // it arrive somewhere in the middle of one.
      await flushPending();
      const receipt = await window.api.transferImport(
        t("transfer.importDialog"),
      );
      if (receipt.outcome === "cancelled") return;
      if (receipt.outcome !== "imported") {
        setError(refusedText(receipt));
        return;
      }
      await loadClasses();
      await loadScenes();
      if (receipt.plannerImported) {
        // The panel's own week AND the board's today: this machine had no
        // school day a moment ago, and now it has one.
        await refreshPlanner();
        await refreshToday();
      }
      setTransferReceipt(importedText(receipt));
    } catch (e) {
      console.warn("[manage] setup import failed", e);
      setError(t("manage.actionFailed"));
    } finally {
      setTransferBusy(false);
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
            {readFailed ? (
              /* The names could not be READ, and everything that writes them
                 is gone with the textarea: a draft that was never seeded
                 from a real list is one click away from replace-alling the
                 class empty. The way back is a button — the failure lasted
                 the rest of the lesson before, because nothing ever asked
                 again. */
              <div class={styles.namesFailed}>
                <p class={styles.error}>{t("class.membersReadFailed")}</p>
                <button
                  class={styles.retryNames}
                  onClick={() => {
                    const id = current?.id;
                    if (!id) return;
                    setError(null);
                    // `loadMembers` never rejects (main.tsx voids it), so a
                    // retry that fails again is read off the signal instead.
                    void loadMembers(id).then(() => {
                      if (membersHydratedFor.peek() !== id) {
                        setError(t("manage.actionFailed"));
                      }
                    });
                  }}
                >
                  {t("class.membersRetry")}
                </button>
              </div>
            ) : (
              <>
                <textarea
                  class={styles.namesArea}
                  value={namesDraft}
                  placeholder={t("manage.pasteHint")}
                  onInput={(e) => {
                    edited.current = true;
                    setNamesDraft((e.target as HTMLTextAreaElement).value);
                    setSavedReceipt(false);
                  }}
                />
                <div class={styles.namesFooter}>
                  <span class={styles.nameCount}>
                    {tn("manage.nameCount", parsedCount)}
                  </span>
                  {savedReceipt && (
                    <span class={styles.receipt}>
                      {t("manage.savedReceipt")}
                    </span>
                  )}
                  {/* Disabled until the names have LANDED: the draft is empty
                      until then, and saving it would be a replace-all with a
                      list nobody read. */}
                  <button
                    class={styles.saveNames}
                    disabled={!hydrated}
                    onClick={() =>
                      run(
                        saveMembers(parseNameList(namesDraft)).then(() => {
                          // The stored list IS the draft now.
                          seeded.current = true;
                          edited.current = false;
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
              </>
            )}
          </div>
        </div>

        {/* ── Move the setup ──────────────────────────────────────────────
            Between the columns and «about» on purpose: «about» is THIS
            INSTALLATION (version, channel, update), this is THESE DATA. And
            «Importer oppsett …» must not stand next to «Oppdater og start på
            nytt» — two irreversible-looking buttons, one row apart. */}
        <div class={styles.transfer}>
          <h3 class={styles.transferTitle}>{t("transfer.title")}</h3>
          <p class={styles.transferNote}>{t("transfer.note")}</p>
          <div class={styles.transferRow}>
            <button
              class={styles.transferBtn}
              disabled={transferBusy}
              onClick={() => void doExport()}
            >
              {t("transfer.export")}
            </button>
            <button
              class={styles.transferBtn}
              disabled={transferBusy}
              onClick={() => void doImport()}
            >
              {t("transfer.import")}
            </button>
            {transferReceipt && (
              <span class={styles.transferReceipt}>{transferReceipt}</span>
            )}
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
          {/* The boot check's mark, mirrored from the toolbar: when a new
              version is already known, say so here too and offer the install
              directly — without making the teacher press «Se etter
              oppdatering» to learn what the app already knows. Hidden as soon
              as a manual check has produced its own, fresher answer. */}
          {updateReady.value !== null && updStatus === null && (
            <>
              <span class={styles.updGood} title={t("update.pendingTitle")}>
                {tf("update.pending", { v: updateReady.value })}
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
