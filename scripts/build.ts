#!/usr/bin/env node

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build as esbuild } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version: string = pkg.version;

let commitHash = "unknown";
try {
  const res = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status === 0) {
    commitHash = res.stdout.trim() || "unknown";
  }
} catch {
  // git not available
}

// Clean dist/ to remove stale chunks from previous builds
rmSync(resolve(root, "dist"), { recursive: true, force: true });

const result = await esbuild({
  entryPoints: [resolve(root, "bin/agent-skill-manager.ts")],
  outdir: resolve(root, "dist"),
  outbase: resolve(root),
  entryNames: "agent-skill-manager",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  minify: true,
  splitting: true,
  // Ink only loads react-devtools-core behind an `if (process.env.DEV)` gate;
  // exclude it from the bundle so production runs on node without the devDep.
  external: ["react-devtools-core"],
  define: {
    "process.env.__ASM_VERSION__": JSON.stringify(version),
    "process.env.__ASM_COMMIT__": JSON.stringify(commitHash),
    // React picks its dev vs production runtime via this string; without
    // inlining "production" here, esbuild keeps the dev build (larger, with
    // prop-type validation and extra warnings).
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  // Patch ESM-wrapped CJS deps so their `require(...)` shim resolves against
  // Node's real module loader. Without this, `require("process")` etc. from
  // bundled CJS code throws "Dynamic require of X is not supported" at runtime.
  banner: {
    js: "import { createRequire as __asmCreateRequire } from 'node:module'; const require = __asmCreateRequire(import.meta.url);",
  },
  metafile: true,
  logLevel: "warning",
});

// Prepend shebang to the CLI entry only (not shared chunks).
const entryPath = resolve(root, "dist", "agent-skill-manager.js");
const entryContent = readFileSync(entryPath, "utf8");
if (!entryContent.startsWith("#!")) {
  writeFileSync(entryPath, "#!/usr/bin/env node\n" + entryContent);
}

const outputCount = Object.keys(result.metafile?.outputs ?? {}).length;
console.log(`Built agent-skill-manager v${version} (${commitHash})`);
console.log(`  ${outputCount} output(s) in dist/`);
