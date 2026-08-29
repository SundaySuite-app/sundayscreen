//! Name-picker and group commands — the entropy and the `draw_state` I/O
//! around the pure decisions in `sundayscreen_core::{picker, groups}`.

use std::collections::HashSet;

use serde::Serialize;
use sqlx::SqlitePool;
use sundayscreen_core::groups::split;
use sundayscreen_core::layout::GroupMode;
use sundayscreen_core::picker::{choose_index, draw_pool};
use tauri::State;
use ts_rs::TS;

use crate::commands::valid_date;
use crate::db::store::{self, MemberRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// STABLE error messages the frontend distinguishes on. `AppError` has one
/// `Validation` code for both, so the STRING is the contract — reword either
/// and the widget can no longer tell "add some names" from "everybody is
/// marked away", which are opposite instructions to a teacher.
pub const ERR_NO_MEMBERS: &str = "class has no members";
pub const ERR_ALL_AWAY: &str = "all members are away";

/// One draw's answer.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "DrawResult.ts")]
#[serde(rename_all = "camelCase")]
pub struct DrawResult {
    pub member: MemberRow,
    /// How many are still undrawn in this round AFTER this draw (the whole
    /// PRESENT class in repeat-allowed mode).
    #[ts(type = "number")]
    pub remaining: i64,
    /// Did THIS draw start a new round (the previous one was complete)?
    pub reshuffled: bool,
}

/// A fresh random word. The OS entropy behind UUIDv4 is plenty for a
/// classroom draw — this is fairness, not cryptography.
fn entropy() -> u64 {
    uuid::Uuid::new_v4().as_u128() as u64
}

/// The whole draw runs in ONE transaction (gransking F9, funn #2): the
/// read-modify-write over `draw_state` must not interleave with a concurrent
/// draw, or two clicks could draw the same pupil "once" each — and a
/// reshuffle's clear could erase the other click's freshly recorded draw.
///
/// `today` is the frontend's local wall date: whoever is marked away today is
/// not in the pool. That the PRESENT ids are what `draw_pool` receives is
/// load-bearing — hand it the whole class and the round can never complete,
/// `reshuffled` never fires, and the "N left" counter lies every draw.
pub async fn draw_for(
    pool: &SqlitePool,
    class_id: &str,
    no_repeat: bool,
    today: &str,
    rng: u64,
) -> AppResult<DrawResult> {
    valid_date(today)?;
    let mut tx = pool.begin().await?;

    // Two DISTINCT refusals: "there are no names yet" sends the teacher to
    // the class list, "everybody is away" sends her to the attendance panel.
    if store::list_members(&mut *tx, class_id).await?.is_empty() {
        return Err(AppError::Validation(ERR_NO_MEMBERS.into()));
    }
    let members = store::list_present_members(&mut *tx, class_id, today).await?;
    if members.is_empty() {
        return Err(AppError::Validation(ERR_ALL_AWAY.into()));
    }
    let all_ids: Vec<String> = members.iter().map(|m| m.id.clone()).collect();

    let (candidates, reshuffled) = if no_repeat {
        let drawn: HashSet<String> = store::drawn_member_ids(&mut *tx, class_id)
            .await?
            .into_iter()
            .collect();
        let p = draw_pool(&all_ids, &drawn);
        if p.reshuffled {
            store::clear_drawn(&mut *tx, class_id).await?;
        }
        (p.pool, p.reshuffled)
    } else {
        (all_ids.clone(), false)
    };

    let chosen_id = candidates[choose_index(candidates.len(), rng)].clone();
    let member = members
        .into_iter()
        .find(|m| m.id == chosen_id)
        .expect("chosen id came from the member list");

    let remaining = if no_repeat {
        store::insert_drawn(&mut *tx, class_id, &chosen_id).await?;
        candidates.len() as i64 - 1
    } else {
        all_ids.len() as i64
    };

    tx.commit().await?;

    Ok(DrawResult {
        member,
        remaining,
        reshuffled,
    })
}

/// Deal the class into groups. Like [`draw_for`], only whoever is HERE today
/// is dealt — a group with an absent pupil's name on the board is a group
/// that cannot do the work.
pub async fn split_for(
    pool: &SqlitePool,
    class_id: &str,
    mode: GroupMode,
    n: u32,
    today: &str,
    seed: u64,
) -> AppResult<Vec<Vec<MemberRow>>> {
    valid_date(today)?;
    if store::list_members(pool, class_id).await?.is_empty() {
        return Err(AppError::Validation(ERR_NO_MEMBERS.into()));
    }
    let members = store::list_present_members(pool, class_id, today).await?;
    if members.is_empty() {
        return Err(AppError::Validation(ERR_ALL_AWAY.into()));
    }
    let ids: Vec<String> = members.iter().map(|m| m.id.clone()).collect();
    let groups = split(&ids, mode, n, seed);
    let by_id: std::collections::HashMap<&str, &MemberRow> =
        members.iter().map(|m| (m.id.as_str(), m)).collect();
    Ok(groups
        .into_iter()
        .map(|g| {
            g.into_iter()
                .map(|id| (*by_id.get(id.as_str()).expect("split only deals known ids")).clone())
                .collect()
        })
        .collect())
}

/// Mark one pupil away today, or back. A WRITE: a miss REJECTS (promise 4) —
/// the panel must never dim a chip on a write that did not happen.
///
/// Answers with the whole updated member list so the panel renders from the
/// truth it just wrote, without a second round trip.
pub async fn attendance_set_for(
    pool: &SqlitePool,
    class_id: &str,
    member_id: &str,
    absent: bool,
    today: &str,
) -> AppResult<Vec<MemberRow>> {
    valid_date(today)?;
    if !store::set_member_absent(pool, class_id, member_id, absent, today).await? {
        return Err(AppError::NotFound {
            entity: "class_member",
            id: member_id.to_string(),
        });
    }
    store::list_members(pool, class_id).await
}

#[tauri::command]
pub async fn picker_draw(
    db: State<'_, Db>,
    class_id: String,
    no_repeat: bool,
    today: String,
) -> AppResult<DrawResult> {
    draw_for(db.pool(), &class_id, no_repeat, &today, entropy()).await
}

#[tauri::command]
pub async fn picker_reset(db: State<'_, Db>, class_id: String) -> AppResult<()> {
    store::clear_drawn(db.pool(), &class_id).await
}

#[tauri::command]
pub async fn groups_split(
    db: State<'_, Db>,
    class_id: String,
    mode: GroupMode,
    n: u32,
    today: String,
) -> AppResult<Vec<Vec<MemberRow>>> {
    split_for(db.pool(), &class_id, mode, n, &today, entropy()).await
}

#[tauri::command]
pub async fn attendance_set(
    db: State<'_, Db>,
    class_id: String,
    member_id: String,
    absent: bool,
    today: String,
) -> AppResult<Vec<MemberRow>> {
    attendance_set_for(db.pool(), &class_id, &member_id, absent, &today).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::classes::members_set_for;

    /// Every test that is not ABOUT the date uses the same day.
    const TODAY: &str = "2026-08-31";

    async fn seeded_class(names: &[&str]) -> (SqlitePool, tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("tempdir");
        let pool = store::open_pool(&dir.path().join("test.sqlite"))
            .await
            .expect("open_pool");
        let class = store::insert_class(&pool, "7B").await.unwrap();
        members_set_for(
            &pool,
            &class.id,
            names.iter().map(|s| s.to_string()).collect(),
        )
        .await
        .unwrap();
        let id = class.id.clone();
        (pool, dir, id)
    }

    #[tokio::test]
    async fn no_repeat_draws_everyone_once_then_reshuffles() {
        let (pool, _d, class_id) = seeded_class(&["Kari", "Ola", "Per", "Mona"]).await;

        let mut seen = Vec::new();
        for rng in [7u64, 900, 3, 12] {
            let r = draw_for(&pool, &class_id, true, TODAY, rng).await.unwrap();
            assert!(!r.reshuffled, "the first round must not restart early");
            seen.push(r.member.name);
        }
        seen.sort();
        assert_eq!(seen, vec!["Kari", "Mona", "Ola", "Per"]);

        // The fifth draw starts a new round — and says so.
        let fifth = draw_for(&pool, &class_id, true, TODAY, 5).await.unwrap();
        assert!(fifth.reshuffled);
        assert_eq!(fifth.remaining, 3);
    }

    #[tokio::test]
    async fn remaining_counts_down_within_the_round() {
        let (pool, _d, class_id) = seeded_class(&["A", "B", "C"]).await;
        let r1 = draw_for(&pool, &class_id, true, TODAY, 1).await.unwrap();
        let r2 = draw_for(&pool, &class_id, true, TODAY, 1).await.unwrap();
        assert_eq!(r1.remaining, 2);
        assert_eq!(r2.remaining, 1);
    }

    #[tokio::test]
    async fn repeat_allowed_never_touches_the_round_state() {
        let (pool, _d, class_id) = seeded_class(&["A", "B"]).await;
        for rng in 0..10u64 {
            let r = draw_for(&pool, &class_id, false, TODAY, rng).await.unwrap();
            assert!(!r.reshuffled);
            assert_eq!(r.remaining, 2);
        }
        assert!(store::drawn_member_ids(&pool, &class_id)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn drawing_from_an_empty_class_is_a_validation_error() {
        let (pool, _d, class_id) = seeded_class(&[]).await;
        let err = draw_for(&pool, &class_id, true, TODAY, 1)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "validation");
    }

    #[tokio::test]
    async fn reset_starts_a_fresh_round_without_a_reshuffle_flag() {
        let (pool, _d, class_id) = seeded_class(&["A", "B"]).await;
        draw_for(&pool, &class_id, true, TODAY, 1).await.unwrap();
        store::clear_drawn(&pool, &class_id).await.unwrap();
        let r = draw_for(&pool, &class_id, true, TODAY, 1).await.unwrap();
        assert!(!r.reshuffled, "an explicit reset is not a wrap-around");
        assert_eq!(r.remaining, 1);
    }

    #[tokio::test]
    async fn groups_split_partitions_the_class_evenly() {
        let (pool, _d, class_id) = seeded_class(&["A", "B", "C", "D", "E"]).await;
        let groups = split_for(&pool, &class_id, GroupMode::Count, 2, TODAY, 42)
            .await
            .unwrap();
        assert_eq!(groups.len(), 2);
        let mut names: Vec<String> = groups.iter().flatten().map(|m| m.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["A", "B", "C", "D", "E"]);
        let sizes: Vec<usize> = groups.iter().map(|g| g.len()).collect();
        assert!(sizes.iter().max().unwrap() - sizes.iter().min().unwrap() <= 1);
    }

    // ── Attendance ──────────────────────────────────────────────────────

    /// Mark `name` away today. Returns the whole updated list.
    async fn mark_away(pool: &SqlitePool, class_id: &str, name: &str) -> Vec<MemberRow> {
        let member = store::list_members(pool, class_id)
            .await
            .unwrap()
            .into_iter()
            .find(|m| m.name == name)
            .expect("seeded name");
        attendance_set_for(pool, class_id, &member.id, true, TODAY)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn an_absent_pupil_is_never_drawn_and_never_dealt_a_group() {
        let (pool, _d, class_id) = seeded_class(&["Kari", "Ola", "Per", "Mona"]).await;
        let all = mark_away(&pool, &class_id, "Ola").await;
        assert_eq!(all.len(), 4, "the class list still holds everyone");
        assert_eq!(
            all.iter().filter(|m| m.absent_on.is_some()).count(),
            1,
            "the write answers with the truth it just wrote"
        );

        for rng in 0..24u64 {
            let r = draw_for(&pool, &class_id, false, TODAY, rng).await.unwrap();
            assert_ne!(r.member.name, "Ola", "an absent pupil cannot be drawn");
            assert_eq!(r.remaining, 3, "the count is of who is HERE");
        }

        let groups = split_for(&pool, &class_id, GroupMode::Count, 2, TODAY, 42)
            .await
            .unwrap();
        let mut names: Vec<String> = groups.iter().flatten().map(|m| m.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["Kari", "Mona", "Per"]);
    }

    /// The invariant the whole feature turns on: the no-repeat round must
    /// COMPLETE over the present set. Hand `draw_pool` the whole class and
    /// the round never finishes, `reshuffled` never fires, and the counter
    /// lies at every draw.
    #[tokio::test]
    async fn the_no_repeat_round_completes_over_the_present_set() {
        let (pool, _d, class_id) = seeded_class(&["Kari", "Ola", "Per", "Mona"]).await;
        mark_away(&pool, &class_id, "Ola").await;

        let mut seen = Vec::new();
        for rng in [7u64, 900, 3] {
            let r = draw_for(&pool, &class_id, true, TODAY, rng).await.unwrap();
            assert!(!r.reshuffled, "the round must not restart early");
            seen.push(r.member.name);
        }
        seen.sort();
        assert_eq!(seen, vec!["Kari", "Mona", "Per"]);
        // N present drawn ⇒ the round is complete: the NEXT draw reshuffles.
        let fourth = draw_for(&pool, &class_id, true, TODAY, 5).await.unwrap();
        assert!(fourth.reshuffled);
        assert_eq!(fourth.remaining, 2, "one of three present, taken");
    }

    #[tokio::test]
    async fn everyone_away_is_a_different_error_from_an_empty_class() {
        let (pool, _d, class_id) = seeded_class(&["Kari", "Ola"]).await;
        for name in ["Kari", "Ola"] {
            mark_away(&pool, &class_id, name).await;
        }

        let err = draw_for(&pool, &class_id, true, TODAY, 1)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "validation");
        assert!(
            err.to_string().contains(ERR_ALL_AWAY),
            "the widget tells the two apart on this exact string: {err}"
        );
        let err = split_for(&pool, &class_id, GroupMode::Count, 2, TODAY, 1)
            .await
            .unwrap_err();
        assert!(err.to_string().contains(ERR_ALL_AWAY));

        // An empty class keeps its OWN message — opposite advice.
        let (pool, _d, empty) = seeded_class(&[]).await;
        let err = draw_for(&pool, &empty, true, TODAY, 1).await.unwrap_err();
        assert!(err.to_string().contains(ERR_NO_MEMBERS));
        assert!(!err.to_string().contains(ERR_ALL_AWAY));
    }

    #[tokio::test]
    async fn absence_expires_with_the_date_not_with_a_reset_job() {
        let (pool, _d, class_id) = seeded_class(&["Kari", "Ola"]).await;
        mark_away(&pool, &class_id, "Ola").await;
        assert_eq!(
            draw_for(&pool, &class_id, false, TODAY, 0)
                .await
                .unwrap()
                .remaining,
            1
        );
        // The machine stood switched off overnight — nothing ran, and the
        // next school day is still correct.
        assert_eq!(
            draw_for(&pool, &class_id, false, "2026-09-01", 0)
                .await
                .unwrap()
                .remaining,
            2
        );
    }

    #[tokio::test]
    async fn a_marked_pupil_can_be_marked_back() {
        let (pool, _d, class_id) = seeded_class(&["Kari", "Ola"]).await;
        let all = mark_away(&pool, &class_id, "Ola").await;
        let ola = all.iter().find(|m| m.name == "Ola").unwrap();
        let back = attendance_set_for(&pool, &class_id, &ola.id, false, TODAY)
            .await
            .unwrap();
        assert!(back.iter().all(|m| m.absent_on.is_none()));
        assert_eq!(
            draw_for(&pool, &class_id, false, TODAY, 0)
                .await
                .unwrap()
                .remaining,
            2
        );
    }

    #[tokio::test]
    async fn an_attendance_write_that_hits_nothing_rejects() {
        let (pool, _d, class_id) = seeded_class(&["Kari"]).await;
        // Promise 4: never a fabricated success.
        assert_eq!(
            attendance_set_for(&pool, &class_id, "ghost", true, TODAY)
                .await
                .unwrap_err()
                .code(),
            "not_found"
        );
    }

    #[tokio::test]
    async fn a_garbage_date_is_refused_everywhere_it_is_accepted() {
        let (pool, _d, class_id) = seeded_class(&["Kari"]).await;
        let member = store::list_members(&pool, &class_id).await.unwrap()[0]
            .id
            .clone();
        for bad in ["", "31-08-2026", "2026-99-99", "2026-02-30"] {
            assert_eq!(
                draw_for(&pool, &class_id, true, bad, 1)
                    .await
                    .unwrap_err()
                    .code(),
                "validation",
                "{bad} must be refused by the draw"
            );
            assert_eq!(
                split_for(&pool, &class_id, GroupMode::Count, 2, bad, 1)
                    .await
                    .unwrap_err()
                    .code(),
                "validation",
                "{bad} must be refused by the split"
            );
            assert_eq!(
                attendance_set_for(&pool, &class_id, &member, true, bad)
                    .await
                    .unwrap_err()
                    .code(),
                "validation",
                "{bad} must never reach the absent_on column"
            );
        }
    }
}
