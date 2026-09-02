//! The planner's model and its ONE resolution rule — pure and headless.
//!
//! Time is deliberately primitive: periods are MINUTES SINCE LOCAL MIDNIGHT
//! (the school bell does not care about time zones), dates are opaque
//! `YYYY-MM-DD` strings minted by the FRONTEND (JS owns the local wall
//! clock; this crate never reads a clock — the house rule). Weekdays are
//! ISO (1 = Monday), but the valid RANGE depends on which side reads it: the
//! WRITE side ([`WeekSlot::weekday`], the recurring Mon–Fri timetable) is
//! 1..=5 (`commands::planner::valid_lesson_weekday`); the READ side (this
//! module's `weekday` parameter/[`DayPlan::weekday`]) accepts 1..=7, because
//! a real calendar date can fall on a Saturday or Sunday and still carry a
//! `DateOverride`, an `AgendaItem`, or a `DayNote` that a caller wants
//! resolved. Treating both sides as 1..=5 was the false premise behind
//! Runde 2's "planner is dead on weekends" bug: `day_get` used to be guarded
//! by the WRITE side's validator, so a real Saturday date never made it this
//! far (see `commands::planner::valid_any_weekday`, which now guards reads
//! instead). There is no chrono dependency on purpose.
//!
//! The shadowing rule, spelled once in [`resolve_day`]: a `date_override`
//! row shadows the weekly slot for that (date, period) — `Cancelled` means
//! "no lesson at all"; otherwise the weekly timetable answers; otherwise the
//! period is free. Agenda items hang off the DATE-INSTANCE (date, period) —
//! next Tuesday's plan is not this Tuesday's — and work identically whether
//! the effective lesson came from the weekly plan or an override.
//!
//! ## Double lessons (Runde 6)
//!
//! A double lesson does NOT change the shape of a day: the bijection
//! entries↔periods is kept, one entry per period. It is a FLAG, resolved in
//! a second pass that runs AFTER the shadowing rule, and it produces exactly
//! two derived booleans per entry: [`DayEntry::merged_with_next`] on the
//! head, [`DayEntry::continuation`] on the tail. The block a view draws is
//! `head.period.start_min .. tail.period.end_min`; the entries in between
//! (a break inside a double lesson is still a break) are untouched.
//!
//! Three rules carry it, and they are all here rather than in any consumer:
//!
//! 1. The effective flag for a period is the override row's `Some(x)` if it
//!    has one, otherwise the weekly slot's boolean. `None` on the override
//!    row means "inherit the week", which is why the column is nullable.
//! 2. An override ROW on the FOLLOWING lesson period breaks the merge for
//!    that date — lesson or cancelled, it does not matter: the teacher has
//!    said something specific about that period, and a merge would overwrite
//!    what she said.
//! 3. …unless that row is a FLAG CARRIER: `kind = Lesson`, no class, no
//!    scene, empty subject and title, and a `merged_with_next` that is set.
//!    Such a row carries a flag and NOTHING else — the content still resolves
//!    from the weekly slot (`overridden = false`), so «slå sammen i dag» can
//!    be written without copying the week's content into the date and forking
//!    the plan in silence.
//!
//! A flag on the last lesson period of the day has nowhere to go and is
//! ignored — silently, because a template edit that shortens the day must not
//! turn into an error the teacher cannot act on.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Minutes in a day — the exclusive upper bound for period times.
pub const DAY_MIN: u32 = 24 * 60;

/// Longest label/subject/title we persist.
pub const LABEL_MAX_CHARS: usize = 80;
/// Longest agenda-item text / day-note body.
pub const TEXT_MAX_CHARS: usize = 500;
/// Most agenda items one lesson will hold.
pub const AGENDA_MAX_ITEMS: usize = 30;
/// Shortest and longest duration one agenda line may carry, in minutes.
///
/// The ONE source for both agendas: the planner-backed one clamped by
/// [`normalize_agenda`] below, and the widget-config one clamped by
/// `layout::WidgetConfig::clamp`. The item CAPS are deliberately separate
/// per side (`AGENDA_MAX_ITEMS` vs `MANUAL_AGENDA_MAX_ITEMS` — different
/// storage, free to drift); the minute vocabulary a teacher types into a line
/// is not.
pub const AGENDA_DURATION_MIN: u32 = 1;
pub const AGENDA_DURATION_MAX: u32 = 600;
/// Most notes one day will hold.
pub const NOTES_MAX: usize = 20;

/// A slot in the school day's template (defined once, applies Mon–Fri).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "Period.ts")]
#[serde(rename_all = "camelCase")]
pub struct Period {
    pub id: String,
    pub label: String,
    #[ts(type = "number")]
    pub start_min: u32,
    #[ts(type = "number")]
    pub end_min: u32,
    pub kind: PeriodKind,
    #[ts(type = "number")]
    pub sort_index: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "PeriodKind.ts")]
