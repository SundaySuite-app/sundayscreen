-- The planner (Runde 2): the school day's period template, the recurring
-- weekly timetable, per-date overrides, per-lesson agendas and day notes.
--
-- Time conventions: period times are MINUTES SINCE LOCAL MIDNIGHT (INTEGER),
-- dates are 'YYYY-MM-DD' local wall dates minted by the FRONTEND, weekdays
-- are ISO 1..5. Agenda hangs off the DATE-INSTANCE (date, period) — next
-- Tuesday's plan is not this Tuesday's — and works identically whether the
-- effective lesson came from week_slot or date_override (the shadowing rule
-- lives in sundayscreen-core::schedule).
--
-- APPLIED-FOREVER: never edit this file.

CREATE TABLE period (
    id         TEXT PRIMARY KEY NOT NULL,
    label      TEXT NOT NULL,
    start_min  INTEGER NOT NULL,
    end_min    INTEGER NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'lesson',   -- 'lesson' | 'break'
    sort_index INTEGER NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE week_slot (
    id         TEXT PRIMARY KEY NOT NULL,
    weekday    INTEGER NOT NULL,                 -- ISO 1..5
    period_id  TEXT NOT NULL REFERENCES period(id) ON DELETE CASCADE,
    class_id   TEXT REFERENCES class(id) ON DELETE CASCADE,
    subject    TEXT NOT NULL DEFAULT '',
    scene_id   TEXT REFERENCES scene(id) ON DELETE SET NULL,
    created_at REAL NOT NULL,
    UNIQUE (weekday, period_id)
);

CREATE TABLE date_override (
    id         TEXT PRIMARY KEY NOT NULL,
    date       TEXT NOT NULL,
    period_id  TEXT NOT NULL REFERENCES period(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'lesson',   -- 'lesson' | 'cancelled'
    class_id   TEXT REFERENCES class(id) ON DELETE CASCADE,
    subject    TEXT NOT NULL DEFAULT '',
    scene_id   TEXT REFERENCES scene(id) ON DELETE SET NULL,
    title      TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    UNIQUE (date, period_id)
);

CREATE TABLE agenda_item (
    id           TEXT PRIMARY KEY NOT NULL,
    date         TEXT NOT NULL,
    period_id    TEXT NOT NULL REFERENCES period(id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    duration_min INTEGER,                        -- NULL = untimed
    done         INTEGER NOT NULL DEFAULT 0,
    sort_index   INTEGER NOT NULL,
    created_at   REAL NOT NULL
);

CREATE INDEX idx_agenda_lesson ON agenda_item (date, period_id, sort_index);

CREATE TABLE day_note (
    id         TEXT PRIMARY KEY NOT NULL,
    date       TEXT NOT NULL,
    body       TEXT NOT NULL,
    sort_index INTEGER NOT NULL,
    created_at REAL NOT NULL
);

CREATE INDEX idx_day_note ON day_note (date, sort_index);
