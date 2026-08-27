// The browser tier's fixture seam: a MINI BACKEND in the page, persisted in
// localStorage — which is what lets a journey RELOAD and find its classes,
// names and widgets again, exactly like the real SQLite store would.
// Deliberately dumb: no reconcile, no clamps — those are the REAL backend's
// unit-tested jobs; this store only has to be consistent enough for
// journeys.

import type { Page } from "@playwright/test";

/** Install the standard fixture set. Call BEFORE page.goto("/"). */
export async function installFixtures(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const DB_KEY = "__e2e_db__";

    interface E2eDb {
      classes: {
        id: string;
        name: string;
        sortIndex: number;
        createdAt: number;
      }[];
      activeClassId: string | null;
      members: Record<
        string,
        { id: string; name: string; sortIndex: number }[]
      >;
      layouts: Record<string, unknown[]>;
      nextId: number;
    }

    const load = (): E2eDb =>
      (JSON.parse(localStorage.getItem(DB_KEY) ?? "null") as E2eDb | null) ?? {
        classes: [{ id: "c1", name: "7B", sortIndex: 0, createdAt: 1 }],
        activeClassId: "c1",
        members: { c1: [] },
        layouts: { c1: [] },
        nextId: 1,
      };
    const save = (db: E2eDb) =>
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    const mint = (db: E2eDb) => `e2e-${db.nextId++}`;
    const arg = (args: Record<string, unknown> | undefined, key: string) =>
      (args ?? {})[key];

    (window as unknown as Record<string, unknown>).__SUNDAYSCREEN_FIXTURES__ = {
      settings_get: () => {
        const db = load();
        return {
          language: "no",
          activeClassId: db.activeClassId,
          snapEnabled: true,
          window: null,
        };
      },
      settings_save: (args?: Record<string, unknown>) => args?.settings,
      app_info: { name: "SundayScreen", version: "0.0.0-e2e" },

      class_ensure_active: () => {
        const db = load();
        const found =
          db.classes.find((c) => c.id === db.activeClassId) ?? db.classes[0];
        db.activeClassId = found.id;
        save(db);
        return found;
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
        db.layouts[cls.id] = [];
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
        delete db.members[id];
        delete db.layouts[id];
        if (db.activeClassId === id)
          db.activeClassId = db.classes[0]?.id ?? null;
        save(db);
      },
      class_switch: (args?: Record<string, unknown>) => {
        const db = load();
        const cls = db.classes.find((c) => c.id === arg(args, "classId"));
        if (!cls) throw new Error("not_found");
        db.activeClassId = cls.id;
        save(db);
        return {
          class: cls,
          members: db.members[cls.id] ?? [],
          widgets: db.layouts[cls.id] ?? [],
        };
      },

      members_get: (args?: Record<string, unknown>) =>
        load().members[String(arg(args, "classId"))] ?? [],
      members_set: (args?: Record<string, unknown>) => {
        const db = load();
        const classId = String(arg(args, "classId"));
        const names = ((arg(args, "names") as string[]) ?? [])
          .map((n) => n.trim())
          .filter((n) => n.length > 0);
        db.members[classId] = names.map((name, i) => ({
          id: `m-${classId}-${i}`,
          name,
          sortIndex: i,
        }));
        save(db);
        return db.members[classId];
      },

      layout_load: (args?: Record<string, unknown>) =>
        load().layouts[String(arg(args, "classId"))] ?? [],
      layout_save: (args?: Record<string, unknown>) => {
        const db = load();
        db.layouts[String(arg(args, "classId"))] =
          (arg(args, "widgets") as unknown[]) ?? [];
        save(db);
      },
    };
  });
}
