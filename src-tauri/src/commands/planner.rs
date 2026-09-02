//! Planner commands. Spec types are the frontend's INPUT shapes (ids minted
//! frontend-side like widgets, or omitted for fresh rows); the resolved
//! `DayPlan` is the one read the widgets and the banner live off.

use serde::Deserialize;
use sqlx::SqlitePool;
use sundayscreen_core::schedule::{
    self, AgendaItem, DayNote, DayPlan, NameLookup, OverrideKind, Period, PeriodKind, WeekSlot,
};
use tauri::State;
use ts_rs::TS;

// The date-key gate is SHARED with the picker's attendance date — the rule
// itself is pure (`sundayscreen_core::schedule::is_valid_date`), the
// AppError translation lives once in `commands/mod.rs`.
use crate::commands::valid_date;
use crate::db::planner as pstore;
use crate::db::store::new_id;
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// One period in a template save. `id = None` mints a fresh row; `Some`
/// keeps the id so the week/agendas hanging off it survive a re-timing.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "PeriodSpec.ts")]
#[serde(rename_all = "camelCase")]
pub struct PeriodSpec {
    pub id: Option<String>,
    pub label: String,
    #[ts(type = "number")]
    pub start_min: u32,
    #[ts(type = "number")]
    pub end_min: u32,
    pub kind: PeriodKind,
}

/// One weekly cell's content.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "SlotSpec.ts")]
#[serde(rename_all = "camelCase")]
pub struct SlotSpec {
    pub class_id: Option<String>,
    #[serde(default)]
    pub subject: String,
    pub scene_id: Option<String>,
    /// «Dobbelttime»: this lesson runs on into the next lesson period, every
    /// week. `#[serde(default)]` — an absent key is a single lesson, which is
    /// also why the TypeScript field is optional (`#[ts(optional = nullable)]`):
    /// the shape a caller may send is the shape the type describes.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub merged_with_next: bool,
}

/// One date override's content.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "OverrideSpec.ts")]
#[serde(rename_all = "camelCase")]
pub struct OverrideSpec {
    pub kind: OverrideKind,
    pub class_id: Option<String>,
    #[serde(default)]
    pub subject: String,
    pub scene_id: Option<String>,
    #[serde(default)]
    pub title: String,
    /// The tri-state: absent/`null` inherits the weekly plan, `true` merges
    /// on this date alone, `false` splits on this date alone. Written on its
    /// own — with every other field left empty — it is the resolver's FLAG
    /// CARRIER, which is how «slå sammen i dag» avoids copying the week's
    /// content into the date.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub merged_with_next: Option<bool>,
}

/// One agenda item in a per-lesson save.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "AgendaItemSpec.ts")]
#[serde(rename_all = "camelCase")]
pub struct AgendaItemSpec {
    pub id: Option<String>,
    pub text: String,
    #[ts(type = "number | null")]
    pub duration_min: Option<u32>,
    #[serde(default)]
    pub done: bool,
}

/// One day note in a per-date save.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "NoteSpec.ts")]
#[serde(rename_all = "camelCase")]
pub struct NoteSpec {
    pub id: Option<String>,
    pub body: String,
}

/// Writing to the WEEKLY timetable is Mon–Fri: the grid has no weekend
/// columns, so a slot there could never be shown.
fn valid_lesson_weekday(weekday: u8) -> AppResult<()> {
    if !(1..=5).contains(&weekday) {
        return Err(AppError::Validation("weekday must be 1..=5".into()));
    }
    Ok(())
}

/// READING a day accepts the whole week (F-funn B1): a teacher plans on
/// Sunday evening, and a Saturday simply resolves to a day with no weekly
/// slots — refusing it locked the entire planner panel every weekend.
fn valid_any_weekday(weekday: u8) -> AppResult<()> {
    if !(1..=7).contains(&weekday) {
        return Err(AppError::Validation("weekday must be 1..=7".into()));
    }
    Ok(())
}

/// A screen a PLAN points at must exist and must be a LIBRARY screen.
///
/// The same rule `lesson_switch` enforces at switch time, moved to the write
/// so the plan cannot hold a pointer the switch would later refuse — a lesson
/// that silently lands on the class default is the quiet kind of wrong. A
/// class's DEFAULT screen is refused outright rather than only when it belongs
/// to another class: a weekly cell can change class (or have none at all), so
/// "the right class's default" is not a property the row can keep.
///
/// `None` is always fine — it means «klassens egen skjerm» at switch time.
async fn valid_plan_scene(pool: &SqlitePool, scene_id: &Option<String>) -> AppResult<()> {
    let Some(id) = scene_id.as_deref() else {
        return Ok(());
    };
    match crate::db::store::get_scene(pool, id).await? {
        None => Err(AppError::Validation(format!("scene «{id}» does not exist"))),
        Some(scene) if scene.class_id.is_some() => Err(AppError::Validation(
            "a class's default screen cannot be planned for a lesson".into(),
        )),
        Some(_) => Ok(()),
    }
}

