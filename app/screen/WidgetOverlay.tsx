// The screen layer's popover host: the ONE place a widget's own panel gets
// drawn, because a widget cannot draw one itself.
//
// Every card is `overflow: hidden` with `container-type: size`
// (WidgetShell.module.css), and layout containment makes the card a
// CONTAINING BLOCK for `position: fixed`. So a backdrop a widget renders with
// `fixed; inset: 0` covers the card and nothing else, and a panel that sticks
// out past the card's edge is simply clipped away. Neither is a bug in any
// one widget — it is the shape of the box all twelve live in, which is why
// the way out is a slot in the registry (`WidgetDef.Overlay`) and a host up
// here, mounted as a sibling of the surface where `fixed` means the viewport
// again.
//
// Two roads not taken. `createPortal` lives in `preact/compat`, which this
// bundle deliberately does not carry. And importing the die's panel straight
// into the shell would work today and break the registry rule tomorrow —
// registry.ts stays the only coupling point (CLAUDE.md), so the slot is
// something EVERY kind inherits rather than a wire run to one folder.
//
// Nothing here — and nothing an overlay renders — may carry a `transform`,
// `filter`, `backdrop-filter`, `contain` or `container-type`. Any one of them
// makes this element a containing block again and puts the panel back inside
// the trap it exists to escape.

import { useLayoutEffect, useRef } from "preact/hooks";

import { t } from "../i18n";
import { activeWidgetOverlay, closeWidgetOverlay } from "../state/chrome";
import { designSession } from "../state/design-session";
import { POPOVER_GAP_PX, popoverPos } from "./popover-core";
import styles from "./WidgetOverlay.module.css";

export function WidgetOverlay() {
  const active = activeWidgetOverlay.value;
  // A card on the design panel's little board opens its panel through the same
  // host — and the host's layer, `--z-popover` (200), sits BELOW the planner's
  // scrim at `--z-overlay` (300). Without this the die's appearance menu would
  // open somewhere under the panel that asked for it: nothing on screen, and
  // an Escape that appears to do nothing because the top rung of the ladder is
  // held by a panel nobody can see. A data attribute rather than a second host
  // — same element, one layer up.
  const elevated = designSession.value !== null || undefined;
  const panelRef = useRef<HTMLDivElement>(null);
  const anchor = active?.anchor;

  // Measured, then placed — the panel's size is whatever its contents came
  // out to, so there is nothing to position against until it is in the DOM.
  //
  // `useLayoutEffect`, not `useEffect`: it runs after the DOM is written and
  // BEFORE the browser paints, so the pre-measurement `left: 0; top: 0` in
  // the stylesheet is never a frame the teacher sees. (No `visibility:
  // hidden` first pass — that would take the panel out of the accessibility
  // tree, and it buys nothing a layout effect has not already bought.)
  //
  // The deps are the anchor's four numbers rather than the object: the
  // crossed signal above rebuilds its result whenever ANY widget changes — a
  // drag committed, a die rolled — and re-placing the panel on each of those
  // would be work for nothing.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || !anchor) return;
    const place = () => {
      const pos = popoverPos(
        anchor,
        { w: el.offsetWidth, h: el.offsetHeight },
        { w: window.innerWidth, h: window.innerHeight },
        POPOVER_GAP_PX,
      );
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
      el.dataset.placement = pos.placement;
    };
    place();
    // A window resize is the projector being plugged in mid-lesson. The
    // anchor moves with the board, so the panel would be pointing at nothing;
    // re-placing at least keeps it on the screen. (The card underneath has
    // reflowed by then, so this is a mitigation, not a promise — the teacher's
    // next click on the backdrop closes it either way.)
    window.addEventListener("resize", place);
    // And the panel's own size can settle AFTER the first measurement — a
    // font arriving, a section an overlay fills in on its second render. The
    // host cannot know which overlay does that, so it watches instead of
    // assuming: measured once and never again is how a panel ends up half off
    // the bottom of a 768-tall screen for one widget out of twelve.
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => {
      window.removeEventListener("resize", place);
      ro.disconnect();
    };
  }, [anchor?.x, anchor?.y, anchor?.w, anchor?.h]);

  if (!active) return null;
  const { Overlay, widget } = active;

  return (
    <>
      {/* Same dismiss layer as the add menu's, and the same accessible name:
          one click anywhere puts the panel away. It is a real button so the
          keyboard and a screen reader can reach the way out too. */}
      <button
        class={styles.backdrop}
        data-elevated={elevated}
        aria-label={t("manage.close")}
        onClick={closeWidgetOverlay}
      />
      {/* No `role` and no `aria-label` here on purpose: the host owns the
          BOX (its layer, its placement, its frame), and the overlay owns what
          the box is — a menu, a group of radios, a form. A wrapper role
          chosen up here would have to be right for all twelve kinds, and
          would sit between a screen reader and the one the widget declares. */}
      <div
        class={styles.panel}
        ref={panelRef}
        data-elevated={elevated}
        data-widget-overlay={widget.id}
      >
        <Overlay
          widget={widget}
          anchor={active.anchor}
          close={closeWidgetOverlay}
        />
      </div>
    </>
  );
}
