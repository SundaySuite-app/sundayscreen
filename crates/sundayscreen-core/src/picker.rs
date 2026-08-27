//! The name picker's decisions — pool construction and the choice itself.
//! Pure: randomness comes IN as a number, so every rule is table-testable.
//!
//! "No repeats" means: within one round, everyone is drawn exactly once.
//! The round's memory is the `draw_state` table (ids, not names — duplicates
//! and renames stay correct); when the pool runs dry the round RESHUFFLES:
//! everyone is back in, and the caller clears the table.

use std::collections::HashSet;

/// The drawable pool for this draw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrawPool {
    /// Member ids still undrawn this round (display order).
    pub pool: Vec<String>,
    /// Did building the pool start a NEW round (everyone had been drawn)?
    pub reshuffled: bool,
}

/// Build the pool: everyone not yet drawn — or everyone, reshuffled, when
/// the round is complete. An empty `all` yields an empty pool (the caller
/// refuses to draw from nobody).
pub fn draw_pool(all_ids: &[String], drawn: &HashSet<String>) -> DrawPool {
    let pool: Vec<String> = all_ids
        .iter()
        .filter(|id| !drawn.contains(*id))
        .cloned()
        .collect();
    if pool.is_empty() && !all_ids.is_empty() {
        DrawPool {
            pool: all_ids.to_vec(),
            reshuffled: true,
        }
    } else {
        DrawPool {
            pool,
            reshuffled: false,
        }
    }
}

/// Pick an index from `len` candidates given a random word. `len` must be
/// non-zero — the caller guards the empty-class case.
pub fn choose_index(len: usize, rng: u64) -> usize {
    (rng % len as u64) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn pool_excludes_the_drawn() {
        let all = ids(&["a", "b", "c"]);
        let drawn: HashSet<String> = ["b".to_string()].into();
        let p = draw_pool(&all, &drawn);
        assert_eq!(p.pool, ids(&["a", "c"]));
        assert!(!p.reshuffled);
    }

    #[test]
    fn a_dry_pool_reshuffles_to_everyone() {
        let all = ids(&["a", "b"]);
        let drawn: HashSet<String> = ["a".to_string(), "b".to_string()].into();
        let p = draw_pool(&all, &drawn);
        assert_eq!(p.pool, all);
        assert!(p.reshuffled);
    }

    #[test]
    fn an_empty_class_yields_an_empty_pool_not_a_reshuffle() {
        let p = draw_pool(&[], &HashSet::new());
        assert!(p.pool.is_empty());
        assert!(!p.reshuffled);
    }

    #[test]
    fn a_full_round_draws_everyone_exactly_once() {
        // The property the whole feature exists for: simulate a round.
        let all = ids(&["a", "b", "c", "d", "e"]);
        let mut drawn: HashSet<String> = HashSet::new();
        let mut seen = Vec::new();
        for rng in [17u64, 3, 99, 4, 1] {
            let p = draw_pool(&all, &drawn);
            assert!(!p.reshuffled, "round must not restart early");
            let chosen = p.pool[choose_index(p.pool.len(), rng)].clone();
            drawn.insert(chosen.clone());
            seen.push(chosen);
        }
        seen.sort();
        assert_eq!(seen, ids(&["a", "b", "c", "d", "e"]));

        // The sixth draw starts the new round.
        assert!(draw_pool(&all, &drawn).reshuffled);
    }

    #[test]
    fn choose_index_stays_in_bounds_for_any_rng() {
        for rng in [0u64, 1, 5, 6, u64::MAX] {
            assert!(choose_index(5, rng) < 5);
        }
    }
}
