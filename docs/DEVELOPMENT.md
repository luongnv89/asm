# Development Guide

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [Git](https://git-scm.com/)
- [pre-commit](https://pre-commit.com/) (optional, for git hooks)

## Setup

```bash
git clone https://github.com/luongnv89/agent-skill-manager.git
cd agent-skill-manager
bun install
```

## Running

```bash
bun run start        # Launch the TUI
bun run dev          # Same as start (alias)
```

To test CLI commands during development:

```bash
bun run bin/agent-skill-manager.ts list
bun run bin/agent-skill-manager.ts search "my-skill"
bun run bin/agent-skill-manager.ts audit --json
bun run bin/agent-skill-manager.ts --help
```

## Testing

```bash
bun test             # Run all tests
bun run typecheck    # Type-check without emitting
```

Test files are co-located with source files using the `*.test.ts` convention:

| Test File                       | Coverage                               |
| ------------------------------- | -------------------------------------- |
| `src/cli.test.ts`               | Argument parsing, command dispatch     |
| `src/config.test.ts`            | Config loading, merging, saving        |
| `src/scanner.test.ts`           | Directory scanning, filtering, sorting |
| `src/auditor.test.ts`           | Duplicate detection, instance ranking  |
| `src/uninstaller.test.ts`       | Removal plan building, file cleanup    |
| `src/formatter.test.ts`         | Table, detail, and JSON formatting     |
| `src/utils/frontmatter.test.ts` | YAML frontmatter parsing               |

## Pre-commit Hooks

The project uses [pre-commit](https://pre-commit.com/) with:

- **trailing-whitespace** — removes trailing whitespace
- **end-of-file-fixer** — ensures files end with a newline
- **check-yaml / check-json** — validates config files
- **check-added-large-files** — prevents accidental large file commits
- **prettier** — auto-formats TS, JS, JSON, CSS, and MD files
- **typecheck** — runs `tsc --noEmit` on staged TypeScript files

Install hooks locally:

```bash
pre-commit install
```

## Debugging

Since this is a TUI application, standard `console.log` will interfere with the terminal UI. For debugging:

1. Write to a log file: `Bun.write("/tmp/sm-debug.log", JSON.stringify(data))`
2. Run tests to isolate logic from the TUI layer
3. Use CLI commands to test core logic without launching the TUI:
   ```bash
   bun run bin/agent-skill-manager.ts list --json
   bun run bin/agent-skill-manager.ts audit --json
   ```
4. Use the `--help` flag to verify CLI plumbing without launching the TUI

## Project Layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full component breakdown and data flow diagrams.
