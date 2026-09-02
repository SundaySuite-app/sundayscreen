// Which lesson does «Dagens time» show? Pure over the resolved day plan and
// the clock — the CURRENT lesson when inside one, else the NEXT one today.
//
// ## Blocks (double lessons, Runde 6)
//
// The resolver (`crates/sundayscreen-core/src/schedule.rs`) keeps the
// bijection entries↔periods — one entry per period, always — and expresses a
// double lesson as two DERIVED booleans: `mergedWithNext` on the head,
// `continuation` on the tail, whose `lesson` is a clone of the head's whole
// lesson (class and scene travel with it). Both fields are `#[serde(default)]`
// in Rust and therefore optional in the binding: `undefined` is a legal way to
// say `false`, and every read below treats it as such.
//
// These four helpers are the ONE place the frontend walks that structure, so
// no view re-derives the merge rules — the matrix in
// `schedule.rs::the_double_lesson_matrix` owns the semantics, this file only
// mirrors what it produced:
//
//   * a block spans `head.period.startMin .. tail.period.endMin`;
//   * a break that falls INSIDE a block is skipped by the walk and survives as
//     its own entry (it is still a break, and it is nobody's head);
//   * chains fall out of the forward walk — a tail that flags onward is itself
//     a head for the next period;
//   * a dangling flag (a head whose next lesson period never claims to be a
//     continuation) simply produces a one-period block.

import type { DayEntry } from "../../bindings/DayEntry";
import type { DayPlan } from "../../bindings/DayPlan";

/** The clock window a whole double lesson occupies. */
export interface BlockSpan {
  /** The block HEAD's start. */
  startMin: number;
  /** The last tail's end — `head.period.endMin` for an ordinary lesson. */
  endMin: number;
}

export interface ShownLesson {
  /**
   * Always a block HEAD: a view binds to the head's `period.id` (its agenda
   * key, its suggestion key) for every minute of the block.
   */
  entry: DayEntry;
  /** Is the clock inside this BLOCK right now? (See {@link shownLesson}.) */
  current: boolean;
}

/** `undefined` means `false` — see the header. */
function isContinuation(entry: DayEntry): boolean {
  return entry.continuation === true;
}

/** `undefined` means `false` — see the header. */
function isMergedWithNext(entry: DayEntry): boolean {
  return entry.mergedWithNext === true;
}

/**
 * Where `entry` sits in the plan, found BY PERIOD ID rather than by identity:
 * a consumer may hold an entry from a previous render of the same day, and an
 * object-identity lookup would then silently answer "not in this plan" and
 * collapse the block to one period. Period ids are unique within a day (the
 * bijection guarantees it). `-1` when the entry is genuinely foreign.
 */
function indexOfEntry(plan: DayPlan, entry: DayEntry): number {
  return plan.entries.findIndex((e) => e.period.id === entry.period.id);
}

/**
 * The entry that OWNS the block `entry` belongs to: `entry` itself unless it
 * is a continuation, otherwise the nearest preceding lesson entry that is not
 * one. Breaks in between are stepped over; a lesson entry that does not claim
 * `mergedWithNext` ends the walk, because it cannot be anyone's head.
 *
 * A continuation nobody claims (a hand-built plan, a truncated day) is its own
 * head. That is deliberate: the alternative is to return a head that does not
 * point back, and the entry would then vanish from every block-aware view —
 * a real lesson made invisible. Visible-and-standalone is the safe degradation.
 */
export function blockHead(plan: DayPlan | null, entry: DayEntry): DayEntry {
  if (!plan || !isContinuation(entry)) return entry;
  const i = indexOfEntry(plan, entry);
  if (i < 0) return entry;
  for (let j = i - 1; j >= 0; j--) {
    const cand = plan.entries[j];
    if (cand.period.kind !== "lesson") continue; // a break inside the block
    if (cand.lesson == null || !isMergedWithNext(cand)) break; // no claim
    if (!isContinuation(cand)) return cand;
  }
  return entry;
}

