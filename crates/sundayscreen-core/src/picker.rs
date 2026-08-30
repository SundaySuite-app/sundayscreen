//! The name picker's decisions — pool construction and the choice itself.
//! Pure: randomness comes IN as a number, so every rule is table-testable.
//!
//! "No repeats" means: within one round, everyone is drawn exactly once.
//! The round's memory is the `draw_state` table (ids, not names — duplicates
//! and renames stay correct); when the pool runs dry the round RESHUFFLES:
//! everyone is back in, and the caller clears the table.
//!
//! A draw may ask for SEVERAL names at once ([`draw_many_pool`]). That is one
//! decision, not N of them: the names must be distinct, a reshuffle in the
//! middle must not hand back somebody this very draw just took, and the
//! round's counter has to come out as ONE honest number.

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

/// One whole draw: who came up, and what it did to the round.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManyDraw {
    /// The chosen ids, in draw order. Always DISTINCT, and never longer than
    /// `all_ids` — a class of four cannot yield five different names.
    pub chosen: Vec<String>,
    /// Did this draw start a new round (at its start, or part-way through)?
    pub reshuffled: bool,
    /// Ids still undrawn in the round AFTER this draw. Meaningful in
    /// no-repeat mode; the caller substitutes the present-class size when
    /// repeats are allowed, because then there is no round to count down.
    pub remaining: usize,
}

