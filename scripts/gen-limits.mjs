// The limit numbers guarded here (count grows with the const list) (font-scale bounds, text-length caps,
// item counts, a duration range…) used to exist ONCE in Rust and then again,
// by hand, wherever the frontend needed the same number — a widget's
// stepper, a maxLength attribute, the e2e harness's fake backend. Nothing
// noticed when a Rust number changed and its TypeScript twin did not; that
// is exactly the seam-bug shape `reference-seam-bugs` describes. This
// script parses the `pub const` declarations directly out of the three
// crate files that own them and regenerates `app/lib/limits.generated.ts`
// as the ONE place the frontend reads them from.
//
//   node scripts/gen-limits.mjs           regenerate the committed file
//   node scripts/gen-limits.mjs --check   regenerate IN MEMORY, diff against
//                                         the committed file, exit 1 on
//                                         drift (this is `npm run limits:check`,
//                                         wired into `npm run check` — a pure
//                                         text comparison, no build involved)
//
// Parsing rules — each one earned by a real shape in these 24 numbers:
//   - only a line matching `pub const NAME: TYPE = VALUE;` is read (TYPE one
//     of f64/u32/u8/u64/i32/i64/usize); doc comments, private consts and
//     functions are invisible to this script on purpose.
//   - VALUE may carry Rust's `_` digit-group separators (`10_000`,
//     `86_400_000.0`) — stripped before parsing.
//   - VALUE may carry a trailing line comment AFTER the `;`
//     (`= 86_400_000.0; // 24 h`) — irrelevant here because the capture
//     stops at the semicolon, never reaching the comment.
//   - usize/u32/f64 all collapse to a plain TS `number` literal — the Rust
//     TYPE is not preserved, but the VALUE must survive EXACTLY (`6.0`
//     becomes `6`, the same number, never a different one).
//   - a VALUE that is not a bare numeric literal is an EXPRESSION
//     (`DAY_MIN`'s `24 * 60` in schedule.rs). This script does NOT evaluate
//     expressions — doing the arithmetic in JS would silently duplicate
//     Rust's, and rot the moment either side changed the expression's
//     SHAPE rather than its inputs. Instead: every constant name known to
//     hold an expression TODAY is listed in EXPRESSION_SKIP below with the
//     exact expression text expected. A `pub const` whose value is neither
//     a numeric literal nor a recognised, unchanged skip entry makes this
//     script THROW — a silent wrong parse is worse than a loud stop. A skip
//     entry that no longer matches anything (the constant was renamed or
//     removed) also throws, so the list cannot rot quietly in the other
//     direction either.
//   - two constants sharing a NAME is a collision in the flat output
//     object and throws, regardless of whether the values happen to agree
//     (`TEXT_MAX_CHARS` in schedule.rs and `TEXT_CONTENT_MAX_CHARS` in
//     layout.rs are DIFFERENT names on purpose — see the module docs on
//     each file for why they must stay free to drift apart).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(root, "app/lib/limits.generated.ts");
const CHECK = process.argv.includes("--check");

// Relative to `root` — also what ends up in the generated file's grouping
// comments, so keep these the paths a reader would actually go look at.
const SOURCE_FILES = [
  "crates/sundayscreen-core/src/layout.rs",
  "crates/sundayscreen-core/src/schedule.rs",
  "crates/sundayscreen-core/src/members.rs",
];

// Constant name → the exact expression text it is known to hold today.
// Anything not a bare numeric literal MUST be listed here or the script
// refuses to guess (see the module doc above).
const EXPRESSION_SKIP = {
  // Minutes in a day. The frontend has never needed this AS a number (it
  // mints its own dates/times from `Date`); the constant exists in Rust as
  // an internal clamp bound. Recompute it by hand (24 * 60 = 1440) if a
  // consumer ever needs it — do not teach this script to evaluate Rust.
  DAY_MIN: "24 * 60",
};

const CONST_RE =
  /^[ \t]*pub const ([A-Za-z0-9_]+): (f64|u32|u8|u64|i32|i64|usize) = ([^;]+);/gm;

/** A bare Rust numeric literal, underscores and all — or `null` for
 *  anything else (an expression). */