pub async fn slot_set_for(
    pool: &SqlitePool,
    weekday: u8,
    period_id: &str,
    slot: Option<&SlotSpec>,
) -> AppResult<()> {
    valid_lesson_weekday(weekday)?;
    if let Some(s) = slot {
        valid_plan_scene(pool, &s.scene_id).await?;
    }
    pstore::set_slot(
        pool,
        weekday,
        period_id,
        slot.map(|s| pstore::SlotWrite {
            class_id: &s.class_id,
            subject: s.subject.as_str(),
            scene_id: &s.scene_id,
            merged_with_next: s.merged_with_next,
        }),
    )
    .await
}

pub async fn override_set_for(
    pool: &SqlitePool,
    date: &str,
    period_id: &str,
    ovr: Option<&OverrideSpec>,
) -> AppResult<()> {
    valid_date(date)?;
    if let Some(o) = ovr {
        valid_plan_scene(pool, &o.scene_id).await?;
    }
    pstore::set_override(
        pool,
        date,
        period_id,
        ovr.map(|o| pstore::OverrideWrite {
            kind: o.kind,
            class_id: &o.class_id,
            subject: &o.subject,
            scene_id: &o.scene_id,
            title: &o.title,
            merged_with_next: o.merged_with_next,
        }),
    )
    .await
}

pub async fn periods_set_for(pool: &SqlitePool, specs: Vec<PeriodSpec>) -> AppResult<Vec<Period>> {
    let periods: Vec<Period> = specs
        .into_iter()
        .map(|s| Period {
            id: s.id.unwrap_or_else(new_id),
            label: s.label,
            start_min: s.start_min,
            end_min: s.end_min,
            kind: s.kind,
            sort_index: 0,
        })
        .collect();
    let normalized = schedule::normalize_periods(periods);
    if schedule::periods_overlap(&normalized) {
        return Err(AppError::Validation("periods overlap".into()));
    }
    pstore::replace_periods(pool, &normalized).await
}

pub async fn day_get_for(pool: &SqlitePool, date: &str, weekday: u8) -> AppResult<DayPlan> {
    valid_date(date)?;
    valid_any_weekday(weekday)?;
    let periods = pstore::list_periods(pool).await?;
    let slots = pstore::slots_for_weekday(pool, weekday).await?;
    let overrides = pstore::overrides_for_date(pool, date).await?;
    let agenda = pstore::agenda_for_date(pool, date).await?;
    let notes = pstore::notes_for_date(pool, date).await?;
    let names = NameLookup {
        class_names: pstore::class_names(pool).await?,
        scene_names: pstore::scene_names(pool).await?,
    };
    Ok(schedule::resolve_day(
        date, weekday, &periods, &slots, &overrides, &agenda, &notes, &names,
    ))
}

pub async fn agenda_set_for(
    pool: &SqlitePool,
    date: &str,
    period_id: &str,
    specs: Vec<AgendaItemSpec>,
) -> AppResult<Vec<AgendaItem>> {
    valid_date(date)?;
    let items: Vec<AgendaItem> = specs
        .into_iter()
        .enumerate()
        .map(|(i, s)| AgendaItem {
            id: s.id.unwrap_or_else(new_id),
            date: date.to_string(),
            period_id: period_id.to_string(),
            text: s.text,
            duration_min: s.duration_min,
            done: s.done,
            sort_index: i as i64,
        })
        .collect();
    let normalized = schedule::normalize_agenda(items);
    pstore::replace_agenda(pool, date, period_id, &normalized).await
}

// ── The command wrappers ────────────────────────────────────────────────────

#[tauri::command]
pub async fn planner_periods_get(db: State<'_, Db>) -> AppResult<Vec<Period>> {
    pstore::list_periods(db.pool()).await
}

#[tauri::command]
pub async fn planner_periods_set(
    db: State<'_, Db>,
    periods: Vec<PeriodSpec>,
) -> AppResult<Vec<Period>> {
    periods_set_for(db.pool(), periods).await
}

