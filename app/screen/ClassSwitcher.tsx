// The two-click class switch: click the class name → the list opens → click
// a class. "Administrer klasser …" at the bottom opens the manage panel.

import { t } from "../i18n";
import {
  classes,
  classMenuOpen,
  managePanelOpen,
  switchClass,
} from "../state/classes";
import { activeClass } from "../state/layout";
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
        {current?.name ?? "…"}
        <span aria-hidden="true" class={styles.chevron}>
          ▾
        </span>
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
                  switchClass(cls.id).catch((e) => {
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