function parseNumericLiteral(raw) {
  const stripped = raw.trim().replace(/_/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(stripped)) return null;
  const n = Number(stripped);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** name → { value, file } for every constant this run resolved to a
 *  number; also tracks which EXPRESSION_SKIP entries were actually seen, so
 *  a stale entry (constant renamed/removed) is caught too. */
function collectConstants() {
  /** @type {Map<string, { value: number, file: string }>} */
  const found = new Map();
  /** @type {Map<string, string>} file label → ordered list of names, for
   *  rendering groups in declaration order. */
  const byFile = new Map();
  const seenSkipNames = new Set();

  for (const relPath of SOURCE_FILES) {
    const abs = join(root, relPath);
    const src = readFileSync(abs, "utf8");
    const names = [];
    byFile.set(relPath, names);

    for (const m of src.matchAll(CONST_RE)) {
      const [, name, , rawValue] = m;
      const num = parseNumericLiteral(rawValue);

      if (num === null) {
        const expected = EXPRESSION_SKIP[name];
        const actual = rawValue.trim();
        if (expected === undefined) {
          throw new Error(
            `gen-limits: "${name}" in ${relPath} has a non-literal value ` +
              `("${actual}") this script does not know how to skip. Either ` +
              `make it a plain numeric literal, or add "${name}": "${actual}" ` +
              `to EXPRESSION_SKIP in scripts/gen-limits.mjs — after confirming ` +
              `nothing downstream actually needs its numeric value.`,
          );
        }
        if (expected !== actual) {
          throw new Error(
            `gen-limits: "${name}" in ${relPath} was recorded in ` +
              `EXPRESSION_SKIP as "${expected}" but now reads "${actual}" — ` +
              `a changed expression needs a human to re-check whether it is ` +
              `still safe to skip, not a silent pass. Update EXPRESSION_SKIP ` +
              `once that check is done.`,
          );
        }
        seenSkipNames.add(name);
        continue; // deliberately excluded from the output object
      }

      const existing = found.get(name);
      if (existing) {
        throw new Error(
          `gen-limits: "${name}" is declared as a pub const in both ` +
            `${existing.file} and ${relPath}. The output object is flat — ` +
            `give one of them a distinct name (this is a real collision, not ` +
            `something this script can paper over).`,
        );
      }
      found.set(name, { value: num, file: relPath });
      names.push(name);
    }
  }

  const staleSkips = Object.keys(EXPRESSION_SKIP).filter(
    (name) => !seenSkipNames.has(name),
  );
  if (staleSkips.length > 0) {
    throw new Error(
      `gen-limits: EXPRESSION_SKIP names a constant that no longer exists as ` +
        `a non-literal pub const: ${staleSkips.join(", ")}. Either it was ` +
        `renamed/removed (delete the stale entry) or it became a plain ` +
        `numeric literal (also delete the entry — it belongs in the output ` +
        `now).`,
    );
  }

  return { found, byFile };
}

function renderOutput({ found, byFile }) {
  const lines = [];
  lines.push(
    "// GENERATED — kjør npm run limits. Do not edit by hand.",
    "//",
    "// Parsed by scripts/gen-limits.mjs from the `pub const` limit",
    "// declarations in the crate files named below — THOSE are the",
    "// authority; this file is their one TypeScript mirror. `npm run",
    "// limits:check` (part of `npm run check`) fails the moment this file",
    "// drifts from a fresh parse of the Rust source.",
    "",
    "export const LIMITS = {",
  );
  let firstGroup = true;
  for (const [relPath, names] of byFile) {
    if (names.length === 0) continue;
    if (!firstGroup) lines.push("");
    firstGroup = false;
    lines.push(`  // ${relPath}`);
    for (const name of names) {
      const { value } = found.get(name);
      lines.push(`  ${name}: ${JSON.stringify(value)},`);
    }
  }
  lines.push("} as const;", "");
  return lines.join("\n");
}

const { found, byFile } = collectConstants();
const output = renderOutput({ found, byFile });

if (CHECK) {
  if (!existsSync(OUT_PATH)) {
    console.error(
      `✗ ${relative(root, OUT_PATH)} does not exist — run \`npm run limits\` to create it.`,
    );
    process.exit(1);
  }
  const onDisk = readFileSync(OUT_PATH, "utf8");
  if (onDisk !== output) {
    console.error(
      `✗ ${relative(root, OUT_PATH)} is stale — it does not match a fresh parse ` +
        `of the ${SOURCE_FILES.length} Rust source files.`,
    );
    console.error("  Run `npm run limits` and commit the result.");
    process.exit(1);
  }
  console.log(
    `✓ ${relative(root, OUT_PATH)} matches a fresh parse of the Rust limits (${found.size} constants).`,
  );
  process.exit(0);
}

writeFileSync(OUT_PATH, output);
console.log(
  `✓ wrote ${relative(root, OUT_PATH)} (${found.size} constants from ${SOURCE_FILES.length} files)`,
);
