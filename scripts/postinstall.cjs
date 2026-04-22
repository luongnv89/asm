#!/usr/bin/env node
/**
 * Runs after `npm install -g agent-skill-manager`.
 *
 * Walks PATH for duplicate `asm` binaries so users catch shadowing
 * before the stale install silently outruns the new one. Never fails the
 * install — any unexpected error is swallowed.
 *
 * Skipped by default under CI and inside nested/production-dep installs;
 * `ASM_SKIP_POSTINSTALL=1` also disables it explicitly.
 */

"use strict";

try {
  // Only run for global installs. Local/dev installs and CI can skip.
  const isGlobal =
    process.env.npm_config_global === "true" ||
    process.env.npm_config_global === "1";
  if (
    process.env.ASM_SKIP_POSTINSTALL ||
    process.env.CI ||
    !isGlobal
  ) {
    process.exit(0);
  }

  const fs = require("fs");
  const path = require("path");

  const BIN = "asm";
  const DELIM = path.delimiter;
  const pathEnv = process.env.PATH || "";

  const seenReal = new Set();
  const hits = [];

  for (const raw of pathEnv.split(DELIM)) {
    const dir = raw.trim();
    if (!dir) continue;
    const candidate = path.resolve(dir, BIN);
    let stats;
    try {
      stats = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      continue;
    }
    let real;
    try {
      real = fs.realpathSync(candidate);
    } catch {
      real = candidate;
    }
    if (seenReal.has(real)) continue;
    seenReal.add(real);
    hits.push({ path: candidate, real });
  }

  if (hits.length <= 1) process.exit(0);

  const [resolved, ...shadowed] = hits;
  process.stderr.write(
    `\n[agent-skill-manager] Warning: ${hits.length} \`asm\` binaries on PATH — the fresh install may be shadowed.\n`,
  );
  process.stderr.write(`  resolved: ${resolved.path}\n`);
  for (const other of shadowed) {
    process.stderr.write(`  shadowed: ${other.path}\n`);
  }
  process.stderr.write(
    "  Remove the stale install so the new one resolves first on PATH.\n",
  );
  process.stderr.write(
    "  See: https://github.com/luongnv89/agent-skill-manager#troubleshooting\n\n",
  );
  process.exit(0);
} catch {
  // Never fail the install.
  process.exit(0);
}
