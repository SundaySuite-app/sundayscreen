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

use crate::db::store::{self, MemberRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// One draw's answer.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "DrawResult.ts")]
#[serde(rename_all = "camelCase")]
pub struct DrawResult {
    pub member: MemberRow,
    /// How many are still undrawn in this round AFTER this draw (always the
    /// full class in repeat-allowed mode).
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

pub async fn draw_for(
    pool: &SqlitePool,
    class_id: &str,
    no_repeat: bool,
    rng: u64,
) -> AppResult<DrawResult> {
    let members = store::list_members(pool, class_id).await?;
    if members.is_empty() {
        return Err(AppError::Validation("class has no members".into()));
    }
    let all_ids: Vec<String> = members.iter().map(|m| m.id.clone()).collect();

    let (candidates, reshuffled) = if no_repeat {
        let drawn: HashSet<String> = store::drawn_member_ids(pool, class_id)
            .await?
            .into_iter()
            .collect();
        let p = draw_pool(&all_ids, &drawn);
        if p.reshuffled {
            store::clear_drawn(pool, class_id).await?;
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
        store::insert_drawn(pool, class_id, &chosen_id).await?;
        candidates.len() as i64 - 1
    } else {
        all_ids.len() as i64
    };

    Ok(DrawResult {
        member,
        remaining,
        reshuffled,
    })
}

pub async fn split_for(
    pool: &SqlitePool,
    class_id: &str,
    mode: GroupMode,
    n: u32,
    seed: u64,
) -> AppResult<Vec<Vec<MemberRow>>> {
    let members = store::list_members(pool, class_id).await?;
    if members.is_empty() {
        return Err(AppError::Validation("class has no members".into()));
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

#[tauri::command]
pub async fn picker_draw(
    db: State<'_, Db>,
    class_id: String,
    no_repeat: bool,
) -> AppResult<DrawResult> {
    draw_for(db.pool(), &class_id, no_repeat, entropy()).await
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
) -> AppResult<Vec<Vec<MemberRow>>> {
    split_for(db.pool(), &class_id, mode, n, entropy()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::classes::members_set_for;

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
            let r = draw_for(&pool, &class_id, true, rng).await.unwrap();
            assert!(!r.reshuffled, "the first round must not restart early");
            seen.push(r.member.name);
        }
        seen.sort();
        assert_eq!(seen, vec!["Kari", "Mona", "Ola", "Per"]);

        // The fifth draw starts a new round — and says so.
        let fifth = draw_for(&pool, &class_id, true, 5).await.unwrap();
        assert!(fifth.reshuffled);
        assert_eq!(fifth.remaining, 3);
    }

    #[tokio::test]
    async fn remaining_counts_down_within_the_round() {
        let (pool, _d, class_id) = seeded_class(&["A", "B", "C"]).await;
        let r1 = draw_for(&pool, &class_id, true, 1).await.unwrap();
        let r2 = draw_for(&pool, &class_id, true, 1).await.unwrap();
        assert_eq!(r1.remaining, 2);
        assert_eq!(r2.remaining, 1);
    }

    #[tokio::test]
    async fn repeat_allowed_never_touches_the_round_state() {
        let (pool, _d, class_id) = seeded_class(&["A", "B"]).await;
        for rng in 0..10u64 {
            let r = draw_for(&pool, &class_id, false, rng).await.unwrap();
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
        let err = draw_for(&pool, &class_id, true, 1).await.unwrap_err();
        assert_eq!(err.code(), "validation");
    }

    #[tokio::test]
    async fn reset_starts_a_fresh_round_without_a_reshuffle_flag() {
        let (pool, _d, class_id) = seeded_class(&["A", "B"]).await;
        draw_for(&pool, &class_id, true, 1).await.unwrap();
        store::clear_drawn(&pool, &class_id).await.unwrap();
        let r = draw_for(&pool, &class_id, true, 1).await.unwrap();
        assert!(!r.reshuffled, "an explicit reset is not a wrap-around");
        assert_eq!(r.remaining, 1);
    }

    #[tokio::test]
    async fn groups_split_partitions_the_class_evenly() {
        let (pool, _d, class_id) = seeded_class(&["A", "B", "C", "D", "E"]).await;
        let groups = split_for(&pool, &class_id, GroupMode::Count, 2, 42)
            .await
            .unwrap();
        assert_eq!(groups.len(), 2);
        let mut names: Vec<String> = groups.iter().flatten().map(|m| m.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["A", "B", "C", "D", "E"]);
        let sizes: Vec<usize> = groups.iter().map(|g| g.len()).collect();
        assert!(sizes.iter().max().unwrap() - sizes.iter().min().unwrap() <= 1);
    }
}
