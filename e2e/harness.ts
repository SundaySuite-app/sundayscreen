// The browser tier's fixture seam: a MINI BACKEND in the page, persisted in
// localStorage — which is what lets a journey RELOAD and find its classes,
// names and widgets again, exactly like the real SQLite store would.
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
      drawn?: Record<string, string[]>;
      nextId: number;
    }

    const load = (): E2eDb =>
      (JSON.parse(localStorage.getItem(DB_KEY) ?? "null") as E2eDb | null) ?? {
        classes: [{ id: "c1", name: "7B", sortIndex: 0, createdAt: 1 }],
        activeClassId: "c1",
        members: {
          c1: seedNames.map((name, i) => ({
            id: `m-c1-${i}`,
            name,
            sortIndex: i,
          })),
        },
        layouts: { c1: [] },
        drawn: {},
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
          updateChannel: "stable",
        };
      },
      update_check: { phase: "upToDate" },
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
