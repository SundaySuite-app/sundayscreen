-- 0002 — index for draw_state's member_id FK (gransking F9, funn #11).
--
-- The PK is (class_id, member_id), which the ON DELETE CASCADE lookup by
-- member_id alone cannot use — every class_member delete in the
-- replace_members pass full-scanned draw_state. Classroom-sized today;
-- honesty-in-schema either way.

CREATE INDEX idx_draw_member ON draw_state (member_id);