/// Draw SEVERAL names in one go — the whole draw decided in a single pass.
///
/// One random word per name, so `rng.len()` IS the number asked for: a
/// mismatch between "how many names" and "how much randomness" is not a
/// thing this signature can express.
///
/// Two rules the loop exists for, and neither survives a caller-side loop
/// over the single draw:
///
///  - **The names in one draw are DISTINCT.** Three names on the board where
///    two are the same pupil is not a draw, and the whole class can see it.
///  - **A round that runs dry MID-DRAW reshuffles**, exactly as it does
///    between draws — but the ids this draw has already taken are NOT
///    candidates again in the new round's opening. Without that exclusion
///    "no repeats" would repeat inside a single click, which is the one
///    thing the setting is for.
///
/// A class smaller than the number asked for yields the whole class and
/// stops: there is no honest way to put five different names on the board
/// when four pupils are here.
pub fn draw_many_pool(all_ids: &[String], drawn: &HashSet<String>, rng: &[u64]) -> ManyDraw {
    let first = draw_pool(all_ids, drawn);
    let opening_len = first.pool.len();
    let mut pool = first.pool;
    let mut reshuffled = first.reshuffled;
    let mut chosen: Vec<String> = Vec::with_capacity(rng.len());

    for &word in rng {
        if pool.is_empty() {
            let fresh: Vec<String> = all_ids
                .iter()
                .filter(|id| !chosen.iter().any(|taken| taken == *id))
                .cloned()
                .collect();
            if fresh.is_empty() {
                break; // nobody left who is not already on this draw's list
            }
            pool = fresh;
            reshuffled = true;
        }
        chosen.push(pool.remove(choose_index(pool.len(), word)));
    }

    // What the round was measured against: the fresh round when this draw
    // started one, otherwise the pool it opened with. `draw_pool` already
    // hands back the whole class when it reshuffles at the start, so the two
    // agree there.
    let round_size = if reshuffled {
        all_ids.len()
    } else {
        opening_len
    };
    ManyDraw {
        remaining: round_size.saturating_sub(chosen.len()),
        chosen,
        reshuffled,
    }
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

    // ── Several names in one draw ───────────────────────────────────────────

    fn distinct(chosen: &[String]) -> bool {
        chosen.iter().collect::<HashSet<_>>().len() == chosen.len()
    }

    /// One random word is exactly the old single draw — the equivalence the
    /// whole "n = 1 changes nothing" claim rests on, checked against the two
    /// primitives it used to be built from.
    #[test]
    fn one_word_is_the_single_draw_it_replaced() {
        let all = ids(&["a", "b", "c", "d"]);
        for drawn_names in [vec![], vec!["a"], vec!["a", "b", "c", "d"]] {
            let drawn: HashSet<String> = drawn_names.iter().map(|s| s.to_string()).collect();
            for rng in [0u64, 1, 7, 900, u64::MAX] {
                let old_pool = draw_pool(&all, &drawn);
                let expected = old_pool.pool[choose_index(old_pool.pool.len(), rng)].clone();

                let many = draw_many_pool(&all, &drawn, &[rng]);
                assert_eq!(many.chosen, vec![expected]);
                assert_eq!(many.reshuffled, old_pool.reshuffled);
                assert_eq!(many.remaining, old_pool.pool.len() - 1);
            }
        }
    }

    #[test]
    fn a_draw_of_several_never_names_the_same_pupil_twice() {
        let all = ids(&["a", "b", "c", "d", "e"]);
        // Every rng shape, including "always the same word" — the pool
        // SHRINKS between picks, so a constant word must still walk.
        for rng in [
            vec![0u64, 0, 0],
            vec![1, 1, 1],
            vec![u64::MAX, 7, 3],
            vec![4, 99, 12, 5, 1],
        ] {
            let d = draw_many_pool(&all, &HashSet::new(), &rng);
            assert_eq!(d.chosen.len(), rng.len());
            assert!(distinct(&d.chosen), "{:?} repeats", d.chosen);
            assert!(!d.reshuffled);
            assert_eq!(d.remaining, all.len() - rng.len());
        }
    }

    /// The case a frontend loop over the single draw gets WRONG: the round
    /// runs dry half-way through, and the reshuffle must not hand back
    /// somebody this very draw already took.
    #[test]
    fn a_round_that_runs_dry_mid_draw_reshuffles_without_repeating() {
        let all = ids(&["a", "b", "c", "d"]);
        let drawn: HashSet<String> = ["a".to_string(), "b".to_string(), "c".to_string()].into();

        let d = draw_many_pool(&all, &drawn, &[0, 0, 0]);
        assert_eq!(d.chosen.len(), 3);
        assert!(distinct(&d.chosen), "{:?} repeats", d.chosen);
        assert_eq!(d.chosen[0], "d", "the round finishes before it restarts");
        assert!(d.reshuffled);
        // The new round is measured against the whole class, and the three
        // names just taken are gone from it.
        assert_eq!(d.remaining, 1);
    }

    /// A reshuffle at the START behaves like the old one: everyone is back
    /// in, and the count is against the whole class.
    #[test]
    fn a_complete_round_reshuffles_before_the_first_pick() {
        let all = ids(&["a", "b", "c"]);
        let drawn: HashSet<String> = all.iter().cloned().collect();
        let d = draw_many_pool(&all, &drawn, &[0, 0]);
        assert!(d.reshuffled);
        assert_eq!(d.chosen.len(), 2);
        assert!(distinct(&d.chosen));
        assert_eq!(d.remaining, 1);
    }

    #[test]
    fn a_class_smaller_than_the_ask_yields_the_class_and_stops() {
        let all = ids(&["a", "b", "c"]);
        let d = draw_many_pool(&all, &HashSet::new(), &[0, 0, 0, 0, 0]);
        assert_eq!(d.chosen.len(), 3, "three pupils cannot be five names");
        assert!(distinct(&d.chosen));
        assert!(
            !d.reshuffled,
            "running out of PUPILS is not a completed round restarting"
        );
        assert_eq!(d.remaining, 0);
    }

    #[test]
    fn an_empty_class_draws_nobody() {
        let d = draw_many_pool(&[], &HashSet::new(), &[7, 7, 7]);
        assert!(d.chosen.is_empty());
        assert!(!d.reshuffled);
        assert_eq!(d.remaining, 0);
    }

    #[test]
    fn asking_for_nothing_takes_nothing() {
        let all = ids(&["a", "b"]);
        let d = draw_many_pool(&all, &HashSet::new(), &[]);
        assert!(d.chosen.is_empty());
        assert_eq!(d.remaining, 2, "the round is untouched");
    }

    /// The property the feature exists inside: over several multi-draws the
    /// round still completes — everyone exactly once, then a restart.
    #[test]
    fn the_round_still_completes_when_it_is_drawn_two_at_a_time() {
        let all = ids(&["a", "b", "c", "d", "e", "f"]);
        let mut drawn: HashSet<String> = HashSet::new();
        let mut seen = Vec::new();
        for rng in [[17u64, 3], [99, 4], [1, 8]] {
            let d = draw_many_pool(&all, &drawn, &rng);
            assert!(!d.reshuffled, "the first round must not restart early");
            for id in &d.chosen {
                drawn.insert(id.clone());
            }
            seen.extend(d.chosen);
        }
        seen.sort();
        assert_eq!(seen, all);
        assert!(draw_many_pool(&all, &drawn, &[0]).reshuffled);
    }
}