#[tauri::command]
pub async fn planner_week_get(db: State<'_, Db>) -> AppResult<Vec<WeekSlot>> {
    pstore::list_week_slots(db.pool()).await
}

#[tauri::command]
pub async fn planner_slot_set(
    db: State<'_, Db>,
    weekday: u8,
    period_id: String,
    slot: Option<SlotSpec>,
) -> AppResult<()> {
    slot_set_for(db.pool(), weekday, &period_id, slot.as_ref()).await
}

#[tauri::command]
pub async fn planner_override_set(
    db: State<'_, Db>,
    date: String,
    period_id: String,
    ovr: Option<OverrideSpec>,
) -> AppResult<()> {
    override_set_for(db.pool(), &date, &period_id, ovr.as_ref()).await
}

#[tauri::command]
pub async fn planner_day_get(db: State<'_, Db>, date: String, weekday: u8) -> AppResult<DayPlan> {
    day_get_for(db.pool(), &date, weekday).await
}

#[tauri::command]
pub async fn planner_agenda_set(
    db: State<'_, Db>,
    date: String,
    period_id: String,
    items: Vec<AgendaItemSpec>,
) -> AppResult<Vec<AgendaItem>> {
    agenda_set_for(db.pool(), &date, &period_id, items).await
}

#[tauri::command]
pub async fn planner_agenda_check(db: State<'_, Db>, item_id: String, done: bool) -> AppResult<()> {
    if !pstore::set_agenda_done(db.pool(), &item_id, done).await? {
        return Err(AppError::NotFound {
            entity: "agenda_item",
            id: item_id,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn planner_notes_set(
    db: State<'_, Db>,
    date: String,
    notes: Vec<NoteSpec>,
) -> AppResult<Vec<DayNote>> {
    valid_date(&date)?;
    let rows: Vec<DayNote> = notes
        .into_iter()
        .take(schedule::NOTES_MAX)
        .enumerate()
        .map(|(i, n)| DayNote {
            id: n.id.unwrap_or_else(new_id),
            date: date.clone(),
            body: n.body.chars().take(schedule::TEXT_MAX_CHARS).collect(),
            sort_index: i as i64,
        })
        .collect();
    pstore::replace_notes(db.pool(), &date, &rows).await
}

/// Test seam for the targeted check-off (the command wrapper needs managed
/// state; tests call this).
#[cfg(test)]
pub(crate) async fn planner_agenda_check_inner(
    pool: &SqlitePool,
    item_id: &str,
    done: bool,
) -> AppResult<()> {
    if !pstore::set_agenda_done(pool, item_id, done).await? {
        return Err(AppError::NotFound {
            entity: "agenda_item",
            id: item_id.to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::store;

    async fn temp_pool() -> (SqlitePool, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        (pool, dir)
    }

    fn spec(label: &str, start: u32, end: u32) -> PeriodSpec {
        PeriodSpec {
            id: None,
            label: label.into(),
            start_min: start,
            end_min: end,
            kind: PeriodKind::Lesson,
        }
    }

    fn slot_spec(class_id: Option<&str>, subject: &str, scene_id: Option<&str>) -> SlotSpec {
        SlotSpec {
            class_id: class_id.map(String::from),
            subject: subject.into(),
            scene_id: scene_id.map(String::from),
            merged_with_next: false,
        }
    }

    #[tokio::test]
    async fn periods_reconcile_preserves_slots_and_agenda_across_retiming() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();

        let saved = periods_set_for(&pool, vec![spec("Time 1", 510, 555)])
            .await
            .unwrap();
        let p1 = saved[0].id.clone();
        pstore::set_slot(
            &pool,
            1,
            &p1,
            Some(pstore::SlotWrite {
                class_id: &Some(class.id.clone()),
                subject: "Norsk",
                scene_id: &None,
                merged_with_next: false,
            }),
        )
        .await
        .unwrap();
        agenda_set_for(
            &pool,
            "2026-08-31",
            &p1,
            vec![AgendaItemSpec {
                id: None,
                text: "Gjennomgang".into(),
                duration_min: Some(10),
                done: false,
            }],
        )
        .await
        .unwrap();

        // Re-time the SAME period (id kept) — the slot and agenda survive.
        let retimed = periods_set_for(
            &pool,
            vec![PeriodSpec {
                id: Some(p1.clone()),
                label: "Time 1".into(),
                start_min: 500,
                end_min: 545,
                kind: PeriodKind::Lesson,
            }],
        )
        .await
        .unwrap();
        assert_eq!(retimed[0].id, p1);
        assert_eq!(retimed[0].start_min, 500);

        let day = day_get_for(&pool, "2026-08-31", 1).await.unwrap();
        assert_eq!(
            day.entries[0]
                .lesson
                .as_ref()
                .unwrap()
                .class_name
                .as_deref(),
            Some("7B")
        );
        assert_eq!(day.entries[0].agenda.len(), 1);
    }

    #[tokio::test]
    async fn dropping_a_period_cascades_its_week_and_agenda() {
        let (pool, _d) = temp_pool().await;
        let saved = periods_set_for(
            &pool,
            vec![spec("Time 1", 510, 555), spec("Time 2", 565, 610)],
        )
        .await
        .unwrap();
        let gone = saved[1].id.clone();
        pstore::set_slot(
            &pool,
            2,
            &gone,
            Some(pstore::SlotWrite {
                class_id: &None,
                subject: "KRLE",
                scene_id: &None,
                merged_with_next: false,
            }),
        )
        .await
        .unwrap();

        periods_set_for(
            &pool,
            vec![PeriodSpec {
                id: Some(saved[0].id.clone()),
                label: "Time 1".into(),
                start_min: 510,
                end_min: 555,
                kind: PeriodKind::Lesson,
            }],
        )
        .await
        .unwrap();
        assert!(pstore::list_week_slots(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn overlapping_templates_are_refused() {
        let (pool, _d) = temp_pool().await;
        let res = periods_set_for(&pool, vec![spec("A", 510, 560), spec("B", 550, 600)]).await;
        assert_eq!(res.unwrap_err().code(), "validation");
    }

    #[tokio::test]
    async fn override_shadows_and_agenda_check_is_targeted() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let saved = periods_set_for(&pool, vec![spec("Time 1", 510, 555)])
            .await
            .unwrap();
        let p1 = saved[0].id.clone();
        pstore::set_slot(
            &pool,
            1,
            &p1,
            Some(pstore::SlotWrite {
                class_id: &Some(class.id.clone()),
                subject: "Norsk",
                scene_id: &None,
                merged_with_next: false,
            }),
        )
        .await
        .unwrap();
        let ovr_class = Some(class.id.clone());
        pstore::set_override(
            &pool,
            "2026-08-31",
            &p1,
            Some(pstore::OverrideWrite {
                kind: OverrideKind::Lesson,
                class_id: &ovr_class,
                subject: "Matte",
                scene_id: &None,
                title: "Prøve",
                merged_with_next: None,
            }),
        )
        .await
        .unwrap();

        let items = agenda_set_for(
            &pool,
            "2026-08-31",
            &p1,
            vec![AgendaItemSpec {
                id: None,
                text: "Del ut prøven".into(),
                duration_min: None,
                done: false,
            }],
        )
        .await
        .unwrap();
        crate::commands::planner::planner_agenda_check_inner(&pool, &items[0].id, true)
            .await
            .unwrap();

        let day = day_get_for(&pool, "2026-08-31", 1).await.unwrap();
        let lesson = day.entries[0].lesson.as_ref().unwrap();
        assert_eq!(lesson.subject, "Matte");
        assert!(lesson.overridden);
        assert!(day.entries[0].agenda[0].done);

        // Another date is untouched by the override.
        let other = day_get_for(&pool, "2026-09-01", 1).await.unwrap();
        assert_eq!(other.entries[0].lesson.as_ref().unwrap().subject, "Norsk");
    }

    #[tokio::test]
    async fn bad_dates_and_weekdays_are_refused() {
        let (pool, _d) = temp_pool().await;
        assert_eq!(
            day_get_for(&pool, "31-08-2026", 1)
                .await
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            day_get_for(&pool, "2026-08-31", 8)
                .await
                .unwrap_err()
                .code(),
            "validation"
        );
        // Shape-only validation let impossible days into the keyspace.
        for bad in ["2026-99-99", "2026-13-01", "2026-02-30", "2026-04-31"] {
            assert_eq!(
                day_get_for(&pool, bad, 1).await.unwrap_err().code(),
                "validation",
                "{bad} must be refused"
            );
        }
        // A leap day IS a real day.
        assert!(day_get_for(&pool, "2028-02-29", 2).await.is_ok());
    }

    /// F-funn B1: reading a WEEKEND must work — a teacher plans on Sunday
    /// evening, and the panel blocks all editing when this read fails.
    #[tokio::test]
    async fn weekends_are_readable_but_hold_no_weekly_slots() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let saved = periods_set_for(&pool, vec![spec("Time 1", 510, 555)])
            .await
            .unwrap();
        let p1 = saved[0].id.clone();
        pstore::set_slot(
            &pool,
            1,
            &p1,
            Some(pstore::SlotWrite {
                class_id: &Some(class.id.clone()),
                subject: "Norsk",
                scene_id: &None,
                merged_with_next: false,
            }),
        )
        .await
        .unwrap();

        // Saturday 2026-09-05 (ISO 6): the day resolves, with no lesson.
        let sat = day_get_for(&pool, "2026-09-05", 6).await.unwrap();
        assert_eq!(sat.entries.len(), 1, "the template still applies");
        assert!(
            sat.entries[0].lesson.is_none(),
            "no weekly slot on a Saturday"
        );

        // Weekend day-notes and agendas are perfectly legal.
        agenda_set_for(
            &pool,
            "2026-09-05",
            &p1,
            vec![AgendaItemSpec {
                id: None,
                text: "Rette prøver".into(),
                duration_min: None,
                done: false,
            }],
        )
        .await
        .unwrap();
        let again = day_get_for(&pool, "2026-09-05", 6).await.unwrap();
        assert_eq!(again.entries[0].agenda.len(), 1);
    }

    /// Writing to the weekly grid stays Mon–Fri (it has no weekend column).
    #[tokio::test]
    async fn weekly_slots_refuse_weekend_columns() {
        assert_eq!(
            super::valid_lesson_weekday(6).unwrap_err().code(),
            "validation"
        );
        assert!(super::valid_lesson_weekday(5).is_ok());
    }

    // ── The screen a plan points at ─────────────────────────────────────────

    #[tokio::test]
    async fn a_plan_only_accepts_a_screen_the_switch_could_actually_show() {
        let (pool, _d) = temp_pool().await;
        let a = store::insert_class(&pool, "7B").await.unwrap();
        let b = store::insert_class(&pool, "8A").await.unwrap();
        let library = store::insert_global_scene(&pool, "Prøve").await.unwrap();
        let saved = periods_set_for(&pool, vec![spec("Time 1", 510, 555)])
            .await
            .unwrap();
        let p1 = saved[0].id.clone();

        // A library screen is the whole point.
        slot_set_for(
            &pool,
            1,
            &p1,
            Some(&slot_spec(Some(&a.id), "Norsk", Some(&library.id))),
        )
        .await
        .expect("a global screen is what the picker offers");

        // `None` = «klassens egen skjerm», resolved at switch time.
        slot_set_for(&pool, 1, &p1, Some(&slot_spec(Some(&a.id), "Norsk", None)))
            .await
            .expect("no screen is a legal, meaningful state");

        // A screen that does not exist.
        assert_eq!(
            slot_set_for(
                &pool,
                1,
                &p1,
                Some(&slot_spec(Some(&a.id), "Norsk", Some("no-such-scene")))
            )
            .await
            .unwrap_err()
            .code(),
            "validation"
        );

        // ANOTHER class's default screen — the pointer `lesson_switch` refuses
        // at switch time, refused here instead of at the projector.
        assert_eq!(
            slot_set_for(
                &pool,
                1,
                &p1,
                Some(&slot_spec(
                    Some(&a.id),
                    "Norsk",
                    Some(&store::default_scene_id(&b.id))
                ))
            )
            .await
            .unwrap_err()
            .code(),
            "validation"
        );

        // The same four answers for a date override.
        let ovr = |scene: Option<&str>| OverrideSpec {
            kind: OverrideKind::Lesson,
            class_id: Some(a.id.clone()),
            subject: "Matte".into(),
            scene_id: scene.map(String::from),
            title: "Prøve".into(),
            merged_with_next: None,
        };
        override_set_for(&pool, "2026-08-31", &p1, Some(&ovr(Some(&library.id))))
            .await
            .expect("global");
        override_set_for(&pool, "2026-08-31", &p1, Some(&ovr(None)))
            .await
            .expect("none");
        for bad in [
            "no-such-scene".to_string(),
            store::default_scene_id(&b.id),
            store::default_scene_id(&a.id),
        ] {
            assert_eq!(
                override_set_for(&pool, "2026-08-31", &p1, Some(&ovr(Some(&bad))))
                    .await
                    .unwrap_err()
                    .code(),
                "validation",
                "{bad} must be refused"
            );
        }
    }

    // ── Double lessons, through the database ────────────────────────────────

    #[tokio::test]
    async fn a_weekly_double_lesson_is_stored_and_resolved() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let saved = periods_set_for(
            &pool,
            vec![spec("Time 1", 510, 555), spec("Time 2", 565, 610)],
        )
        .await
        .unwrap();
        let (p1, p2) = (saved[0].id.clone(), saved[1].id.clone());

        slot_set_for(
            &pool,
            1,
            &p1,
            Some(&SlotSpec {
                merged_with_next: true,
                ..slot_spec(Some(&class.id), "Norsk", None)
            }),
        )
        .await
        .unwrap();
        slot_set_for(
            &pool,
            1,
            &p2,
            Some(&slot_spec(Some(&class.id), "KRLE", None)),
        )
        .await
        .unwrap();

        // The column survives the round trip…
        let week = pstore::list_week_slots(&pool).await.unwrap();
        assert!(
            week.iter()
                .find(|s| s.period_id == p1)
                .unwrap()
                .merged_with_next
        );
        assert!(
            !week
                .iter()
                .find(|s| s.period_id == p2)
                .unwrap()
                .merged_with_next
        );

        // …and the resolver turns it into a block.
        let day = day_get_for(&pool, "2026-08-31", 1).await.unwrap();
        assert!(day.entries[0].merged_with_next);
        assert!(day.entries[1].continuation);
        assert_eq!(day.entries[1].lesson.as_ref().unwrap().subject, "Norsk");
    }

    #[tokio::test]
    async fn the_override_tri_state_survives_the_column() {
        // NULL is not `false`: «ingenting skrevet» has to come back as
        // «arv fra ukeplanen», or «del opp i dag» becomes unexpressible.
        let (pool, _d) = temp_pool().await;
        let saved = periods_set_for(
            &pool,
            vec![spec("Time 1", 510, 555), spec("Time 2", 565, 610)],
        )
        .await
        .unwrap();
        let p1 = saved[0].id.clone();
        let carrier = |merged: Option<bool>| OverrideSpec {
            kind: OverrideKind::Lesson,
            class_id: None,
            subject: String::new(),
            scene_id: None,
            title: String::new(),
            merged_with_next: merged,
        };
        for want in [Some(true), Some(false), None] {
            override_set_for(&pool, "2026-08-31", &p1, Some(&carrier(want)))
                .await
                .unwrap();
            let rows = pstore::overrides_for_date(&pool, "2026-08-31")
                .await
                .unwrap();
            assert_eq!(rows[0].merged_with_next, want, "{want:?} round-trips");
        }
    }

    #[tokio::test]
    async fn a_carrier_row_merges_one_date_without_forking_the_week() {
        let (pool, _d) = temp_pool().await;
        let class = store::insert_class(&pool, "7B").await.unwrap();
        let saved = periods_set_for(
            &pool,
            vec![spec("Time 1", 510, 555), spec("Time 2", 565, 610)],
        )
        .await
        .unwrap();
        let (p1, p2) = (saved[0].id.clone(), saved[1].id.clone());
        slot_set_for(
            &pool,
            1,
            &p1,
            Some(&slot_spec(Some(&class.id), "Norsk", None)),
        )
        .await
        .unwrap();
        slot_set_for(
            &pool,
            1,
            &p2,
            Some(&slot_spec(Some(&class.id), "KRLE", None)),
        )
        .await
        .unwrap();

        override_set_for(
            &pool,
            "2026-08-31",
            &p1,
            Some(&OverrideSpec {
                kind: OverrideKind::Lesson,
                class_id: None,
                subject: String::new(),
                scene_id: None,
                title: String::new(),
                merged_with_next: Some(true),
            }),
        )
        .await
        .unwrap();

        let day = day_get_for(&pool, "2026-08-31", 1).await.unwrap();
        let head = day.entries[0].lesson.as_ref().unwrap();
        assert_eq!(head.subject, "Norsk", "content still comes from the week");
        assert!(!head.overridden, "a carrier shadows nothing");
        assert!(day.entries[0].merged_with_next);
        assert!(day.entries[1].continuation);

        // The NEXT week is untouched — the carrier is one date's word only.
        let other = day_get_for(&pool, "2026-09-07", 1).await.unwrap();
        assert!(!other.entries[0].merged_with_next);
        assert_eq!(other.entries[1].lesson.as_ref().unwrap().subject, "KRLE");
    }
}
