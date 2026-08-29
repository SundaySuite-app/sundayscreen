//! Planner storage — thin SQL over the core's schedule types. All decisions
//! (shadowing, clamps, ordering) live in `sundayscreen_core::schedule`; this
//! layer only reads and writes rows.

use std::collections::HashMap;

use sqlx::{Row, SqlitePool};
use sundayscreen_core::schedule::{
    AgendaItem, DateOverride, DayNote, OverrideKind, Period, PeriodKind, WeekSlot,
};

use super::store::{new_id, now_ms};
use crate::error::AppResult;

fn period_kind(raw: &str) -> PeriodKind {
    match raw {
        "break" => PeriodKind::Break,
        _ => PeriodKind::Lesson,
    }
}

fn period_kind_tag(kind: PeriodKind) -> &'static str {
    match kind {
        PeriodKind::Lesson => "lesson",
        PeriodKind::Break => "break",
    }
}

fn override_kind(raw: &str) -> OverrideKind {
    match raw {
        "cancelled" => OverrideKind::Cancelled,
        _ => OverrideKind::Lesson,
    }
}

fn override_kind_tag(kind: OverrideKind) -> &'static str {
    match kind {
        OverrideKind::Lesson => "lesson",
        OverrideKind::Cancelled => "cancelled",
    }
}

// ── Periods ─────────────────────────────────────────────────────────────────

pub async fn list_periods(pool: &SqlitePool) -> AppResult<Vec<Period>> {
    let rows = sqlx::query(
        "SELECT id, label, start_min, end_min, kind, sort_index FROM period
         ORDER BY sort_index, start_min",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Period {
            id: r.get("id"),
            label: r.get("label"),
            start_min: r.get::<i64, _>("start_min") as u32,
            end_min: r.get::<i64, _>("end_min") as u32,
            kind: period_kind(&r.get::<String, _>("kind")),
            sort_index: r.get("sort_index"),
        })
        .collect())
}

/// Replace the template, PRESERVING ids that are still present — slots,
/// overrides and agendas hang off period ids, so a re-timed period keeps its
/// week. Periods absent from `periods` are deleted (their slots/agendas
/// cascade — the editor typed-confirms that).
pub async fn replace_periods(pool: &SqlitePool, periods: &[Period]) -> AppResult<Vec<Period>> {
    let mut tx = pool.begin().await?;
    let keep: Vec<String> = periods.iter().map(|p| p.id.clone()).collect();
    let existing: Vec<String> = sqlx::query("SELECT id FROM period")
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|r| r.get("id"))
        .collect();
    for gone in existing.iter().filter(|id| !keep.contains(id)) {
        sqlx::query("DELETE FROM period WHERE id = ?1")
            .bind(gone)
            .execute(&mut *tx)
            .await?;
    }
    let stamp = now_ms();
    for p in periods {
        sqlx::query(
            "INSERT INTO period (id, label, start_min, end_min, kind, sort_index, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               label = ?2, start_min = ?3, end_min = ?4, kind = ?5, sort_index = ?6",
        )
        .bind(&p.id)
        .bind(&p.label)
        .bind(p.start_min as i64)
        .bind(p.end_min as i64)
        .bind(period_kind_tag(p.kind))
        .bind(p.sort_index)
        .bind(stamp)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    list_periods(pool).await
}

// ── Weekly slots ────────────────────────────────────────────────────────────

pub async fn list_week_slots(pool: &SqlitePool) -> AppResult<Vec<WeekSlot>> {
    let rows = sqlx::query(
        "SELECT id, weekday, period_id, class_id, subject, scene_id FROM week_slot
         ORDER BY weekday, period_id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(row_to_slot).collect())
}

pub async fn slots_for_weekday(pool: &SqlitePool, weekday: u8) -> AppResult<Vec<WeekSlot>> {
    let rows = sqlx::query(
        "SELECT id, weekday, period_id, class_id, subject, scene_id FROM week_slot
         WHERE weekday = ?1",
    )
    .bind(weekday as i64)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(row_to_slot).collect())
}

fn row_to_slot(r: sqlx::sqlite::SqliteRow) -> WeekSlot {
    WeekSlot {
        id: r.get("id"),
        weekday: r.get::<i64, _>("weekday") as u8,
        period_id: r.get("period_id"),
        class_id: r.get("class_id"),
        subject: r.get("subject"),
        scene_id: r.get("scene_id"),
    }
}

