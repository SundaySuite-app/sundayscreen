//! The group generator — a seeded shuffle and a round-robin deal. Pure and
//! deterministic per seed, so the properties (everyone placed exactly once,
//! sizes differ by at most one) are testable without any randomness source.

use crate::layout::GroupMode;

/// A tiny xorshift64* — deterministic, seedable, and plenty for dealing a
/// class into groups. No `rand` dependency.
struct XorShift(u64);

impl XorShift {
    fn new(seed: u64) -> Self {
        // Zero would be a fixed point; nudge it.
        XorShift(if seed == 0 { 0x9E3779B97F4A7C15 } else { seed })
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
}

/// Fisher–Yates with the seeded generator.
fn shuffle<T>(items: &mut [T], seed: u64) {
    let mut rng = XorShift::new(seed);
    for i in (1..items.len()).rev() {
        let j = (rng.next() % (i as u64 + 1)) as usize;
        items.swap(i, j);
    }
}

/// How many groups a spec means for `len` members. At least 1, never more
/// than the member count.
fn group_count(len: usize, mode: GroupMode, n: u32) -> usize {
    let n = n.max(1) as usize;
    let count = match mode {
        GroupMode::Count => n,
        GroupMode::Size => len.div_ceil(n),
    };
    count.clamp(1, len.max(1))
}

/// Deal the members into groups: seeded shuffle, then round-robin — which is
/// what guarantees the sizes differ by at most one, whatever the remainder.
pub fn split(member_ids: &[String], mode: GroupMode, n: u32, seed: u64) -> Vec<Vec<String>> {
    if member_ids.is_empty() {
        return Vec::new();
    }
    let mut shuffled: Vec<String> = member_ids.to_vec();
    shuffle(&mut shuffled, seed);
    let count = group_count(shuffled.len(), mode, n);
    let mut groups: Vec<Vec<String>> = vec![Vec::new(); count];
    for (i, id) in shuffled.into_iter().enumerate() {
        groups[i % count].push(id);
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(count: usize) -> Vec<String> {
        (0..count).map(|i| format!("m{i}")).collect()
    }

    fn check_partition(all: &[String], groups: &[Vec<String>]) {
        // Everyone placed EXACTLY once.
        let mut flat: Vec<String> = groups.iter().flatten().cloned().collect();
        flat.sort();
        let mut want = all.to_vec();
        want.sort();
        assert_eq!(flat, want);
        // Sizes differ by at most one.
        let sizes: Vec<usize> = groups.iter().map(|g| g.len()).collect();
        let (min, max) = (*sizes.iter().min().unwrap(), *sizes.iter().max().unwrap());
        assert!(max - min <= 1, "sizes {sizes:?} differ by more than one");
    }

    #[test]
    fn count_mode_makes_n_groups_with_even_sizes() {
        for (members, n) in [(10, 3u32), (7, 2), (5, 5), (9, 4)] {
            let all = ids(members);
            let groups = split(&all, GroupMode::Count, n, 42);
            assert_eq!(groups.len(), n as usize);
            check_partition(&all, &groups);
        }
    }

    #[test]
    fn size_mode_makes_ceil_len_over_n_groups() {
        let all = ids(10);
        let groups = split(&all, GroupMode::Size, 4, 42);
        assert_eq!(groups.len(), 3); // ceil(10/4)
        check_partition(&all, &groups);
    }

    #[test]
    fn asking_for_more_groups_than_members_caps_at_one_each() {
        let all = ids(3);
        let groups = split(&all, GroupMode::Count, 10, 7);
        assert_eq!(groups.len(), 3);
        check_partition(&all, &groups);
    }

    #[test]
    fn empty_class_splits_into_nothing() {
        assert!(split(&[], GroupMode::Count, 3, 1).is_empty());
    }

    #[test]
    fn the_same_seed_deals_the_same_groups() {
        let all = ids(12);
        assert_eq!(
            split(&all, GroupMode::Count, 3, 1234),
            split(&all, GroupMode::Count, 3, 1234),
        );
    }

    #[test]
    fn different_seeds_usually_deal_differently() {
        let all = ids(12);
        let distinct = (0..20u64)
            .map(|seed| split(&all, GroupMode::Count, 3, seed))
            .collect::<std::collections::HashSet<_>>()
            .len();
        assert!(distinct > 10, "only {distinct} distinct deals in 20 seeds");
    }

    #[test]
    fn a_zero_seed_still_shuffles() {
        let all = ids(12);
        let dealt = split(&all, GroupMode::Count, 1, 0);
        assert_eq!(dealt.len(), 1);
        assert_ne!(dealt[0], all, "identity deal from seed 0 means no shuffle");
    }
}
