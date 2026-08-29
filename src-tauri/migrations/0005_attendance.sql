-- 0005 — attendance: who is actually here today.
--
-- A DATE STAMP, not a boolean. "Away" means `absent_on` equals TODAY's local
-- wall date (the frontend mints it, ADR-009), so the day change is implicit
-- and always correct — including when the machine stood switched off across
-- midnight. A `present INTEGER` plus a nightly reset job can MISS a day and
-- start Tuesday morning with Monday's absences still on the board.
--
-- The column is OVERWRITTEN, never appended to: one row per pupil, one date.
-- No attendance HISTORY can accumulate here. That record belongs in the
-- school's own system, and PRIVACY.md makes no promise about that data
-- category (it promises that what the app does keep never leaves the
-- machine, which stays true of this column).
--
-- NULL = never marked away. Nothing backfills, so every existing pupil is
-- present on the morning after the upgrade.
--
-- APPLIED-FOREVER: never edit this file.

ALTER TABLE class_member ADD COLUMN absent_on TEXT;
