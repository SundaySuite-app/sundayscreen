// The two-click class switch: click the class name → the list opens → click
// a class. Below the divider: «Hvem er her i dag?» (today's absences) and
// "Administrer klasser …" (the manage panel).
//
// The attendance panel is a dialog in the SHELL, beside ManagePanel and
// PlannerPanel. This file only opens it.

import { openAttendanceFromMenu } from "../manage/AttendancePanel";
import { t } from "../i18n";
import { classes, classMenuOpen, managePanelOpen } from "../state/classes";
import { activeClass } from "../state/layout";
import { switchClassKeepingScreen } from "../state/scenes";
import { Icon } from "../ui/Icon";
import { toast } from "../ui/toast";
import styles from "./ClassSwitcher.module.css";

export function ClassSwitcher() {
  const open = classMenuOpen.value;
  const current = activeClass.value;

  return (
    <div class={styles.wrap}>
      <button
        class={styles.trigger}
        aria-label={t("manage.switchClass")}
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
          <button
            class={styles.backdrop}
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
              onClick={openAttendanceFromMenu}
            >
              {t("attendance.title")}
            </button>
            <button
              role="menuitem"
              class={styles.manage}
              onClick={() => {
                classMenuOpen.value = false;
                managePanelOpen.value = true;
              }}
            >
              {t("manage.open")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
