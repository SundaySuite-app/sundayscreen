-- SundayScreen schema, v1. Conventions (suite-wide): ids are TEXT UUID v7,
-- timestamps are REAL epoch milliseconds, foreign keys are enforced by the
-- connection options (see db/store.rs — PRAGMA here would only bind to the
-- migration's own connection).

-- The whole Settings struct as one JSON blob under key 'settings'.
CREATE TABLE app_setting (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

-- A class: its own name list AND its own screen layout.
CREATE TABLE class (
    id         TEXT PRIMARY KEY NOT NULL,
    name       TEXT NOT NULL,
    sort_index INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);

-- Pupils. Duplicate names are allowed — identity is the id, never the name.
CREATE TABLE class_member (
    id         TEXT PRIMARY KEY NOT NULL,
    class_id   TEXT NOT NULL REFERENCES class(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    sort_index INTEGER NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX idx_member_class ON class_member (class_id, sort_index);

-- One layout per class (v1). `kind` and `config` are separate columns on
-- purpose: a config that fails to parse costs THAT widget its settings (it
-- falls back to the kind's defaults), and an unknown kind is retained in the
-- database but skipped by the API — a downgrade never destroys a newer
-- version's widget. Coordinates are normalised 0..1 per axis.
CREATE TABLE widget_instance (
    id         TEXT PRIMARY KEY NOT NULL,
    class_id   TEXT NOT NULL REFERENCES class(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    w REAL NOT NULL,
    h REAL NOT NULL,
    z INTEGER NOT NULL,
    config     TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX idx_widget_class ON widget_instance (class_id, z);

-- The name picker's "no repeats until everyone is drawn" pool: who has been
-- drawn in the current round, per class.
CREATE TABLE draw_state (
    class_id  TEXT NOT NULL REFERENCES class(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES class_member(id) ON DELETE CASCADE,
    drawn_at  REAL NOT NULL,
    PRIMARY KEY (class_id, member_id)
);
