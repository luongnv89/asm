#!/usr/bin/env bun

const VERSION = "1.0.0";

const arg = process.argv[2];

if (arg === "--help" || arg === "-h") {
  console.log(`\x1b[1m\x1b[36mpskills manager\x1b[0m v${VERSION}

Interactive TUI for managing installed pskills across global and project scopes.

\x1b[1mUsage:\x1b[0m
  skill-manager              Launch the interactive TUI dashboard
  skill-manager --help       Show this help message
  skill-manager --version    Show version

\x1b[1mRequirements:\x1b[0m
  Bun >= 1.0.0  (https://bun.sh)

\x1b[1mTUI Keybindings:\x1b[0m
  ↑/↓ or j/k   Navigate skill list
  Enter         View skill details
  d             Uninstall selected skill
  /             Search / filter skills
  Esc           Back / clear filter / close dialog
  Tab           Cycle scope: Global → Project → Both
  s             Cycle sort: Name → Version → Location
  q             Quit
  ?             Toggle help overlay`);
  process.exit(0);
}

if (arg === "--version" || arg === "-v") {
  console.log(`pskills manager v${VERSION}`);
  process.exit(0);
}

// Launch the TUI
await import("../src/index.ts");

export {};