#[serde(rename_all = "lowercase")]
pub enum PeriodKind {
    #[default]
    Lesson,
    Break,
}

/// One cell of the recurring weekly timetable: weekday × lesson-period.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "WeekSlot.ts")]
#[serde(rename_all = "camelCase")]
pub struct WeekSlot {
    pub id: String,
    /// ISO weekday, 1 (Monday) ..= 5 (Friday).
    pub weekday: u8,
    pub period_id: String,
    pub class_id: Option<String>,
    pub subject: String,
    /// `None` → the class's default scene at switch time.
    pub scene_id: Option<String>,
    /// Does this lesson run on into the next lesson period, every week?
    ///
    /// `#[serde(default)]` so a setup file (or a row) written before
    /// migration 0007 reads as an ordinary single lesson rather than failing.
    #[serde(default)]
    pub merged_with_next: bool,
}

/// A per-date shadow of one (date, period) cell.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "DateOverride.ts")]
#[serde(rename_all = "camelCase")]
pub struct DateOverride {
    pub id: String,
    /// Local wall date, `YYYY-MM-DD`, minted by the frontend.
    pub date: String,
    pub period_id: String,
    pub kind: OverrideKind,
    pub class_id: Option<String>,
    pub subject: String,
    pub scene_id: Option<String>,
    /// «Prøve», «Tur til Bymarka» — shown alongside/instead of the subject.
    pub title: String,
    /// The TRI-STATE the nullable column exists for: `None` inherits the
    /// weekly slot's flag, `Some(true)` merges on this date alone,
    /// `Some(false)` splits on this date alone.
    ///
    /// A row that carries this and nothing else is a FLAG CARRIER (see the
    /// module header): its content resolves from the week, so a per-date
    /// merge never forks the weekly plan.
    #[serde(default)]
    pub merged_with_next: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "OverrideKind.ts")]
#[serde(rename_all = "lowercase")]
pub enum OverrideKind {
    /// Replace the weekly lesson for this date.
    #[default]
    Lesson,
    /// No lesson at all this date (the class is on a trip, the period is
    /// free…).
    Cancelled,
}

/// One planned activity inside one lesson-instance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "AgendaItem.ts")]
#[serde(rename_all = "camelCase")]
pub struct AgendaItem {
    pub id: String,
    pub date: String,
    pub period_id: String,
    pub text: String,
    /// `None` = untimed; timed items derive start offsets by prefix sum.
    #[ts(type = "number | null")]
    pub duration_min: Option<u32>,
    pub done: bool,
    #[ts(type = "number")]
    pub sort_index: i64,
}

/// A day-level message («Husk gymtøy i morgen») shown by «Dagen i dag».
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "DayNote.ts")]
#[serde(rename_all = "camelCase")]
pub struct DayNote {
    pub id: String,
    pub date: String,
    pub body: String,
    #[ts(type = "number")]
    pub sort_index: i64,
}

/// The effective lesson in one period of one date, names joined in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "LessonInfo.ts")]
#[serde(rename_all = "camelCase")]
pub struct LessonInfo {
    pub class_id: Option<String>,
    pub class_name: Option<String>,
    pub subject: String,
    pub scene_id: Option<String>,
    pub scene_name: Option<String>,
    pub title: String,
    /// Did a date override produce this (or cancel it)?
    pub overridden: bool,
}

/// One period of the resolved day.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "DayEntry.ts")]
#[serde(rename_all = "camelCase")]
pub struct DayEntry {
    pub period: Period,
    /// `None`: a break, a free period, or a cancelled lesson.
    pub lesson: Option<LessonInfo>,
    pub agenda: Vec<AgendaItem>,
    /// RESOLVED, not stored: this entry is the HEAD of a double lesson that
    /// runs on into the next lesson period. A stored flag with nowhere to go
    /// (the day's last lesson period) never reaches this field.
    ///
    /// `#[ts(optional = nullable)]` on both this and [`Self::continuation`]:
    /// the field is `#[serde(default)]`, i.e. its absence is a legal way to
    /// say `false`, and saying so in the TypeScript type is what lets a
    /// frontend written before double lessons existed keep compiling —
    /// exactly the tolerance ADR-007 gives a widget config, applied to a
    /// generated type.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub merged_with_next: bool,
    /// RESOLVED: this entry is the TAIL of a double lesson — its `lesson` was
    /// copied from the head, and a view that lists lessons should fold it
    /// into the head rather than draw it twice.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub continuation: bool,
}

/// Everything the widgets and the banner need about one date.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "DayPlan.ts")]
#[serde(rename_all = "camelCase")]
pub struct DayPlan {
    pub date: String,
    pub weekday: u8,
    pub entries: Vec<DayEntry>,
    pub notes: Vec<DayNote>,
}

