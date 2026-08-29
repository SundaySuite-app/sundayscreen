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

fn valid_weekday(weekday: u8) -> AppResult<()> {
    if !(1..=5).contains(&weekday) {
        return Err(AppError::Validation("weekday must be 1..=5".into()));
    }
    Ok(())
}

/// The date key is frontend-minted; keep hand-edited garbage out of the
/// keyspace (a malformed key would orphan its rows invisibly).
fn valid_date(date: &str) -> AppResult<()> {
    let bytes = date.as_bytes();
    let ok = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && date
            .chars()
            .enumerate()
            .all(|(i, c)| (i == 4 || i == 7) || c.is_ascii_digit());
    if !ok {
        return Err(AppError::Validation("date must be YYYY-MM-DD".into()));
    }
    Ok(())
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
    valid_weekday(weekday)?;
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
    valid_weekday(weekday)?;
    pstore::set_slot(
        db.pool(),
        weekday,
        &period_id,
        slot.as_ref()
            .map(|s| (&s.class_id, s.subject.as_str(), &s.scene_id)),
    )
    .await
}

#[tauri::command]
pub async fn planner_override_set(
    db: State<'_, Db>,
    date: String,
    period_id: String,
    ovr: Option<OverrideSpec>,
) -> AppResult<()> {
    valid_date(&date)?;
    pstore::set_override(
        db.pool(),
        &date,
        &period_id,
        ovr.as_ref().map(|o| pstore::OverrideWrite {
            kind: o.kind,
            class_id: &o.class_id,
            subject: &o.subject,
            scene_id: &o.scene_id,
            title: &o.title,
        }),
    )
    .await
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
            Some((&Some(class.id.clone()), "Norsk", &None)),
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
        pstore::set_slot(&pool, 2, &gone, Some((&None, "KRLE", &None)))
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
            Some((&Some(class.id.clone()), "Norsk", &None)),
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
            day_get_for(&pool, "2026-08-31", 6)
                .await
                .unwrap_err()
                .code(),
            "validation"
        );
    }
}