/**
 * The block's last minute-boundary: the end of the final continuation that
 * hangs off `entry`'s head, or `entry`'s own end when it stands alone. Walks
 * forward from the head, stepping over breaks, and only ever crosses a joint
 * where BOTH sides agree (the head claims `mergedWithNext` and the next lesson
 * period claims `continuation`).
 */
export function blockEnd(plan: DayPlan | null, entry: DayEntry): number {
  const head = blockHead(plan, entry);
  if (!plan) return head.period.endMin;
  const i = indexOfEntry(plan, head);
  if (i < 0) return head.period.endMin;
  let cur = head;
  let end = head.period.endMin;
  for (let j = i + 1; j < plan.entries.length; j++) {
    const cand = plan.entries[j];
    if (cand.period.kind !== "lesson") continue; // a break inside the block
    if (!isMergedWithNext(cur) || !isContinuation(cand)) break;
    end = cand.period.endMin;
    cur = cand;
  }
  return end;
}

/**
 * `{ startMin, endMin }` for the whole block — what a header prints and what
 * «hvor lenge er det igjen» counts against. For an ordinary lesson it is the
 * entry's own period, so a caller never needs to know which it has.
 */
export function blockSpan(plan: DayPlan | null, entry: DayEntry): BlockSpan {
  const head = blockHead(plan, entry);
  return { startMin: head.period.startMin, endMin: blockEnd(plan, head) };
}

/**
 * Whose agenda list does this block use? The block HEAD's — owner choice: a
 * double lesson is ONE lesson with ONE plan, so the head's `date:periodId` is
 * the draft key, the write target and the list that is drawn, for every
 * minute from A's start to B's end.
 *
 * Deliberately NOT merged in: agenda rows already stored under the TAIL's own
 * key (typed before the periods were joined, or under a week where they were
 * separate lessons). Folding them into the head's list would mean writing
 * through a view — two keys' rows leaving as one — and unmerging the day later
 * could not tell them apart again. They are not hidden data either: the
 * planner panel lists every period's own rows, so the teacher still sees them
 * exactly where she typed them, and can move them herself.
 */
export function agendaEntryForBlock(
  plan: DayPlan | null,
  entry: DayEntry,
): DayEntry {
  return blockHead(plan, entry);
}

/** Is this entry the head of its own block — i.e. what a lesson LIST draws? */
function isBlockHead(plan: DayPlan, entry: DayEntry): boolean {
  return blockHead(plan, entry).period.id === entry.period.id;
}

/**
 * The lesson «Dagens time» shows, block-aware.
 *
 * Candidates are block HEADS only, so a continuation is never the answer —
 * the widget binds to the head's periodId (agenda key, suggestion key) for the
 * whole double lesson, and a list never draws the same lesson twice.
 *
 * `current` is `nowMin ∈ [head.startMin, blockEnd)`. That is the block SPAN,
 * which is the same definition the resolver used when it merged: a break
 * lying INSIDE a double lesson does not interrupt the block, so between A and
 * B the answer stays «A, current» rather than «B, next». The break still
 * exists as its own entry, and a view that draws the day's periods still draws
 * it — this is about which LESSON is running, and pedagogically it is A, the
 * whole time. Between two lessons that are NOT merged the old answer stands
 * unchanged: the next lesson, not current.
 */
export function shownLesson(
  plan: DayPlan | null,
  nowMin: number,
): ShownLesson | null {
  if (!plan) return null;
  const heads = plan.entries.filter(
    (e) =>
      e.period.kind === "lesson" && e.lesson != null && isBlockHead(plan, e),
  );
  const current = heads.find(
    (e) => nowMin >= e.period.startMin && nowMin < blockEnd(plan, e),
  );
  if (current) return { entry: current, current: true };
  const next = heads.find((e) => e.period.startMin > nowMin);
  if (next) return { entry: next, current: false };
  return null;
}