/// Upsert (Some) or clear (None) one weekly cell.
pub async fn set_slot(
    pool: &SqlitePool,
    weekday: u8,
    period_id: &str,
    slot: Option<(&Option<String>, &str, &Option<String>)>,
) -> AppResult<()> {
    match slot {
        None => {
            sqlx::query("DELETE FROM week_slot WHERE weekday = ?1 AND period_id = ?2")
                .bind(weekday as i64)
                .bind(period_id)
                .execute(pool)
                .await?;
        }
        Some((class_id, subject, scene_id)) => {
            sqlx::query(
                "INSERT INTO week_slot
                   (id, weekday, period_id, class_id, subject, scene_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(weekday, period_id) DO UPDATE SET
                   class_id = ?4, subject = ?5, scene_id = ?6",
            )
            .bind(new_id())
            .bind(weekday as i64)
            .bind(period_id)
            .bind(class_id)
            .bind(subject)
            .bind(scene_id)
            .bind(now_ms())
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

// ── Date overrides ──────────────────────────────────────────────────────────

pub async fn overrides_for_date(pool: &SqlitePool, date: &str) -> AppResult<Vec<DateOverride>> {
    let rows = sqlx::query(
        "SELECT id, date, period_id, kind, class_id, subject, scene_id, title
         FROM date_override WHERE date = ?1",
    )
    .bind(date)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| DateOverride {
            id: r.get("id"),
            date: r.get("date"),
            period_id: r.get("period_id"),
            kind: override_kind(&r.get::<String, _>("kind")),
            class_id: r.get("class_id"),
            subject: r.get("subject"),
            scene_id: r.get("scene_id"),
            title: r.get("title"),
        })
        .collect())
}

/// Upsert (Some) or clear (None) one (date, period) override.
#[allow(clippy::too_many_arguments)]
pub async fn set_override(
    pool: &SqlitePool,
    date: &str,
    period_id: &str,
    ovr: Option<(OverrideKind, &Option<String>, &str, &Option<String>, &str)>,
) -> AppResult<()> {
    match ovr {
        None => {
            sqlx::query("DELETE FROM date_override WHERE date = ?1 AND period_id = ?2")
                .bind(date)
                .bind(period_id)
                .execute(pool)
                .await?;
        }
        Some((kind, class_id, subject, scene_id, title)) => {
            sqlx::query(
                "INSERT INTO date_override
                   (id, date, period_id, kind, class_id, subject, scene_id, title, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(date, period_id) DO UPDATE SET
                   kind = ?4, class_id = ?5, subject = ?6, scene_id = ?7, title = ?8",
            )
            .bind(new_id())
            .bind(date)
            .bind(period_id)
            .bind(override_kind_tag(kind))
            .bind(class_id)
            .bind(subject)
            .bind(scene_id)
            .bind(title)
            .bind(now_ms())
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

// ── Agenda + notes ──────────────────────────────────────────────────────────

pub async fn agenda_for_date(pool: &SqlitePool, date: &str) -> AppResult<Vec<AgendaItem>> {
    let rows = sqlx::query(
        "SELECT id, date, period_id, text, duration_min, done, sort_index
         FROM agenda_item WHERE date = ?1 ORDER BY period_id, sort_index",
    )
    .bind(date)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(row_to_agenda).collect())
}

fn row_to_agenda(r: sqlx::sqlite::SqliteRow) -> AgendaItem {
    AgendaItem {
        id: r.get("id"),
        date: r.get("date"),
        period_id: r.get("period_id"),
        text: r.get("text"),
        duration_min: r
            .get::<Option<i64>, _>("duration_min")
            .map(|d| d.max(0) as u32),
        done: r.get::<i64, _>("done") != 0,
        sort_index: r.get("sort_index"),
    }
}

/// Replace ONE lesson-instance's agenda (scoped to date + period).
pub async fn replace_agenda(
    pool: &SqlitePool,
    date: &str,
    period_id: &str,
    items: &[AgendaItem],
) -> AppResult<Vec<AgendaItem>> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM agenda_item WHERE date = ?1 AND period_id = ?2")
        .bind(date)
        .bind(period_id)
        .execute(&mut *tx)
        .await?;
    let stamp = now_ms();
    for item in items {
        sqlx::query(
            "INSERT INTO agenda_item
               (id, date, period_id, text, duration_min, done, sort_index, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&item.id)
        .bind(date)
        .bind(period_id)
        .bind(&item.text)
        .bind(item.duration_min.map(|d| d as i64))
        .bind(item.done as i64)
        .bind(item.sort_index)
        .bind(stamp)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(agenda_for_date(pool, date)
        .await?
        .into_iter()
        .filter(|a| a.period_id == period_id)
        .collect())
}

/// Targeted check-off — the widget's click cannot clobber a concurrent
/// panel edit of the other fields. Returns false when the id is unknown.
pub async fn set_agenda_done(pool: &SqlitePool, item_id: &str, done: bool) -> AppResult<bool> {
    let res = sqlx::query("UPDATE agenda_item SET done = ?2 WHERE id = ?1")
        .bind(item_id)
        .bind(done as i64)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

pub async fn notes_for_date(pool: &SqlitePool, date: &str) -> AppResult<Vec<DayNote>> {
    let rows = sqlx::query(
        "SELECT id, date, body, sort_index FROM day_note
         WHERE date = ?1 ORDER BY sort_index",
    )
    .bind(date)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| DayNote {
            id: r.get("id"),
            date: r.get("date"),
            body: r.get("body"),
            sort_index: r.get("sort_index"),
        })
        .collect())
}

pub async fn replace_notes(
    pool: &SqlitePool,
    date: &str,
    notes: &[DayNote],
) -> AppResult<Vec<DayNote>> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM day_note WHERE date = ?1")
        .bind(date)
        .execute(&mut *tx)
        .await?;
    let stamp = now_ms();
    for note in notes {
        sqlx::query(
            "INSERT INTO day_note (id, date, body, sort_index, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&note.id)
        .bind(date)
        .bind(&note.body)
        .bind(note.sort_index)
        .bind(stamp)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    notes_for_date(pool, date).await
}

// ── Name lookups for the resolver's join ────────────────────────────────────

pub async fn class_names(pool: &SqlitePool) -> AppResult<HashMap<String, String>> {
    let rows = sqlx::query("SELECT id, name FROM class")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.get("id"), r.get("name")))
        .collect())
}

pub async fn scene_names(pool: &SqlitePool) -> AppResult<HashMap<String, String>> {
    let rows = sqlx::query("SELECT id, name FROM scene")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.get("id"), r.get("name")))
        .collect())
}