/// Name lookups for the join — plain maps, so resolution stays pure.
#[derive(Debug, Default)]
pub struct NameLookup {
    pub class_names: HashMap<String, String>,
    pub scene_names: HashMap<String, String>,
}

/// THE shadowing rule. `periods` must be sorted (see [`normalize_periods`]);
/// `slots` are the weekday's, `overrides`/`agenda`/`notes` the date's.
/// (Eight arguments because a day genuinely has eight inputs — bundling
/// them into a struct would just move the same list one level down.)
#[allow(clippy::too_many_arguments)]
pub fn resolve_day(
    date: &str,
    weekday: u8,
    periods: &[Period],
    slots: &[WeekSlot],
    overrides: &[DateOverride],
    agenda: &[AgendaItem],
    notes: &[DayNote],
    names: &NameLookup,
) -> DayPlan {
    let mut entries: Vec<DayEntry> = periods
        .iter()
        .map(|period| {
            let lesson = if period.kind == PeriodKind::Break {
                None
            } else {
                effective_lesson(period, slots, overrides, names)
            };
            let mut items: Vec<AgendaItem> = agenda
                .iter()
                .filter(|a| a.period_id == period.id)
                .cloned()
                .collect();
            items.sort_by_key(|a| a.sort_index);
            DayEntry {
                period: period.clone(),
                lesson,
                agenda: items,
                merged_with_next: false,
                continuation: false,
            }
        })
        .collect();
    // The second pass, AFTER every entry has its effective lesson: merging is
    // a statement about two RESOLVED lessons, so it cannot be folded into the
    // map above without reading a lesson that does not exist yet.
    apply_merges(&mut entries, slots, overrides);
    let mut day_notes: Vec<DayNote> = notes.to_vec();
    day_notes.sort_by_key(|n| n.sort_index);
    DayPlan {
        date: date.to_string(),
        weekday,
        entries,
        notes: day_notes,
    }
}

/// Is this override row a pure FLAG CARRIER — a merge/split decision for one
/// date, with no content of its own?
///
/// The test is deliberately strict and NOT a trim: a row with so much as a
/// title on it is a real override, and treating it as a carrier would drop
/// what the teacher typed. «Half a carrier» is an ordinary override, which is
/// also why a carrier is written by CLEARING the fields rather than by a
/// separate `kind` — one row shape, one UNIQUE key, no second table.
fn is_flag_carrier(o: &DateOverride) -> bool {
    o.kind == OverrideKind::Lesson
        && o.merged_with_next.is_some()
        && o.class_id.is_none()
        && o.scene_id.is_none()
        && o.subject.is_empty()
        && o.title.is_empty()
}

/// The override row that SHADOWS this period — a flag carrier is not one.
fn shadowing_override<'a>(
    period_id: &str,
    overrides: &'a [DateOverride],
) -> Option<&'a DateOverride> {
    overrides
        .iter()
        .find(|o| o.period_id == period_id && !is_flag_carrier(o))
}

/// Rule 1: the override row's `Some(x)` wins, otherwise the weekly slot's
/// boolean, otherwise `false`. Read from the row REGARDLESS of whether it is
/// a carrier — carrying the flag is the one thing both kinds of row do.
fn effective_merge_flag(period_id: &str, slots: &[WeekSlot], overrides: &[DateOverride]) -> bool {
    if let Some(x) = overrides
        .iter()
        .find(|o| o.period_id == period_id)
        .and_then(|o| o.merged_with_next)
    {
        return x;
    }
    slots
        .iter()
        .find(|s| s.period_id == period_id)
        .is_some_and(|s| s.merged_with_next)
}

/// The merge pass (see the module header). Walks the day's LESSON periods in
/// order — breaks in between are skipped and survive as their own entries —
/// and joins each flagged head to the next lesson period.
///
/// Chains fall out of the forward walk: once B has been given A's lesson it
/// is itself a head, and B's own flag decides whether the block reaches C.
fn apply_merges(entries: &mut [DayEntry], slots: &[WeekSlot], overrides: &[DateOverride]) {
    let lessons: Vec<usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| e.period.kind == PeriodKind::Lesson)
        .map(|(i, _)| i)
        .collect();
    for pair in lessons.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        // A cancelled or free A has nothing to run on: a flag left on it is
        // dangling, and dangling flags are ignored in silence.
        if entries[a].lesson.is_none() {
            continue;
        }
        if !effective_merge_flag(&entries[a].period.id, slots, overrides) {
            continue;
        }
        // Rule 2: the teacher said something specific about B today.
        if shadowing_override(&entries[b].period.id, overrides).is_some() {
            continue;
        }
        entries[b].lesson = entries[a].lesson.clone();
        entries[b].continuation = true;
        entries[a].merged_with_next = true;
    }
}

