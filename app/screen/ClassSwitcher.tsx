// The two-click class switch: click the class name → the list opens → click
// a class. Below the divider: «Hvem er her i dag?» (today's absences) and
// "Administrer klasser …" (the manage panel).
//
// The attendance panel is a dialog in the SHELL, beside ManagePanel and
// PlannerPanel. This file only opens it.

import { useRef } from "preact/hooks";

import { openAttendanceFromMenu } from "../state/attendance";
import { t, tf } from "../i18n";
import { classes, classMenuOpen, managePanelOpen } from "../state/classes";
import { activeClass } from "../state/layout";
import { switchClassKeepingScreen } from "../state/scenes";
import { Icon } from "../ui/Icon";
import { toast } from "../ui/toast";
import styles from "./ClassSwitcher.module.css";

export function ClassSwitcher() {
  const open = classMenuOpen.value;
  const current = activeClass.value;
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Open a DIALOG from this menu — and hand the keyboard back to the trigger
   * on the way (funn 2's other half).
   *
   * The menu item the teacher pressed is unmounted by the very click that
   * opens the panel, so it is not somewhere `useDialogFocus` can return focus
   * to when the panel closes. The trigger IS: it survives the whole journey,
   * it is where the eye already is, and it is the door back into the menu she
   * came from. Focusing it BEFORE the signals flip is what makes it the
   * remembered opener — the tracker records the last real focus, and the menu
   * disappears in the same commit.
   */
  const openDialog = (run: () => void) => {
    triggerRef.current?.focus();
    run();
  };

  return (
    <div class={styles.wrap}>
      <button
        ref={triggerRef}
        class={styles.trigger}
        // The accessible name CONTAINS the visible one (WCAG 2.5.3, the
        // ADR-017 pattern): the button reads «7B» on the toolbar, so a
        // voice-control user says «klikk 7B» — and a fixed «Bytt klasse»
        // would leave her no way to say the name of the most used control in
        // the app. The plain wording survives as the FALLBACK for the frame
        // before the first class has landed, where there is no name to say.
        aria-label={
          current
            ? tf("manage.switchClassNamed", { name: current.name })
            : t("manage.switchClass")
        }
        aria-expanded={open}
        onClick={() => {
          classMenuOpen.value = !open;
        }}
      >
        <Icon name="class" size="sm" class={styles.classIcon} />
        {/* Its own element so the name can be TRUNCATED — the same ceiling
         * the screen name got, for the same reason: a teacher names her
         * classes freely and the toolbar is one row on a 1024×768
         * projector. The full name is a click away in the menu below. */}
        <span class={styles.triggerLabel}>{current?.name ?? "…"}</span>
        <Icon name="chevron-down" size="sm" class={styles.chevron} />
      </button>
      {open && (
        <>
          {/* `tabIndex={-1}`: see AddMenu.tsx for the whole argument — the
              dismiss layer fills the viewport, so its focus ring is drawn off
              screen, and as the first tab stop it made Enter close the menu
              the teacher had just opened. */}
          <button
            class={styles.backdrop}
            tabIndex={-1}
            aria-label={t("manage.close")}
            onClick={() => {
              classMenuOpen.value = false;
            }}
          />
          <div class={styles.menu} role="menu">
            {classes.value.map((cls) => (
              <button
                key={cls.id}
                role="menuitem"
                class={styles.item}
                data-current={cls.id === current?.id || undefined}
                onClick={() =>
                  switchClassKeepingScreen(cls.id).catch((e) => {
                    // The panel path surfaces this via run(); the toolbar
                    // path must not fail into silence (F9-funn U#5).
                    console.warn("[switcher] class switch failed", e);
                    toast("error", t("manage.actionFailed"));
                  })
                }
              >
                {cls.name}
              </button>
            ))}
            <div class={styles.divider} />
            <button
              role="menuitem"
              class={styles.manage}
              onClick={() => openDialog(openAttendanceFromMenu)}
            >
              {t("attendance.title")}
            </button>
            <button
              role="menuitem"
              class={styles.manage}
              onClick={() =>
                openDialog(() => {
                  classMenuOpen.value = false;
                  managePanelOpen.value = true;
                })
              }
            >
              {t("manage.open")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
