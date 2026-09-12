/**
 * Postinstall patch: make typescript-eslint resolve to @typescript/typescript6
 * instead of the root typescript@7. TypeScript 7 removed the JS compiler API
 * that typescript-eslint relies on; @typescript/typescript6 provides the TS 6
 * API as a separate package. We can't use npm `overrides` because the root
 * `typescript` is hoisted to every nested `require("typescript")`.
 *
 * This script creates a nested `node_modules/typescript` symlink inside each
 * package that does `require("typescript")`, pointing to
 * `@typescript/typescript6`. It is idempotent and safe to re-run.
 *
 * Tripwire: `--check` verifies the patch actually applied and exits 1 with an
 * actionable message when a nested link is missing or points at the wrong
 * target — CI runs it right after every patch step so a silently skipped
 * patch fails loudly instead of surfacing as an opaque lint error.
 *
 * Tracked for removal: https://github.com/luongnv89/asm/issues/699
 * Delete this file once typescript-eslint supports TypeScript 7 natively.
 */
const { resolve, join, relative } = require("node:path");
const {
  symlinkSync,
  mkdirSync,
  existsSync,
  readlinkSync,
  lstatSync,
  realpathSync,
  readFileSync,
} = require("node:fs");

const TS6_PKG = "node_modules/@typescript/typescript6";

// Packages that `require("typescript")` and need the TS 6 API.
const TARGETS = [
  "typescript-eslint",
  "@typescript-eslint/eslint-plugin",
  "@typescript-eslint/parser",
  "@typescript-eslint/type-utils",
  "@typescript-eslint/typescript-estree",
  "@typescript-eslint/utils",
  "ts-api-utils",
];

// Nested `node_modules/typescript` paths for the targets actually installed
// under `root` — mirrors the apply loop's `existsSync(targetDir)` filter.
function expectedLinks(root) {
  return TARGETS.filter((target) =>
    existsSync(join(root, "node_modules", target)),
  ).map((target) =>
    join(root, "node_modules", target, "node_modules", "typescript"),
  );
}

/**
 * Verify the patch applied under `root`: every expected nested link must
 * resolve to @typescript/typescript6. A real directory containing a
 * typescript@6 install (npm `overrides` materializing the alias) also counts.
 * Returns a list of human-readable failures; empty means the patch is good.
 */
function checkPatch(root) {
  const ts6Path = join(root, TS6_PKG);
  if (!existsSync(ts6Path)) {
    return [`${TS6_PKG} is not installed under ${root}`];
  }
  const ts6Real = realpathSync(ts6Path);
  const failures = [];
  for (const linkPath of expectedLinks(root)) {
    const rel = relative(root, linkPath);
    if (!existsSync(linkPath)) {
      failures.push(`${rel}: missing`);
      continue;
    }
    try {
      if (realpathSync(linkPath) === ts6Real) continue;
    } catch {
      // unreadable — fall through to the version probe
    }
    try {
      const version = JSON.parse(
        readFileSync(join(linkPath, "package.json"), "utf8"),
      ).version;
      if (typeof version === "string" && version.split(".")[0] === "6")
        continue;
      failures.push(`${rel}: points at typescript@${version}`);
    } catch {
      failures.push(`${rel}: not a symlink to @typescript/typescript6`);
    }
  }
  return failures;
}

function applyPatch(root) {
  const ts6Path = join(root, TS6_PKG);

  if (!existsSync(ts6Path)) {
    console.log("patch-ts6: @typescript/typescript6 not found, skipping");
    return 0;
  }

  let patched = 0;
  for (const target of TARGETS) {
    const targetDir = join(root, "node_modules", target);
    if (!existsSync(targetDir)) continue;

    const nestedMods = join(targetDir, "node_modules");
    const linkPath = join(nestedMods, "typescript");

    // Skip if already a correct symlink
    if (existsSync(linkPath)) {
      try {
        const existing = readlinkSync(linkPath);
        if (existing === ts6Path || existing === "@typescript/typescript6") {
          patched++;
          continue;
        }
      } catch {
        // Not a symlink — fall through to replace
      }
    }

    mkdirSync(nestedMods, { recursive: true });
    // Remove existing file/dir/symlink
    if (existsSync(linkPath)) {
      try {
        const fs = require("node:fs");
        let isDir = false;
        try {
          isDir = lstatSync(linkPath).isDirectory() && !readlinkSync(linkPath);
        } catch {
          isDir = lstatSync(linkPath).isDirectory();
        }
        if (isDir) {
          fs.rmSync(linkPath, { recursive: true });
        } else {
          fs.unlinkSync(linkPath);
        }
      } catch {
        // best effort
      }
    }
    symlinkSync(ts6Path, linkPath, "dir");
    patched++;
  }

  console.log(
    `patch-ts6: patched ${patched}/${TARGETS.length} packages to use @typescript/typescript6`,
  );
  return patched;
}

function main(argv) {
  const check = argv.includes("--check");
  const rootIdx = argv.indexOf("--root");
  const root =
    rootIdx !== -1 && argv[rootIdx + 1]
      ? resolve(argv[rootIdx + 1])
      : resolve(__dirname, "..");

  if (check) {
    const failures = checkPatch(root);
    if (failures.length > 0) {
      console.error("patch-ts6 --check: TS 6 patch did not apply:");
      for (const failure of failures) {
        console.error(`  - ${failure}`);
      }
      console.error(
        "Repair with `node scripts/patch-ts6.cjs` after `npm ci`/`npm install`." +
          " Removal tracked in https://github.com/luongnv89/asm/issues/699",
      );
      process.exit(1);
    }
    console.log(
      `patch-ts6 --check: ${expectedLinks(root).length} nested typescript link(s) resolve to @typescript/typescript6`,
    );
    process.exit(0);
  }

  applyPatch(root);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { checkPatch, applyPatch, expectedLinks, TARGETS };
