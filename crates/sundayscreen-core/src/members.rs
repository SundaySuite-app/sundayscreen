//! Name-list reconciliation — the decision half of `members_set`.
//!
//! The manage panel edits names as a PASTE-FRIENDLY textarea (one name per
//! line), so a save is a whole new list — but member IDENTITY must survive
//! it: the name picker's `draw_state` references member ids, and retyping
//! the same list must not reset who has been drawn. [`reconcile`] therefore
//! re-uses the id of an existing member with the same name (greedily, in
//! order, so duplicates pair up first-to-first); names that disappeared drop
//! their ids (the DB cascade clears their draw state), and new names get no
//! id (the store mints one).

/// Longest member name that will be persisted, in characters.
pub const NAME_MAX_CHARS: usize = 120;

/// Longest CLASS or SCREEN name, in characters — the label a teacher types
/// for a group or a board, not a pupil's name (that is [`NAME_MAX_CHARS`],
/// and the two are free to drift apart).
///
/// Lives here, beside the member limits, because it had four independent
/// copies of the literal `80` until R4: `commands::classes`,
/// `commands::scenes`, `transfer::check_limits` and the frontend. Nothing
/// would have noticed one of them moving — the seam-bug shape exactly. One
/// `pub const` in a file `scripts/gen-limits.mjs` scans makes the frontend's
/// copy generated (`LIMITS.CLASS_NAME_MAX_CHARS`) and makes a second Rust
/// declaration of the same NAME a hard error in that script's collision
/// guard, which is the half that keeps it from quietly forking again.
pub const CLASS_NAME_MAX_CHARS: usize = 80;

/// Most members a class may hold. Generous — a whole school year, not a
/// class — but bounded, so a stray paste of a novel cannot become a layout.
pub const MEMBERS_MAX: usize = 1000;

/// One reconciled member: an existing id to keep, or `None` for a fresh row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberSpec {
    pub id: Option<String>,
    pub name: String,
}

/// Clean one raw name: trim, cap at [`NAME_MAX_CHARS`]. Returns `None` for
/// an empty line.
pub fn clean_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(NAME_MAX_CHARS).collect())
}

/// The matching key: trimmed and case-folded, so fixing "KARI" → "Kari" in
/// the textarea is a SPELLING fix, not a new pupil — her id (and therefore
/// her drawn-this-round state) survives, and the new spelling is what gets
/// stored. (Gransking F9, funn #12.)
fn match_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Reconcile the wanted names against the existing `(id, name)` rows (in
/// display order). Order of the result IS the new display order. Input names
/// are cleaned; empty lines vanish; the list is capped at [`MEMBERS_MAX`].
pub fn reconcile(existing: &[(String, String)], wanted: &[String]) -> Vec<MemberSpec> {
    // match key → queue of unused existing ids, in display order.
    let mut free: std::collections::HashMap<String, std::collections::VecDeque<&str>> =
        std::collections::HashMap::new();
    for (id, name) in existing {
        free.entry(match_key(name))
            .or_default()
            .push_back(id.as_str());
    }

    wanted
        .iter()
        .filter_map(|raw| clean_name(raw))
        .take(MEMBERS_MAX)
        .map(|name| {
            let id = free
                .get_mut(&match_key(&name))
                .and_then(|q| q.pop_front())
                .map(|s| s.to_string());
            MemberSpec { id, name }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ex(rows: &[(&str, &str)]) -> Vec<(String, String)> {
        rows.iter()
            .map(|(i, n)| (i.to_string(), n.to_string()))
            .collect()
    }

    fn want(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn unchanged_names_keep_their_ids() {
        let specs = reconcile(&ex(&[("a", "Kari"), ("b", "Ola")]), &want(&["Kari", "Ola"]));
        assert_eq!(specs[0].id.as_deref(), Some("a"));
        assert_eq!(specs[1].id.as_deref(), Some("b"));
    }

    #[test]
    fn reordering_keeps_ids_and_takes_the_new_order() {
        let specs = reconcile(&ex(&[("a", "Kari"), ("b", "Ola")]), &want(&["Ola", "Kari"]));
        assert_eq!(specs[0].name, "Ola");
        assert_eq!(specs[0].id.as_deref(), Some("b"));
        assert_eq!(specs[1].id.as_deref(), Some("a"));
    }

    #[test]
    fn new_names_get_no_id_and_removed_names_release_theirs() {
        let specs = reconcile(&ex(&[("a", "Kari")]), &want(&["Nils"]));
        assert_eq!(
            specs,
            vec![MemberSpec {
                id: None,
                name: "Nils".into()
            }]
        );
    }

    #[test]
    fn duplicate_names_pair_up_first_to_first() {
        let specs = reconcile(
            &ex(&[("a", "Ali"), ("b", "Ali")]),
            &want(&["Ali", "Ali", "Ali"]),
        );
        assert_eq!(specs[0].id.as_deref(), Some("a"));
        assert_eq!(specs[1].id.as_deref(), Some("b"));
        assert_eq!(specs[2].id, None, "the third Ali is a new row");
    }

    #[test]
    fn names_are_trimmed_and_empty_lines_vanish() {
        let specs = reconcile(&[], &want(&["  Kari  ", "", "   ", "Ola"]));
        assert_eq!(
            specs.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            vec!["Kari", "Ola"],
        );
    }

    #[test]
    fn a_trimmed_name_still_matches_its_existing_id() {
        let specs = reconcile(&ex(&[("a", "Kari")]), &want(&["  Kari "]));
        assert_eq!(specs[0].id.as_deref(), Some("a"));
    }

    #[test]
    fn a_capitalization_fix_keeps_the_id_and_takes_the_new_spelling() {
        // Gransking F9, funn #12: "KARI" → "Kari" is a spelling fix — her
        // draw state must survive it.
        let specs = reconcile(&ex(&[("a", "KARI")]), &want(&["Kari"]));
        assert_eq!(specs[0].id.as_deref(), Some("a"));
        assert_eq!(specs[0].name, "Kari");
    }

    #[test]
    fn overlong_names_are_capped_on_a_char_boundary() {
        let long = "æ".repeat(NAME_MAX_CHARS + 50);
        let specs = reconcile(&[], &[long]);
        assert_eq!(specs[0].name.chars().count(), NAME_MAX_CHARS);
    }

    #[test]
    fn the_list_is_capped_at_members_max() {
        let many: Vec<String> = (0..MEMBERS_MAX + 20).map(|i| format!("Elev {i}")).collect();
        assert_eq!(reconcile(&[], &many).len(), MEMBERS_MAX);
    }
}
