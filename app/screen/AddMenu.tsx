// The add menu: one gold trigger, a popover grid of every widget kind with
// icon + visible label — every kind fits where eight flat pills used to
// wrap the toolbar onto two rows. (A COUNT here would drift with the
// registry; «every kind» cannot.)

import { t, tDyn } from "../i18n";
import { addMenuOpen } from "../state/chrome";
import { addWidget } from "../state/layout";
import { Icon } from "../ui/Icon";
import { WIDGET_KINDS, WIDGET_REGISTRY } from "../widgets/registry";
import styles from "./AddMenu.module.css";

export function AddMenu() {
  const open = addMenuOpen.value;
  const label = t("chrome.addWidget");

  return (
    <div class={styles.wrap}>
      <button
        class={styles.trigger}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => {
          addMenuOpen.value = !open;
        }}
      >
        <Icon name="plus" size="sm" />
        {t("chrome.add")}
      </button>
      {open && (
        <>
          {/* THE DISMISS LAYER IS NOT A TAB STOP — the house rule, and this is
              where the reasoning lives (the other four backdrops point here).
              It is a real `<button>` so a pointer, a screen reader and an AT
              click all have a way out, but it fills the VIEWPORT: its focus
              ring is drawn 2 px outside the window and is therefore never on
              screen. Standing before the menu in document order, it was the
              FIRST thing Tab found after the menu opened — an invisible stop
              whose Enter closed the menu the teacher had just opened. The
              keyboard's way out is Escape, which the chain in
              `screen/keyboard.ts` guarantees one layer per press, and with
              this attribute the first Tab lands on the first real choice. */}
          <button
            class={styles.backdrop}
            tabIndex={-1}
            aria-label={t("manage.close")}
            onClick={() => {
              addMenuOpen.value = false;
            }}
          />
          <div class={styles.menu} role="menu">
            {WIDGET_KINDS.map((kind) => (
              <button
                key={kind}
                role="menuitem"
                class={styles.item}
                onClick={() => {
                  addMenuOpen.value = false;
                  addWidget(kind);
                }}
              >
                <Icon
                  name={WIDGET_REGISTRY[kind].icon}
                  size="md"
                  class={styles.itemIcon}
                />
                {tDyn("widget.label", kind)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
