// The browser tier's fixture seam: a MINI BACKEND in the page, persisted in
// localStorage — which is what lets a journey RELOAD and find its classes,
// names, scenes and widgets again, exactly like the real SQLite store would.
// Deliberately dumb: no reconcile, no clamps — those are the REAL backend's
// unit-tested jobs; this store only has to be consistent enough for
// journeys.

import type { Page } from "@playwright/test";

/** Install the standard fixture set. Call BEFORE page.goto("/").
 *  `memberNames` pre-seeds class 7B's name list. */
export async function installFixtures(
  page: Page,
  opts: { memberNames?: string[] } = {},
): Promise<void> {
  await page.addInitScript((seedNames: string[]) => {
    const DB_KEY = "__e2e_db__";

    interface E2eScene {
      id: string;
      classId: string | null;
      name: string;
      sortIndex: number;
      createdAt: number;
    }

    interface E2eDb {
      classes: {
        id: string;
        name: string;
        sortIndex: number;
        createdAt: number;
      }[];
      scenes: E2eScene[];
      activeClassId: string | null;
      activeSceneId: string | null;
      members: Record<
        string,
        { id: string; name: string; sortIndex: number }[]
      >;
      /** Keyed by SCENE id — the real schema's write key. */
      layouts: Record<string, unknown[]>;
      drawn?: Record<string, string[]>;
      settings?: Record<string, unknown>;
      nextId: number;
    }

    const defaultSceneId = (classId: string) => `default-${classId}`;

    const load = (): E2eDb =>
      (JSON.parse(localStorage.getItem(DB_KEY) ?? "null") as E2eDb | null) ?? {
        classes: [{ id: "c1", name: "7B", sortIndex: 0, createdAt: 1 }],
        scenes: [
          {
            id: "default-c1",
            classId: "c1",
            name: "7B",
            sortIndex: 0,
            createdAt: 1,
          },
        ],
        activeClassId: "c1",
        activeSceneId: "default-c1",
        members: {
          c1: seedNames.map((name, i) => ({
            id: `m-c1-${i}`,
            name,
            sortIndex: i,
          })),
        },
        layouts: { "default-c1": [] },
        drawn: {},
        nextId: 1,
      };
    const save = (db: E2eDb) =>
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    const mint = (db: E2eDb) => `e2e-${db.nextId++}`;
    const arg = (args: Record<string, unknown> | undefined, key: string) =>
      (args ?? {})[key];

    /** The scene the active class lands on when no explicit scene is asked
     *  for — the class default (minted if missing, like the real heal). */
    const ensureDefaultScene = (
      db: E2eDb,
      cls: { id: string; name: string },
    ): E2eScene => {
      let scene = db.scenes.find((s) => s.id === defaultSceneId(cls.id));
      if (!scene) {
        scene = {
          id: defaultSceneId(cls.id),
          classId: cls.id,
          name: cls.name,
          sortIndex: 0,
          createdAt: 0,
        };
        db.scenes.push(scene);
        db.layouts[scene.id] ??= [];
      }
      return scene;
    };

    const snapshot = (
      db: E2eDb,
      cls: E2eDb["classes"][0],
      scene: E2eScene,
    ) => ({
      class: cls,
      scene,
      members: db.members[cls.id] ?? [],
      widgets: db.layouts[scene.id] ?? [],
    });

    const lessonSwitch = (
      db: E2eDb,
      classId: string,
      sceneId: string | null,
    ) => {
      const cls = db.classes.find((c) => c.id === classId);
      if (!cls) throw new Error("not_found");
      let scene: E2eScene;
      if (sceneId == null) {
        scene = ensureDefaultScene(db, cls);
      } else {
        const found = db.scenes.find((s) => s.id === sceneId);
        if (!found) throw new Error("not_found");
        if (found.classId != null && found.classId !== classId)
          throw new Error("validation");
        scene = found;
      }
      db.activeClassId = cls.id;
      db.activeSceneId = scene.id;
      if (db.settings) {
        db.settings.activeClassId = cls.id;
        db.settings.activeSceneId = scene.id;
      }
      save(db);
      return snapshot(db, cls, scene);
    };

    (window as unknown as Record<string, unknown>).__SUNDAYSCREEN_FIXTURES__ = {
      // The blob is stored WHOLE, like the real backend (F9-funn S8a) — a
      // stale frontend snapshot must be able to clobber it here too, or the
      // e2e tier cannot catch that bug class.
      settings_get: () => {
        const db = load();
        return {
          language: "no",
          snapEnabled: true,
          window: null,
          updateChannel: "stable",
          ...(db.settings ?? {}),
          activeClassId: db.activeClassId,
          activeSceneId: db.activeSceneId,
        };
      },
      settings_save: (args?: Record<string, unknown>) => {
        const db = load();
        const blob = (args?.settings ?? {}) as Record<string, unknown>;
        db.settings = blob;
        // Mirror the real clobber semantics: the blob's pointers win.
        if (
          typeof blob.activeClassId === "string" ||
          blob.activeClassId === null
        ) {
          db.activeClassId =
            (blob.activeClassId as string | null) ?? db.activeClassId;
        }
        if (
          typeof blob.activeSceneId === "string" ||
          blob.activeSceneId === null
        ) {
          db.activeSceneId =
            (blob.activeSceneId as string | null) ?? db.activeSceneId;
        }
        save(db);
        return blob;
      },
      update_check: { phase: "upToDate" },
      app_info: { name: "SundayScreen", version: "0.0.0-e2e" },

      class_ensure_active: (args?: Record<string, unknown>) => {
        const db = load();
        let found =
          db.classes.find((c) => c.id === db.activeClassId) ?? db.classes[0];
        if (!found) {
          // Like the real backend: bootstrap a default class (F9-funn S8c).
          found = {
            id: mint(db),
            name: String(arg(args, "defaultName") ?? "Min klasse"),
            sortIndex: 0,
            createdAt: 0,
          };
          db.classes.push(found);
          db.members[found.id] = [];
        }
        // Heal the scene pointer like the real resolve: keep it only when it
        // exists and is legal for this class.
        const pointed = db.scenes.find((s) => s.id === db.activeSceneId);
        const scene =
          pointed && (pointed.classId == null || pointed.classId === found.id)
            ? pointed
            : ensureDefaultScene(db, found);
        db.activeClassId = found.id;
        db.activeSceneId = scene.id;
        save(db);
        return { class: found, scene };
      },
      class_list: () => load().classes,
      class_create: (args?: Record<string, unknown>) => {
        const db = load();
        const cls = {
          id: mint(db),
          name: String(arg(args, "name")),
          sortIndex: db.classes.length,
          createdAt: db.classes.length,
        };
        db.classes.push(cls);
        db.members[cls.id] = [];
        ensureDefaultScene(db, cls);
        save(db);
        return cls;
      },
      class_rename: (args?: Record<string, unknown>) => {
        const db = load();
        const cls = db.classes.find((c) => c.id === arg(args, "classId"));
        if (!cls) throw new Error("not_found");
        cls.name = String(arg(args, "name"));
        save(db);
        return cls;
      },
      class_delete: (args?: Record<string, unknown>) => {
        const db = load();
        const id = String(arg(args, "classId"));
        db.classes = db.classes.filter((c) => c.id !== id);
        db.scenes = db.scenes.filter((s) => s.classId !== id);
        delete db.members[id];
        delete db.layouts[defaultSceneId(id)];
        if (db.activeClassId === id)
          db.activeClassId = db.classes[0]?.id ?? null;
        if (db.activeSceneId === defaultSceneId(id)) db.activeSceneId = null;
        save(db);
      },
      class_switch: (args?: Record<string, unknown>) =>
        lessonSwitch(load(), String(arg(args, "classId")), null),
      lesson_switch: (args?: Record<string, unknown>) =>
        lessonSwitch(
          load(),
          String(arg(args, "classId")),
          (arg(args, "sceneId") as string | null) ?? null,
        ),

      // ── Scenes ─────────────────────────────────────────────────────────
      scene_list: () => load().scenes.filter((s) => s.classId == null),
      scene_create: (args?: Record<string, unknown>) => {
        const db = load();
        const scene: E2eScene = {
          id: mint(db),
          classId: null,
          name: String(arg(args, "name")),
          sortIndex: db.scenes.length,
          createdAt: db.scenes.length,
        };
        db.scenes.push(scene);
        db.layouts[scene.id] = [];
        save(db);
        return scene;
      },
      scene_rename: (args?: Record<string, unknown>) => {
        const db = load();
        const scene = db.scenes.find((s) => s.id === arg(args, "sceneId"));
        if (!scene) throw new Error("not_found");
        if (scene.classId != null) throw new Error("validation");
        scene.name = String(arg(args, "name"));
        save(db);
        return scene;
      },
      scene_delete: (args?: Record<string, unknown>) => {
        const db = load();
        const id = String(arg(args, "sceneId"));
        const scene = db.scenes.find((s) => s.id === id);
        if (!scene) throw new Error("not_found");
        if (scene.classId != null) throw new Error("validation");
        db.scenes = db.scenes.filter((s) => s.id !== id);
        delete db.layouts[id];
        if (db.activeSceneId === id) db.activeSceneId = null;
        if (db.settings && db.settings.activeSceneId === id)
          db.settings.activeSceneId = null;
        save(db);
      },
      scene_duplicate: (args?: Record<string, unknown>) => {
        const db = load();
        const sourceId = String(arg(args, "sceneId"));
        if (!db.scenes.some((s) => s.id === sourceId))
          throw new Error("not_found");
        const copy: E2eScene = {
          id: mint(db),
          classId: null,
          name: String(arg(args, "name")),
          sortIndex: db.scenes.length,
          createdAt: db.scenes.length,
        };
        db.scenes.push(copy);
        db.layouts[copy.id] = (db.layouts[sourceId] ?? []).map((w) => ({
          ...(w as Record<string, unknown>),
          id: mint(db),
        }));
        save(db);
        return copy;
      },

      members_get: (args?: Record<string, unknown>) =>
        load().members[String(arg(args, "classId"))] ?? [],
      members_set: (args?: Record<string, unknown>) => {
        // Identity by (trimmed, case-folded) name, first-to-first, and the
        // drawn state of removed rows pruned — the REAL reconcile semantics
        // (F9-funn S8b), so no-repeat journeys assert true behaviour.
        const db = load();
        db.drawn ??= {};
        const classId = String(arg(args, "classId"));
        const names = ((arg(args, "names") as string[]) ?? [])
          .map((n) => n.trim())
          .filter((n) => n.length > 0);
        const freeIds = new Map<string, string[]>();
        for (const m of db.members[classId] ?? []) {
          const key = m.name.trim().toLowerCase();
          freeIds.set(key, [...(freeIds.get(key) ?? []), m.id]);
        }
        db.members[classId] = names.map((name, i) => {
          const key = name.toLowerCase();
          const queue = freeIds.get(key);
          const kept = queue?.shift();
          return { id: kept ?? mint(db), name, sortIndex: i };
        });
        const liveIds = new Set(db.members[classId].map((m) => m.id));
        db.drawn[classId] = (db.drawn[classId] ?? []).filter((id) =>
          liveIds.has(id),
        );
        save(db);
        return db.members[classId];
      },

      layout_load: (args?: Record<string, unknown>) =>
        load().layouts[String(arg(args, "sceneId"))] ?? [],
      layout_save: (args?: Record<string, unknown>) => {
        const db = load();
        db.layouts[String(arg(args, "sceneId"))] =
          (arg(args, "widgets") as unknown[]) ?? [];
        save(db);
      },

      // The draw is DETERMINISTIC here (first undrawn wins) — randomness is
      // the real backend's unit-tested job; journeys want stable answers.
      picker_draw: (args?: Record<string, unknown>) => {
        const db = load();
        db.drawn ??= {};
        const classId = String(arg(args, "classId"));
        const noRepeat = !!arg(args, "noRepeat");
        const members = db.members[classId] ?? [];
        if (members.length === 0) throw new Error("validation");
        const drawnIds = db.drawn[classId] ?? [];
        let pool = noRepeat
          ? members.filter((m) => !drawnIds.includes(m.id))
          : members;
        let reshuffled = false;
        if (noRepeat && pool.length === 0) {
          pool = members;
          db.drawn[classId] = [];
          reshuffled = true;
        }
        const member = pool[0];
        let remaining = members.length;
        if (noRepeat) {
          db.drawn[classId] = [...(db.drawn[classId] ?? []), member.id];
          remaining = pool.length - 1;
        }
        save(db);
        return { member, remaining, reshuffled };
      },
      picker_reset: (args?: Record<string, unknown>) => {
        const db = load();
        db.drawn ??= {};
        db.drawn[String(arg(args, "classId"))] = [];
        save(db);
      },
      groups_split: (args?: Record<string, unknown>) => {
        const db = load();
        const members = db.members[String(arg(args, "classId"))] ?? [];
        if (members.length === 0) throw new Error("validation");
        const mode = String(arg(args, "mode"));
        const n = Math.max(Number(arg(args, "n")) || 2, 1);
        const count =
          mode === "size"
            ? Math.ceil(members.length / n)
            : Math.min(n, members.length);
        const groups: (typeof members)[] = Array.from(
          { length: Math.max(count, 1) },
          () => [],
        );
        members.forEach((m, i) => groups[i % groups.length].push(m));
        return groups;
      },
    };
  }, opts.memberNames ?? []);
}

/**
 * Add a widget through the toolbar's add menu (R2 replaced the eight flat
 * buttons with one popover). `label` is the visible catalogue label, e.g.
 * "Tekst" or "Klokke".
 */
export async function addWidget(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Legg til verktøy" }).click();
  await page.getByRole("menuitem", { name: label }).click();
}