fn effective_lesson(
    period: &Period,
    slots: &[WeekSlot],
    overrides: &[DateOverride],
    names: &NameLookup,
) -> Option<LessonInfo> {
    // A flag carrier is skipped here on purpose (rule 3): it shadows nothing,
    // so the weekly slot answers and `overridden` stays false.
    if let Some(ovr) = shadowing_override(&period.id, overrides) {
        if ovr.kind == OverrideKind::Cancelled {
            return None;
        }
        return Some(LessonInfo {
            class_id: ovr.class_id.clone(),
            class_name: lookup(&names.class_names, &ovr.class_id),
            subject: ovr.subject.clone(),
            scene_id: ovr.scene_id.clone(),
            scene_name: lookup(&names.scene_names, &ovr.scene_id),
            title: ovr.title.clone(),
            overridden: true,
        });
    }
    let slot = slots.iter().find(|s| s.period_id == period.id)?;
    if slot.class_id.is_none() && slot.subject.is_empty() {
        return None;
    }
    Some(LessonInfo {
        class_id: slot.class_id.clone(),
        class_name: lookup(&names.class_names, &slot.class_id),
        subject: slot.subject.clone(),
        scene_id: slot.scene_id.clone(),
        scene_name: lookup(&names.scene_names, &slot.scene_id),
        title: String::new(),
        overridden: false,
    })
}

fn lookup(map: &HashMap<String, String>, id: &Option<String>) -> Option<String> {
    id.as_ref().and_then(|i| map.get(i).cloned())
}

/// Is this a real local wall date, `YYYY-MM-DD`?
///
/// Date keys are minted by the FRONTEND (JS owns the wall clock; this crate
/// never reads one) — so Rust validates the SHAPE and the CALENDAR, and
/// nothing else. Shape alone once let `2026-99-99` into the keyspace
/// (F-funn B8), where its rows were unreachable from any real calendar day.
///
/// Every caller that takes a date from the frontend runs this: the planner's
/// day/agenda/override writes, and the picker's "who is here today".
pub fn is_valid_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    let shaped = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && date
            .chars()
            .enumerate()
            .all(|(i, c)| (i == 4 || i == 7) || c.is_ascii_digit());
    if !shaped {
        return false;
    }
    let year: i32 = date[0..4].parse().unwrap_or(0);
    let month: u32 = date[5..7].parse().unwrap_or(0);
    let day: u32 = date[8..10].parse().unwrap_or(0);
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    day != 0 && day <= days_in_month
}

/// Clamp and order a period template: labels truncated, times clamped into
/// the day, `end > start` enforced (a broken row is DROPPED — the editor
/// validates before saving; this is the belt for hand-edited data), sorted
/// by start time, sort_index re-stamped densely.
pub fn normalize_periods(mut periods: Vec<Period>) -> Vec<Period> {
    for p in &mut periods {
        p.label = truncate(&p.label, LABEL_MAX_CHARS);
        p.start_min = p.start_min.min(DAY_MIN - 1);
        p.end_min = p.end_min.min(DAY_MIN);
    }
    periods.retain(|p| p.end_min > p.start_min);
    periods.sort_by_key(|p| (p.start_min, p.end_min));
    for (i, p) in periods.iter_mut().enumerate() {
        p.sort_index = i as i64;
    }
    periods
}

/// Do any two periods overlap? (The editor refuses to save such a template;
/// the resolver tolerates it — lessons just both render.)
pub fn periods_overlap(periods: &[Period]) -> bool {
    let mut sorted: Vec<&Period> = periods.iter().collect();
    sorted.sort_by_key(|p| p.start_min);
    sorted.windows(2).any(|w| w[1].start_min < w[0].end_min)
}

