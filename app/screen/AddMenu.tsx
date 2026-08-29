// The add menu: one gold trigger, a popover grid of every widget kind with
// icon + visible label — twelve kinds fit where eight flat pills used to
// wrap the toolbar onto two rows.

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
          <button
            class={styles.backdrop}
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
