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
 */
const { resolve, join } = require("node:path");
const {
  symlinkSync,
  mkdirSync,
  existsSync,
  readlinkSync,
  lstatSync,
} = require("node:fs");

const root = resolve(__dirname, "..");
const ts6Path = join(root, "node_modules/@typescript/typescript6");

if (!existsSync(ts6Path)) {
  console.log("patch-ts6: @typescript/typescript6 not found, skipping");
  process.exit(0);
}

// Packages that `require("typescript")` and need the TS 6 API.
const targets = [
  "typescript-eslint",
  "@typescript-eslint/eslint-plugin",
  "@typescript-eslint/parser",
  "@typescript-eslint/type-utils",
  "@typescript-eslint/typescript-estree",
  "@typescript-eslint/utils",
  "ts-api-utils",
];

let patched = 0;
for (const target of targets) {
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
  `patch-ts6: patched ${patched}/${targets.length} packages to use @typescript/typescript6`,
);
