// «Flytt oppsettet» as STATE, not as component state.
//
// An export or an import is a native file dialog plus a long transaction: it
// lasts for as long as the teacher takes to find the file, and she can close
// the manage panel while it runs. With the busy flag and the receipt in the
// panel's `useState`, closing it threw both away (E2-17): the buttons came
// back enabled over a running import, a second one could be started on top of
// the first, and the sentence saying what had landed was never read by
// anyone. Signals outlive the panel; the panel is only what renders them.
//
// The operations live here too, for the same reason: the `finally` that
// clears the busy flag must not belong to an unmounted component.

import { signal } from "@preact/signals";

import type { ImportReceipt } from "../bindings/ImportReceipt";
import { t, tf, tn } from "../i18n";
import { localDateStr } from "../planner/date-core";
import { loadClasses } from "./classes";
import { flushPending, saveError } from "./layout";
import { refreshPlanner, refreshToday } from "./planner";
import { loadScenes } from "./scenes";

/**
 * What the transfer section says, and in which voice. `null` is SILENCE — the
 * only honest answer to a dialog the teacher closed.
 *
 * Failures are carried here rather than in the panel's error band: that band
 * lives at the very top of a panel that scrolls, so a refusal landed a
 * hundred-odd pixels above the viewport and the teacher — who was looking at
 * the button she had just pressed — saw nothing at all and pressed it again
 * (F5). Success and failure now appear in the same place: next to the
 * buttons.
 */
export interface TransferMessage {
  kind: "receipt" | "error";
  text: string;
}

export const transferMessage = signal<TransferMessage | null>(null);

/** Is an export or an import running? ONE flag for both: they are two ways of
 *  opening the same native dialog, and neither may start while the other is
 *  open. */
export const transferBusy = signal(false);

/** The sentence for an import that LANDED: what came, and what the school day
 *  did — the part a teacher must not have to discover on Monday. */
function importedText(r: ImportReceipt): string {
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
  // Pictures the screens point at that this machine did not get. Said HERE,
  // in the receipt, for the same reason the skipped week plan is: the cards
  // will be empty on the board, and «Monday morning» is the wrong moment to
  // find that out.
  const images =
    r.imagesSkipped > 0
      ? ` ${tn("transfer.imagesSkipped", r.imagesSkipped)}`
      : "";
  return `${tf("transfer.imported", { what })}${planner}${images}`;
}

/** …and for one that did not. Every refusal wrote NOTHING, and each has its
 *  own remedy, so they may not collapse into one message. */
function refusedText(r: ImportReceipt): string {
  if (r.outcome === "notOurFile") return t("transfer.notOurFile");
  if (r.outcome === "tooLarge") return t("transfer.tooLarge");
  if (r.outcome === "tooNew") {
    return r.fileAppVersion
      ? tf("transfer.tooNew", { v: r.fileAppVersion })
      : t("transfer.tooNewUnknown");
  }
  return t("transfer.unreadable");
}

/**
 * «Eksporter oppsett …» — the board on screen IS what goes in the file.
 *
 * `flushPending()` first (the B7 lesson): the layout store debounces, so a
 * widget the teacher moved two seconds ago is still only in memory. Without
 * this the file would record a screen she is not looking at.
 */
export async function runExport(): Promise<void> {
  if (transferBusy.peek()) return;
  transferBusy.value = true;
  transferMessage.value = null;
  try {
    await flushPending();
    // …and the flush is allowed to FAIL. It swallows its error into
    // `saveError` instead of rejecting, so the export used to sail straight
    // past it and write a file of the board as the DATABASE has it — which is
    // exactly the board the teacher is NOT looking at (E1-L11). Refuse, and
    // name which half went wrong: «prøv igjen» is the wrong remedy for a
    // board that cannot be saved.
    if (saveError.peek()) {
      transferMessage.value = {
        kind: "error",
        text: t("transfer.boardUnsaved"),
      };
      return;
    }
    const written = await window.api.transferExport(
      t("transfer.exportDialog"),
      `${t("transfer.fileStem")}-${localDateStr(new Date())}.json`,
    );
    // `null` is the teacher closing the dialog — not a failure, and not a
    // receipt either.
    if (written !== null) {
      // Two things beyond the path, and both are hers to know while she is
      // still at the machine that has the pictures:
      //
      //  - what the file now WEIGHS in privacy terms. Since R6 the pictures
      //    ride along, so this file is not only a name list any more; saying
      //    how many are in it is what makes PRIVACY.md's «treat it like your
      //    class lists» something she can act on.
      //  - what did NOT fit. The export packs pictures up to the format's
      //    caps and writes the file anyway — a setup with most of its
      //    pictures is worth having — so the count is the honest half of
      //    that bargain.
      const images =
        written.images > 0
          ? ` ${tn("transfer.imagesExported", written.images)}`
          : "";
      const leftOut =
        written.imagesLeftOut > 0
          ? ` ${tn("transfer.imagesLeftOut", written.imagesLeftOut)}`
          : "";
      transferMessage.value = {
        kind: "receipt",
        text: `${tf("transfer.exported", { path: written.path })}${images}${leftOut}`,
      };
    }
  } catch (e) {
    console.warn("[transfer] setup export failed", e);
    transferMessage.value = { kind: "error", text: t("manage.actionFailed") };
  } finally {
    transferBusy.value = false;
  }
}

/**
 * «Importer oppsett …» — always ADDS. Nothing is overwritten, and the settings
 * blob (which class and screen are on the board) is not touched, so importing
 * mid-lesson changes nothing the pupils can see.
 *
 * The reloads afterwards are not optional: `classes`/`scenes` are signals the
 * backend cannot push to, so without them the new classes exist in the
 * database and in no menu.
 */
export async function runImport(): Promise<void> {
  if (transferBusy.peek()) return;
  transferBusy.value = true;
  transferMessage.value = null;
  try {
    // Same sequencing discipline as every other write that reaches past the
    // board (`switchClass`, `saveCurrentAsScene`): let the debounced layout
    // write land BEFORE a long transaction opens, rather than have it arrive
    // somewhere in the middle of one.
    //
    // No `saveError` refusal here, deliberately: an import ADDS rows and puts
    // nothing of the board into the file, so an unsaved board is not a reason
    // to refuse someone else's classes.
    await flushPending();
    const receipt = await window.api.transferImport(t("transfer.importDialog"));
    if (receipt.outcome === "cancelled") return;
    if (receipt.outcome !== "imported") {
      transferMessage.value = { kind: "error", text: refusedText(receipt) };
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
    transferMessage.value = { kind: "receipt", text: importedText(receipt) };
  } catch (e) {
    console.warn("[transfer] setup import failed", e);
    transferMessage.value = { kind: "error", text: t("manage.actionFailed") };
  } finally {
    transferBusy.value = false;
  }
}
