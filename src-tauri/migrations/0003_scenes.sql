-- Scenes: named, reusable screens (Runde 2). A scene with class_id = NULL is
-- a GLOBAL library scene usable in every class (widgets read the ACTIVE
-- class's data, so layouts are class-agnostic); a scene WITH a class_id is
-- that class's default screen — created with the class, dies with the class,
-- and deliberately deterministic ('default-' || class_id) so the backfill is
-- assertable and the healing paths are greppable.
--
-- widget_instance moves from class-keyed to scene-keyed. SQLite cannot relax
-- a NOT NULL foreign key in place, so the table is REBUILT and every existing
-- layout is adopted into its class's freshly minted default scene. This file
-- is APPLIED-FOREVER: never edit it (a checksum mismatch reads as corruption
-- and factory-resets the teacher's database).

CREATE TABLE scene (
    id         TEXT PRIMARY KEY NOT NULL,
    class_id   TEXT REFERENCES class(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    sort_index INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);

CREATE INDEX idx_scene_class ON scene (class_id, sort_index);

-- One default scene per existing class, named like the class.
INSERT INTO scene (id, class_id, name, sort_index, created_at)
SELECT 'default-' || id, id, name, 0, created_at FROM class;

CREATE TABLE widget_instance_v2 (
    id         TEXT PRIMARY KEY NOT NULL,
    scene_id   TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    x          REAL NOT NULL,
    y          REAL NOT NULL,
    w          REAL NOT NULL,
    h          REAL NOT NULL,
    z          INTEGER NOT NULL,
    config     TEXT NOT NULL,
    created_at REAL NOT NULL
);

INSERT INTO widget_instance_v2 (id, scene_id, kind, x, y, w, h, z, config, created_at)
SELECT id, 'default-' || class_id, kind, x, y, w, h, z, config, created_at
FROM widget_instance;

DROP TABLE widget_instance;
ALTER TABLE widget_instance_v2 RENAME TO widget_instance;

CREATE INDEX idx_widget_scene ON widget_instance (scene_id, z);