/// Clamp one agenda list: texts truncated, durations clamped into
/// [`AGENDA_DURATION_MIN`]..=[`AGENDA_DURATION_MAX`], at most
/// [`AGENDA_MAX_ITEMS`], sort_index re-stamped densely.
pub fn normalize_agenda(mut items: Vec<AgendaItem>) -> Vec<AgendaItem> {
    items.truncate(AGENDA_MAX_ITEMS);
    for (i, a) in items.iter_mut().enumerate() {
        a.text = truncate(&a.text, TEXT_MAX_CHARS);
        a.duration_min = a
            .duration_min
            .map(|d| d.clamp(AGENDA_DURATION_MIN, AGENDA_DURATION_MAX));
        a.sort_index = i as i64;
    }
    items
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() > max {
        s.chars().take(max).collect()
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn period(id: &str, start: u32, end: u32, kind: PeriodKind) -> Period {
        Period {
            id: id.into(),
            label: id.into(),
            start_min: start,
            end_min: end,
            kind,
            sort_index: 0,
        }
    }

    fn slot(period_id: &str, class_id: Option<&str>, subject: &str) -> WeekSlot {
        WeekSlot {
            id: format!("s-{period_id}"),
            weekday: 1,
            period_id: period_id.into(),
            class_id: class_id.map(String::from),
            subject: subject.into(),
            scene_id: None,
            merged_with_next: false,
        }
    }

    /// The same weekly cell, flagged as running on into the next lesson.
    fn merged_slot(period_id: &str, class_id: Option<&str>, subject: &str) -> WeekSlot {
        WeekSlot {
            merged_with_next: true,
            ..slot(period_id, class_id, subject)
        }
    }

    /// A full override row — content AND (optionally) a merge decision.
    fn ovr(period_id: &str, kind: OverrideKind, subject: &str, title: &str) -> DateOverride {
        DateOverride {
            id: format!("o-{period_id}"),
            date: DATE.into(),
            period_id: period_id.into(),
            kind,
            class_id: None,
            subject: subject.into(),
            scene_id: None,
            title: title.into(),
            merged_with_next: None,
        }
    }

    /// A CONTENT-FREE override row: the flag and nothing else.
    fn carrier(period_id: &str, merged: bool) -> DateOverride {
        DateOverride {
            merged_with_next: Some(merged),
            ..ovr(period_id, OverrideKind::Lesson, "", "")
        }
    }

    const DATE: &str = "2026-08-31";

    fn names() -> NameLookup {
        NameLookup {
            class_names: HashMap::from([("c1".to_string(), "7B".to_string())]),
            scene_names: HashMap::from([("sc1".to_string(), "Prøve".to_string())]),
        }
    }

    #[test]
    fn weekly_slot_answers_when_no_override_exists() {
        let periods = [period("p1", 510, 555, PeriodKind::Lesson)];
        let slots = [slot("p1", Some("c1"), "Norsk")];
        let day = resolve_day("2026-08-31", 1, &periods, &slots, &[], &[], &[], &names());
        let lesson = day.entries[0].lesson.as_ref().expect("lesson");
        assert_eq!(lesson.class_name.as_deref(), Some("7B"));
        assert_eq!(lesson.subject, "Norsk");
        assert!(!lesson.overridden);
    }

    #[test]
    fn an_override_shadows_the_slot_and_cancelled_means_free() {
        let periods = [
            period("p1", 510, 555, PeriodKind::Lesson),
            period("p2", 565, 610, PeriodKind::Lesson),
        ];
        let slots = [
            slot("p1", Some("c1"), "Norsk"),
            slot("p2", Some("c1"), "KRLE"),
        ];
        let overrides = [
            DateOverride {
                id: "o1".into(),
                date: "2026-08-31".into(),
                period_id: "p1".into(),
                kind: OverrideKind::Lesson,
                class_id: Some("c1".into()),
                subject: "Matte".into(),
                scene_id: Some("sc1".into()),
                title: "Prøve".into(),
                merged_with_next: None,
            },
            DateOverride {
                id: "o2".into(),
                date: "2026-08-31".into(),
                period_id: "p2".into(),
                kind: OverrideKind::Cancelled,
                class_id: None,
                subject: String::new(),
                scene_id: None,
                title: String::new(),
                merged_with_next: None,
            },
        ];
        let day = resolve_day(
            "2026-08-31",
            1,
            &periods,
            &slots,
            &overrides,
            &[],
            &[],
            &names(),
        );
        let l1 = day.entries[0].lesson.as_ref().expect("shadowed");
        assert_eq!(l1.subject, "Matte");
        assert_eq!(l1.scene_name.as_deref(), Some("Prøve"));
        assert!(l1.overridden);
        assert!(day.entries[1].lesson.is_none(), "cancelled = free");
    }

    #[test]
    fn breaks_and_empty_slots_have_no_lesson_and_agenda_is_sorted() {
        let periods = [
            period("p1", 510, 555, PeriodKind::Lesson),
            period("b1", 555, 565, PeriodKind::Break),
        ];
        let slots = [slot("b1", Some("c1"), "smitter ikke over på pause")];
        let agenda = [
            AgendaItem {
                id: "a2".into(),
                date: "d".into(),
                period_id: "p1".into(),
                text: "Oppgaver".into(),
                duration_min: Some(20),
                done: false,
                sort_index: 1,
            },
            AgendaItem {
                id: "a1".into(),
                date: "d".into(),
                period_id: "p1".into(),
                text: "Gjennomgang".into(),
                duration_min: Some(10),
                done: true,
                sort_index: 0,
            },
        ];
        let day = resolve_day("d", 1, &periods, &slots, &[], &agenda, &[], &names());
        assert!(day.entries[0].lesson.is_none(), "no slot for p1");
        assert!(day.entries[1].lesson.is_none(), "breaks never hold lessons");
        assert_eq!(day.entries[0].agenda[0].id, "a1", "sorted by sort_index");
    }

    #[test]
    fn normalize_periods_drops_broken_rows_sorts_and_restamps() {
        let ps = vec![
            period("late", 600, 645, PeriodKind::Lesson),
            period("broken", 500, 400, PeriodKind::Lesson),
            period("early", 510, 555, PeriodKind::Lesson),
        ];
        let out = normalize_periods(ps);
        assert_eq!(
            out.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
            vec!["early", "late"]
        );
        assert_eq!(out[0].sort_index, 0);
        assert_eq!(out[1].sort_index, 1);
    }

    #[test]
    fn overlap_detection() {
        let a = period("a", 510, 555, PeriodKind::Lesson);
        let b = period("b", 550, 600, PeriodKind::Lesson);
        let c = period("c", 555, 600, PeriodKind::Lesson);
        assert!(periods_overlap(&[a.clone(), b]));
        assert!(!periods_overlap(&[a, c]));
    }

    #[test]
    fn is_valid_date_accepts_real_days_and_nothing_else() {
        assert!(is_valid_date("2026-08-31"));
        assert!(is_valid_date("2028-02-29"), "a leap day IS a real day");
        assert!(is_valid_date("2026-01-01"));

        // Shape.
        for bad in ["", "31-08-2026", "2026-8-31", "2026-08-31 ", "2026/08/31"] {
            assert!(!is_valid_date(bad), "{bad} must be refused");
        }
        // Calendar (F-funn B8 — shape alone let these through).
        for bad in [
            "2026-99-99",
            "2026-13-01",
            "2026-00-10",
            "2026-02-30",
            "2026-04-31",
            "2026-08-00",
            "2027-02-29",
        ] {
            assert!(!is_valid_date(bad), "{bad} must be refused");
        }
    }

    #[test]
    fn is_valid_date_does_not_panic_on_multibyte_input() {
        // The byte slicing is only reached after the ASCII-digit check —
        // "2026-08-Ω" is exactly 10 BYTES, so it clears the length gate and
        // the char check is what has to catch it.
        assert!(!is_valid_date("2026-08-Ω"));
        assert!(!is_valid_date("ææææææææææ"));
    }

    // ── Double lessons ──────────────────────────────────────────────────────

    /// What one resolved entry must look like: the subject its lesson carries
    /// (`None` = no lesson at all), whether the content came from an override,
    /// and the two derived block flags.
    struct Expect {
        period: &'static str,
        subject: Option<&'static str>,
        overridden: bool,
        merged: bool,
        continuation: bool,
    }

    /// `p1 → "Norsk" (week) [merged]` in one line.
    fn e(period: &'static str, subject: Option<&'static str>) -> Expect {
        Expect {
            period,
            subject,
            overridden: false,
            merged: false,
            continuation: false,
        }
    }
    fn head(period: &'static str, subject: &'static str) -> Expect {
        Expect {
            merged: true,
            ..e(period, Some(subject))
        }
    }
    fn tail(period: &'static str, subject: &'static str) -> Expect {
        Expect {
            continuation: true,
            ..e(period, Some(subject))
        }
    }

    struct Case {
        name: &'static str,
        periods: Vec<Period>,
        slots: Vec<WeekSlot>,
        overrides: Vec<DateOverride>,
        expect: Vec<Expect>,
    }

    /// The ordinary school day these cases are cut from: two lessons with a
    /// break between them, then a third lesson.
    fn day_periods() -> Vec<Period> {
        vec![
            period("p1", 510, 555, PeriodKind::Lesson),
            period("p2", 565, 610, PeriodKind::Lesson),
            period("p3", 610, 655, PeriodKind::Lesson),
        ]
    }

    #[test]
    fn the_double_lesson_matrix() {
        let cases = vec![
            Case {
                name: "a WEEKLY double lesson merges, and shadows B's own week content",
                periods: day_periods()[..2].to_vec(),
                slots: vec![
                    merged_slot("p1", Some("c1"), "Norsk"),
                    slot("p2", Some("c1"), "KRLE"),
                ],
                overrides: vec![],
                expect: vec![head("p1", "Norsk"), tail("p2", "Norsk")],
            },
            Case {
                name: "a FLAG CARRIER merges for one date without overriding anything",
                periods: day_periods()[..2].to_vec(),
                slots: vec![
                    slot("p1", Some("c1"), "Norsk"),
                    slot("p2", Some("c1"), "KRLE"),
                ],
                overrides: vec![carrier("p1", true)],
                expect: vec![head("p1", "Norsk"), tail("p2", "Norsk")],
            },
            Case {
                name: "a carrier with Some(false) SPLITS a weekly double for one date",
                periods: day_periods()[..2].to_vec(),
                slots: vec![
                    merged_slot("p1", Some("c1"), "Norsk"),
                    slot("p2", Some("c1"), "KRLE"),
                ],
                overrides: vec![carrier("p1", false)],
                expect: vec![e("p1", Some("Norsk")), e("p2", Some("KRLE"))],
            },
            Case {
                name: "an override ROW on B breaks the merge — she said something about B",
                periods: day_periods()[..2].to_vec(),
                slots: vec![
                    merged_slot("p1", Some("c1"), "Norsk"),
                    slot("p2", Some("c1"), "KRLE"),
                ],
                overrides: vec![ovr("p2", OverrideKind::Lesson, "Matte", "Prøve")],
                expect: vec![
                    e("p1", Some("Norsk")),
                    Expect {
                        overridden: true,
                        ..e("p2", Some("Matte"))
                    },
                ],
            },
            Case {
                name: "…and a CANCELLED B breaks it too",
                periods: day_periods()[..2].to_vec(),
                slots: vec![
                    merged_slot("p1", Some("c1"), "Norsk"),
                    slot("p2", Some("c1"), "KRLE"),
                ],
                overrides: vec![ovr("p2", OverrideKind::Cancelled, "", "")],
                expect: vec![e("p1", Some("Norsk")), e("p2", None)],
            },
            Case {
                name: "chains: B flags onward, so the block spans A→B→C",
                periods: day_periods(),
                slots: vec![
                    merged_slot("p1", Some("c1"), "Norsk"),
                    merged_slot("p2", Some("c1"), "KRLE"),
                    slot("p3", Some("c1"), "Gym"),
                ],
                overrides: vec![],
                expect: vec![
                    head("p1", "Norsk"),
                    Expect {
                        merged: true,
                        ..tail("p2", "Norsk")
                    },
                    tail("p3", "Norsk"),
                ],
            },
            Case {
                name: "a break inside a double lesson is skipped and survives as itself",
                periods: vec![
                    period("p1", 510, 555, PeriodKind::Lesson),
                    period("b1", 555, 565, PeriodKind::Break),
                    period("p2", 565, 610, PeriodKind::Lesson),
                ],
                slots: vec![
                    merged_slot("p1", Some("c1"), "Norsk"),
                    slot("p2", Some("c1"), "KRLE"),
                ],
                overrides: vec![],
                expect: vec![head("p1", "Norsk"), e("b1", None), tail("p2", "Norsk")],
            },
            Case {
                name: "a CANCELLED A has nothing to run on — the flag is dangling",
                periods: day_periods()[..2].to_vec(),
                slots: vec![
                    merged_slot("p1", Some("c1"), "Norsk"),
                    slot("p2", Some("c1"), "KRLE"),
                ],
                overrides: vec![ovr("p1", OverrideKind::Cancelled, "", "")],
                expect: vec![e("p1", None), e("p2", Some("KRLE"))],
            },
            Case {
                name: "a flag on the day's LAST lesson period is ignored in silence",
                periods: vec![
                    period("p1", 510, 555, PeriodKind::Lesson),
                    period("b1", 555, 565, PeriodKind::Break),
                ],
                slots: vec![merged_slot("p1", Some("c1"), "Norsk")],
                overrides: vec![],
                expect: vec![e("p1", Some("Norsk")), e("b1", None)],
            },
            Case {
                // Half a carrier is a whole override: it shadows B (title and
                // all) AND breaks the merge, exactly as any other row on B.
                name: "PARTIAL content on B is not a carrier — it overrides and breaks",
                periods: day_periods()[..2].to_vec(),
                slots: vec![
                    merged_slot("p1", Some("c1"), "Norsk"),
                    slot("p2", Some("c1"), "KRLE"),
                ],
                overrides: vec![DateOverride {
                    merged_with_next: Some(true),
                    ..ovr("p2", OverrideKind::Lesson, "", "Prøve")
                }],
                expect: vec![
                    e("p1", Some("Norsk")),
                    Expect {
                        overridden: true,
                        ..e("p2", Some(""))
                    },
                ],
            },
            Case {
                // The same row on A: it REPLACES A's content (so the block's
                // head is the override, not the week), and its flag still
                // decides the merge.
                name: "PARTIAL content on A is not a carrier — it replaces A, flag and all",
                periods: day_periods()[..2].to_vec(),
                slots: vec![
                    slot("p1", Some("c1"), "Norsk"),
                    slot("p2", Some("c1"), "KRLE"),
                ],
                overrides: vec![DateOverride {
                    merged_with_next: Some(true),
                    ..ovr("p1", OverrideKind::Lesson, "", "Prøve")
                }],
                expect: vec![
                    Expect {
                        overridden: true,
                        ..head("p1", "")
                    },
                    Expect {
                        overridden: true,
                        ..tail("p2", "")
                    },
                ],
            },
        ];

        for case in cases {
            let day = resolve_day(
                DATE,
                1,
                &case.periods,
                &case.slots,
                &case.overrides,
                &[],
                &[],
                &names(),
            );
            assert_eq!(
                day.entries.len(),
                case.expect.len(),
                "{}: one entry per period, always",
                case.name
            );
            for (entry, want) in day.entries.iter().zip(&case.expect) {
                let where_ = format!("{} @ {}", case.name, want.period);
                assert_eq!(entry.period.id, want.period, "{where_}: order");
                assert_eq!(
                    entry.lesson.as_ref().map(|l| l.subject.as_str()),
                    want.subject,
                    "{where_}: subject"
                );
                assert_eq!(
                    entry.lesson.as_ref().is_some_and(|l| l.overridden),
                    want.overridden,
                    "{where_}: overridden"
                );
                assert_eq!(entry.merged_with_next, want.merged, "{where_}: merged");
                assert_eq!(
                    entry.continuation, want.continuation,
                    "{where_}: continuation"
                );
            }
        }
    }

    #[test]
    fn a_merged_tail_carries_the_heads_whole_lesson_not_just_its_subject() {
        // `B.lesson = A.lesson.clone()` is the rule; class and SCREEN travel
        // with it, or the auto-switch would land the second half of a double
        // lesson on the wrong board.
        let periods = day_periods()[..2].to_vec();
        let slots = [
            WeekSlot {
                scene_id: Some("sc1".into()),
                ..merged_slot("p1", Some("c1"), "Norsk")
            },
            slot("p2", None, ""),
        ];
        let day = resolve_day(DATE, 1, &periods, &slots, &[], &[], &[], &names());
        let tail = day.entries[1].lesson.as_ref().expect("the tail is filled");
        assert_eq!(tail.class_id.as_deref(), Some("c1"));
        assert_eq!(tail.class_name.as_deref(), Some("7B"));
        assert_eq!(tail.scene_id.as_deref(), Some("sc1"));
        assert_eq!(tail.scene_name.as_deref(), Some("Prøve"));
        assert!(day.entries[1].continuation);
    }

    #[test]
    fn a_carrier_row_never_makes_the_lesson_look_overridden() {
        // The whole reason the carrier exists: «slå sammen i dag» must not
        // fork the weekly plan. If this read `overridden = true`, the day card
        // would offer to «tilbakestill» a lesson the teacher never edited.
        let periods = day_periods()[..2].to_vec();
        let slots = [
            slot("p1", Some("c1"), "Norsk"),
            slot("p2", Some("c1"), "KRLE"),
        ];
        let day = resolve_day(
            DATE,
            1,
            &periods,
            &slots,
            &[carrier("p1", true)],
            &[],
            &[],
            &names(),
        );
        let a = day.entries[0].lesson.as_ref().expect("still the week's");
        assert!(!a.overridden, "a carrier shadows nothing");
        assert_eq!(a.subject, "Norsk");
    }

    #[test]
    fn an_older_row_without_the_column_reads_as_a_single_lesson() {
        // Promise 3 from the other side: JSON written before migration 0007
        // has no `mergedWithNext` key at all.
        let s: WeekSlot = serde_json::from_str(
            r#"{"id":"s1","weekday":1,"periodId":"p1","classId":null,
                "subject":"Norsk","sceneId":null}"#,
        )
        .expect("an absent field is not an unreadable one");
        assert!(!s.merged_with_next);
        let o: DateOverride = serde_json::from_str(
            r#"{"id":"o1","date":"2026-08-31","periodId":"p1","kind":"lesson",
                "classId":null,"subject":"","sceneId":null,"title":""}"#,
        )
        .expect("ditto");
        assert_eq!(o.merged_with_next, None, "absent means «inherit the week»");
    }

    #[test]
    fn normalize_agenda_clamps_and_restamps() {
        let items: Vec<AgendaItem> = (0..40)
            .map(|i| AgendaItem {
                id: format!("a{i}"),
                date: "d".into(),
                period_id: "p".into(),
                text: "x".repeat(600),
                duration_min: Some(9999),
                done: false,
                sort_index: 99,
            })
            .collect();
        let out = normalize_agenda(items);
        assert_eq!(out.len(), AGENDA_MAX_ITEMS);
        assert_eq!(out[0].text.chars().count(), TEXT_MAX_CHARS);
        assert_eq!(out[0].duration_min, Some(AGENDA_DURATION_MAX));
        assert_eq!(out[5].sort_index, 5);
    }
}
