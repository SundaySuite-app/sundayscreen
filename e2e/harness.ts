// The browser tier's fixture seam: a MINI BACKEND in the page, persisted in
// localStorage — which is what lets a journey RELOAD and find its classes,
// names, scenes and widgets again, exactly like the real SQLite store would.
// Deliberately dumb: no reconcile, no clamps — those are the REAL backend's
// unit-tested jobs; this store only has to be consistent enough for
// journeys.

import type { Page } from "@playwright/test";

import { LIMITS } from "../app/lib/limits.generated";

/** Install the standard fixture set. Call BEFORE page.goto("/").
 *  `memberNames` pre-seeds class 7B's name list.
 *
 *  The mini backend below runs INSIDE `page.addInitScript` — its function
 *  body is serialised and re-executed in the page, so it cannot `import`
 *  `limits.generated` itself (the browser has no access to this file, and a
 *  bundler-free `toString()` serialisation carries no closures). Rust's
 *  actual limits therefore travel in as the SECOND half of this one
 *  argument, next to `seedNames` — one argument-passing pattern, not two. */
export async function installFixtures(
  page: Page,
  opts: { memberNames?: string[] } = {},
): Promise<void> {
  await page.addInitScript(
    (init: { seedNames: string[]; limits: typeof LIMITS }) => {
      const { seedNames, limits } = init;
      const DB_KEY = "__e2e_db__";

      // Rust truncates text with `.chars().take(n)` — CODEPOINT counting.
      // JS `String.prototype.slice` counts UTF-16 CODE UNITS, which agrees
      // with Rust everywhere in the Basic Multilingual Plane but silently
      // diverges on anything outside it (emoji, some symbols): a 2-code-unit
      // surrogate pair would get sliced in half here while Rust keeps it
      // whole (or drops it whole), so a fixture could pass a case the real
      // backend fails, or vice versa. Spread into an array of CODE POINTS
      // first, matching `.chars()`.
      const charSlice = (s: string, n: number): string =>
        [...s].slice(0, n).join("");

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
          {
            id: string;
            name: string;
            sortIndex: number;
            /** Local wall date the pupil was marked away, mirroring the real
             *  `class_member.absent_on` (migration 0005). */
            absentOn?: string | null;
          }[]
        >;
        /** Keyed by SCENE id — the real schema's write key. */
        layouts: Record<string, unknown[]>;
        drawn?: Record<string, string[]>;
        settings?: Record<string, unknown>;
        periods?: {
          id: string;
          label: string;
          startMin: number;
          endMin: number;
          kind: string;
          sortIndex: number;
        }[];
        slots?: Record<
          string,
          { classId: string | null; subject: string; sceneId: string | null }
        >;
        overrides?: Record<
          string,
          {
            kind: string;
            classId: string | null;
            subject: string;
            sceneId: string | null;
            title: string;
          }
        >;
        agenda?: Record<
          string,
          {
            id: string;
            text: string;
            durationMin: number | null;
            done: boolean;
          }[]
        >;
        notes?: Record<string, { id: string; body: string }[]>;
        nextId: number;
      }

      const defaultSceneId = (classId: string) => `default-${classId}`;

      /** The two STABLE refusals from `commands/picker.rs`, verbatim — the
       *  widgets tell "add some names" from "everybody is away" on them. */
      const ERR_NO_MEMBERS = "validation: class has no members";
      const ERR_ALL_AWAY = "validation: all members are away";

      /** The real `list_present_members` filter: away = stamped with TODAY. */
      const present = <T extends { absentOn?: string | null }>(
        members: T[],
        today: unknown,
      ): T[] => members.filter((m) => !m.absentOn || m.absentOn !== today);

      const load = (): E2eDb =>
        (JSON.parse(
          localStorage.getItem(DB_KEY) ?? "null",
        ) as E2eDb | null) ?? {
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
              absentOn: null,
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

      (window as unknown as Record<string, unknown>).__SUNDAYSCREEN_FIXTURES__ =
        {
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
              // Rust's default is ON (ADR-014), and this base is spelled out
              // field by field — leave it out and `undefined` would render the
              // checkbox as OFF across the WHOLE e2e tier, i.e. the one place
              // that could have caught a defaults drift shows the drift as
              // normal.
              autoUpdate: true,
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
          /**
           * The narrow read-modify-write `commands/settings.rs::
           * set_window_for` performs — NOT `settings_save`'s whole-blob
           * clobber. Touching anything but the `window` key here would hide
           * exactly the bug R4-spor 3.3 fixed: a stale language/
           * updateChannel snapshot riding along on every window drag/resize
           * and every fullscreen toggle. Was MISSING from this fixture map
           * entirely until now (E2-1's neighbourhood) — a journey exercising
           * `settingsSetWindow` fell through to the real `tauriInvoke`,
           * which rejects outside Tauri, so the whole path was silently
           * untested at this tier.
           *
           * Clamps w/h to the same floor `Settings::validate` enforces
           * (`MIN_WINDOW_W`/`MIN_WINDOW_H`, settings.rs) and echoes back the
           * CLAMPED value, exactly like the real command's return type
           * promises — callers adopt the answer, never what they sent. The
           * other half of `validate` (dropping a non-finite/absurd geometry
           * outright) is the real backend's own unit-tested job and not
           * reproduced here; only the floor is load-bearing for a journey.
           * The two constants are hand-copied, not sourced from
           * `limits.generated` — that generator only scans layout.rs/
           * schedule.rs/members.rs (see scripts/gen-limits.mjs's own module
           * doc), and settings.rs's window bounds sit outside that list —
           * same reason NAME_MAX_CHARS=80 is hand-copied a few lines up in
           * `scene_create`.
           */
          settings_set_window: (args?: Record<string, unknown>) => {
            const MIN_WINDOW_W = 960;
            const MIN_WINDOW_H = 600;
            const db = load();
            const raw = (arg(args, "window") ?? {}) as {
              x: number;
              y: number;
              w: number;
              h: number;
              fullscreen: boolean;
            };
            const clamped = {
              ...raw,
              w: Math.max(raw.w, MIN_WINDOW_W),
              h: Math.max(raw.h, MIN_WINDOW_H),
            };
            db.settings ??= {};
            db.settings.window = clamped;
            save(db);
            return clamped;
          },
          update_check: { phase: "upToDate" },
          app_info: { name: "SundayScreen", version: "0.0.0-e2e" },
          // The two "how did the boot go" reads. `null` is the HEALTHY answer to
          // both — nothing went wrong, and the silent boot check has not found an
          // update — and a journey that wants either one overwrites just this key
          // with `addInitScript` (see boot.spec / update.spec).
          boot_fault: null,
          update_pending: null,

          class_ensure_active: (args?: Record<string, unknown>) => {
            const db = load();
            let found =
              db.classes.find((c) => c.id === db.activeClassId) ??
              db.classes[0];
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
              pointed &&
              (pointed.classId == null || pointed.classId === found.id)
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
            // Migration 0004 cascades class_id on week_slot/date_override; the
            // fake used to keep them and diverge from the real backend.
            for (const [key, slot] of Object.entries(db.slots ?? {})) {
              if (slot.classId === id) delete db.slots![key];
            }
            for (const [key, ovr] of Object.entries(db.overrides ?? {})) {
              if (ovr.classId === id) delete db.overrides![key];
            }
            if (db.activeClassId === id)
              db.activeClassId = db.classes[0]?.id ?? null;
            if (db.activeSceneId === defaultSceneId(id))
              db.activeSceneId = null;
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
            // The 80 here is commands::scenes::NAME_MAX_CHARS (scene/class
            // names) — NOT one of the generated `limits.*`, which never
            // harvests that separate constant; only the codepoint-safe slicing
            // is shared with the rest of this file.
            const name = charSlice(String(arg(args, "name")).trim(), 80);
            if (name === "") throw new Error("validation");
            const scene: E2eScene = {
              id: mint(db),
              classId: null,
              name,
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
            // ON DELETE SET NULL in 0004: pointers to a dead scene fall back to
            // the class default rather than dangling.
            for (const slot of Object.values(db.slots ?? {})) {
              if (slot.sceneId === id) slot.sceneId = null;
            }
            for (const ovr of Object.values(db.overrides ?? {})) {
              if (ovr.sceneId === id) ovr.sceneId = null;
            }
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

          // ── Planner (samme skygge-semantikk som backend) ────────────────
          planner_periods_get: () => load().periods ?? [],
          planner_periods_set: (args?: Record<string, unknown>) => {
            const db = load();
            const specs =
              (arg(args, "periods") as {
                id: string | null;
                label: string;
                startMin: number;
                endMin: number;
                kind: string;
              }[]) ?? [];
            const sorted = [...specs].sort((a, b) => a.startMin - b.startMin);
            for (let i = 1; i < sorted.length; i++) {
              if (sorted[i].startMin < sorted[i - 1].endMin)
                throw new Error("validation");
            }
            const keep = new Set(
              sorted.map((s) => s.id).filter((x): x is string => x != null),
            );
            // Cascade: slots/agenda for dropped periods die.
            for (const key of Object.keys(db.slots ?? {})) {
              const pid = key.split(":")[1];
              if (!keep.has(pid)) delete db.slots![key];
            }
            for (const key of Object.keys(db.agenda ?? {})) {
              const pid = key.split(":")[1];
              if (!keep.has(pid)) delete db.agenda![key];
            }
            db.periods = sorted.map((s, i) => ({
              id: s.id ?? mint(db),
              label: s.label,
              startMin: s.startMin,
              endMin: s.endMin,
              kind: s.kind,
              sortIndex: i,
            }));
            save(db);
            return db.periods;
          },
          planner_week_get: () => {
            const db = load();
            return Object.entries(db.slots ?? {}).map(([key, v]) => {
              const [weekday, periodId] = key.split(":");
              return { id: key, weekday: Number(weekday), periodId, ...v };
            });
          },
          planner_slot_set: (args?: Record<string, unknown>) => {
            const db = load();
            db.slots ??= {};
            const key = `${Number(arg(args, "weekday"))}:${String(arg(args, "periodId"))}`;
            const slot = arg(args, "slot") as {
              classId: string | null;
              subject: string;
              sceneId: string | null;
            } | null;
            if (slot == null) delete db.slots[key];
            else db.slots[key] = slot;
            save(db);
          },
          planner_override_set: (args?: Record<string, unknown>) => {
            const db = load();
            db.overrides ??= {};
            const key = `${String(arg(args, "date"))}:${String(arg(args, "periodId"))}`;
            const ovr = arg(args, "ovr") as {
              kind: string;
              classId: string | null;
              subject: string;
              sceneId: string | null;
              title: string;
            } | null;
            if (ovr == null) delete db.overrides[key];
            else db.overrides[key] = ovr;
            save(db);
          },
          planner_day_get: (args?: Record<string, unknown>) => {
            const db = load();
            const date = String(arg(args, "date"));
            const weekday = Number(arg(args, "weekday"));
            const className = (id: string | null) =>
              db.classes.find((c) => c.id === id)?.name ?? null;
            const sceneName = (id: string | null) =>
              db.scenes.find((s) => s.id === id)?.name ?? null;
            const entries = (db.periods ?? []).map((p) => {
              let lesson = null;
              if (p.kind !== "break") {
                const ovr = (db.overrides ?? {})[`${date}:${p.id}`];
                if (ovr) {
                  lesson =
                    ovr.kind === "cancelled"
                      ? null
                      : {
                          classId: ovr.classId,
                          className: className(ovr.classId),
                          subject: ovr.subject,
                          sceneId: ovr.sceneId,
                          sceneName: sceneName(ovr.sceneId),
                          title: ovr.title,
                          overridden: true,
                        };
                } else {
                  const slot = (db.slots ?? {})[`${weekday}:${p.id}`];
                  if (slot && (slot.classId || slot.subject)) {
                    lesson = {
                      classId: slot.classId,
                      className: className(slot.classId),
                      subject: slot.subject,
                      sceneId: slot.sceneId,
                      sceneName: sceneName(slot.sceneId),
                      title: "",
                      overridden: false,
                    };
                  }
                }
              }
              const agenda = ((db.agenda ?? {})[`${date}:${p.id}`] ?? []).map(
                (a, i) => ({ ...a, date, periodId: p.id, sortIndex: i }),
              );
              return { period: p, lesson, agenda };
            });
            const notes = ((db.notes ?? {})[date] ?? []).map((n, i) => ({
              ...n,
              date,
              sortIndex: i,
            }));
            return { date, weekday, entries, notes };
          },
          planner_agenda_set: (args?: Record<string, unknown>) => {
            const db = load();
            db.agenda ??= {};
            const date = String(arg(args, "date"));
            const periodId = String(arg(args, "periodId"));
            // Mirror the core's normalize_agenda clamps (item count, text
            // length, duration range) FROM THE ARGUMENT — sourced from Rust via
            // limits.generated, not retyped here — so the fake cannot hide a
            // real truncation.
            const items = (
              (arg(args, "items") as {
                id: string | null;
                text: string;
                durationMin: number | null;
                done: boolean;
              }[]) ?? []
            )
              .slice(0, limits.AGENDA_MAX_ITEMS)
              .map((i) => ({
                ...i,
                id: i.id ?? mint(db),
                text: charSlice(i.text, limits.TEXT_MAX_CHARS),
                durationMin:
                  i.durationMin == null
                    ? null
                    : Math.min(
                        Math.max(i.durationMin, limits.AGENDA_DURATION_MIN),
                        limits.AGENDA_DURATION_MAX,
                      ),
              }));
            db.agenda[`${date}:${periodId}`] = items;
            save(db);
            return items.map((a, i) => ({
              ...a,
              date,
              periodId,
              sortIndex: i,
            }));
          },
          planner_agenda_check: (args?: Record<string, unknown>) => {
            const db = load();
            const id = String(arg(args, "itemId"));
            for (const list of Object.values(db.agenda ?? {})) {
              const hit = list.find((a) => a.id === id);
              if (hit) {
                hit.done = !!arg(args, "done");
                save(db);
                return;
              }
            }
            throw new Error("not_found");
          },
          planner_notes_set: (args?: Record<string, unknown>) => {
            const db = load();
            db.notes ??= {};
            const date = String(arg(args, "date"));
            const notes = (
              (arg(args, "notes") as { id: string | null; body: string }[]) ??
              []
            )
              .slice(0, limits.NOTES_MAX)
              .map((n) => ({
                ...n,
                id: n.id ?? mint(db),
                body: charSlice(n.body, limits.TEXT_MAX_CHARS),
              }));
            db.notes[date] = notes;
            save(db);
            return notes.map((n, i) => ({ ...n, date, sortIndex: i }));
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
            // Mirrors `members::clean_name` + `reconcile` EXACTLY (F9-funn
            // S8b's neighbourhood): trim, drop empties, truncate each
            // survivor to NAME_MAX_CHARS codepoints, THEN cap the list at
            // MEMBERS_MAX — same order Rust runs them in. Before this the
            // fixture kept every name whole and unbounded, so a journey
            // pasting a too-long name or a too-long list saw a class the
            // real backend would never have stored.
            const names = ((arg(args, "names") as string[]) ?? [])
              .map((n) => n.trim())
              .filter((n) => n.length > 0)
              .map((n) => charSlice(n, limits.NAME_MAX_CHARS))
              .slice(0, limits.MEMBERS_MAX);
            const freeIds = new Map<string, string[]>();
            const wasAway = new Map<string, string | null>();
            for (const m of db.members[classId] ?? []) {
              const key = m.name.trim().toLowerCase();
              freeIds.set(key, [...(freeIds.get(key) ?? []), m.id]);
              wasAway.set(m.id, m.absentOn ?? null);
            }
            db.members[classId] = names.map((name, i) => {
              const key = name.toLowerCase();
              const queue = freeIds.get(key);
              const kept = queue?.shift();
              return {
                id: kept ?? mint(db),
                name,
                sortIndex: i,
                // The real UPDATE never touches `absent_on`: editing the name
                // list must not un-mark today's absences.
                absentOn: kept ? (wasAway.get(kept) ?? null) : null,
              };
            });
            const liveIds = new Set(db.members[classId].map((m) => m.id));
            db.drawn[classId] = (db.drawn[classId] ?? []).filter((id) =>
              liveIds.has(id),
            );
            save(db);
            return db.members[classId];
          },

          // ── «Flytt oppsettet» ──────────────────────────────────────────
          //
          // The real pair opens a NATIVE file dialog and touches the disk,
          // both of which are invisible to Playwright BY CONSTRUCTION — that
          // is the whole point of keeping the plugin Rust-side. So the fake
          // answers with a fixed path and a fixed receipt: what these
          // journeys can actually check is the FRONTEND's half — the
          // flush-before-export, the receipt sentence, the reload of the
          // class and scene menus, and one distinct message per refusal.
          //
          // A spec that wants a refusal overwrites just `transfer_import`
          // with `addInitScript` (see transfer.spec.ts). The mini backend is
          // deliberately NOT re-implementing the remap: a fake with its own
          // idea of the import semantics is the seam bug this house keeps
          // finding, and the Rust tests own that half.
          transfer_export: (args?: Record<string, unknown>) =>
            `/Users/e2e/Documents/${String(arg(args, "suggestedName"))}`,
          transfer_import: () => {
            // A symbolic ONE class + ONE global scene — not the real remap
            // (the Rust integration tests own that half, per the module doc
            // above), but enough that `loadClasses()`/`loadScenes()` after a
            // successful import have something NEW to reveal. Before this,
            // every import journey saw the exact two menus it started with,
            // so a deleted `loadClasses()` call in `runImport` (E2-6) was
            // invisible at this tier — the receipt could say "2 klasser" and
            // the class switcher would never grow.
            const db = load();
            const cls = {
              id: mint(db),
              name: "Importert klasse",
              sortIndex: db.classes.length,
              createdAt: db.classes.length,
            };
            db.classes.push(cls);
            db.members[cls.id] = [];
            ensureDefaultScene(db, cls);
            const scene: E2eScene = {
              id: mint(db),
              classId: null,
              name: "Importert skjerm",
              sortIndex: db.scenes.length,
              createdAt: db.scenes.length,
            };
            db.scenes.push(scene);
            db.layouts[scene.id] = [];
            save(db);
            return {
              outcome: "imported",
              classes: 2,
              scenes: 3,
              members: 47,
              plannerImported: false,
              // The default answer is the INTERESTING one: this machine
              // already had a school day, so the week plan stayed behind and
              // the receipt has to say so.
              plannerSkipped: true,
              fileAppVersion: "0.0.0-e2e",
            };
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
          //
          // Everything else is mirrored EXACTLY, and deliberately so: the
          // present-only pool, the two DISTINCT refusals, the clamp on `n`,
          // and — the one that matters most — the reshuffle-with-exclusion
          // when a round runs dry in the MIDDLE of a multi-name draw. A
          // kinder fake here would let an e2e assert a semantics the app does
          // not actually have, which is the seam-bug shape this house has
          // been bitten by before.
          picker_draw_many: (args?: Record<string, unknown>) => {
            const db = load();
            db.drawn ??= {};
            const classId = String(arg(args, "classId"));
            const noRepeat = !!arg(args, "noRepeat");
            const n = Math.min(
              Math.max(
                Number(arg(args, "n")) || limits.PICK_N_MIN,
                limits.PICK_N_MIN,
              ),
              limits.PICK_N_MAX,
            );
            const all = db.members[classId] ?? [];
            if (all.length === 0) throw new Error(ERR_NO_MEMBERS);
            const members = present(all, arg(args, "today"));
            if (members.length === 0) throw new Error(ERR_ALL_AWAY);

            const drawnIds = noRepeat ? (db.drawn[classId] ?? []) : [];
            let pool = members.filter((m) => !drawnIds.includes(m.id));
            let reshuffled = false;
            if (pool.length === 0 && members.length > 0) {
              pool = [...members];
              reshuffled = true;
            }
            const openingLen = pool.length;

            const chosen: typeof members = [];
            for (let i = 0; i < n; i++) {
              if (pool.length === 0) {
                // The round ran dry mid-draw. Restart it — WITHOUT the
                // pupils this very draw already took.
                const fresh = members.filter(
                  (m) => !chosen.some((c) => c.id === m.id),
                );
                if (fresh.length === 0) break;
                pool = fresh;
                reshuffled = true;
              }
              const next = pool.shift();
              if (!next) break;
              chosen.push(next);
            }

            const roundSize = reshuffled ? members.length : openingLen;
            let remaining = members.length;
            if (noRepeat) {
              if (reshuffled) db.drawn[classId] = [];
              db.drawn[classId] = [
                ...(db.drawn[classId] ?? []),
                ...chosen.map((m) => m.id),
              ];
              remaining = Math.max(roundSize - chosen.length, 0);
            }
            save(db);
            return { members: chosen, remaining, reshuffled };
          },
          picker_reset: (args?: Record<string, unknown>) => {
            const db = load();
            db.drawn ??= {};
            db.drawn[String(arg(args, "classId"))] = [];
            save(db);
          },
          attendance_set: (args?: Record<string, unknown>) => {
            const db = load();
            const classId = String(arg(args, "classId"));
            const memberId = String(arg(args, "memberId"));
            const today = String(arg(args, "today"));
            const hit = (db.members[classId] ?? []).find(
              (m) => m.id === memberId,
            );
            // A miss REJECTS, exactly like the real command (promise 4).
            if (!hit) throw new Error("not_found");
            hit.absentOn = arg(args, "absent") ? today : null;
            save(db);
            return db.members[classId];
          },
          groups_split: (args?: Record<string, unknown>) => {
            const db = load();
            const all = db.members[String(arg(args, "classId"))] ?? [];
            if (all.length === 0) throw new Error(ERR_NO_MEMBERS);
            const members = present(all, arg(args, "today"));
            if (members.length === 0) throw new Error(ERR_ALL_AWAY);
            const mode = String(arg(args, "mode"));
            // GROUP_N_MIN/MAX, not a hand-copied "2"/"1" (E2-21): the real
            // `groups_split` command is itself lenient (`group_count` only
            // floors `n` at 1, then clamps the group COUNT to the member
            // count — see crates/sundayscreen-core/src/groups.rs), so this
            // pair is not something the backend enforces at the seam. It is
            // what GroupsWidget.tsx's own stepper is bounded by, though —
            // nothing that reaches this fixture through the real UI can ever
            // ask for less than GROUP_N_MIN or more than GROUP_N_MAX — and a
            // second, undocumented "2"/"1" here was free to drift from that
            // one source, the exact seam-bug shape this file guards against
            // everywhere else.
            const n = Math.min(
              Math.max(
                Number(arg(args, "n")) || limits.GROUP_N_MIN,
                limits.GROUP_N_MIN,
              ),
              limits.GROUP_N_MAX,
            );
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
    },
    { seedNames: opts.memberNames ?? [], limits: LIMITS },
  );
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
