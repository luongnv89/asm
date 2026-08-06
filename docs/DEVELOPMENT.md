# Development Guide

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18.0.0 (with npm >= 9)
- [Git](https://git-scm.com/)
- [pre-commit](https://pre-commit.com/) (optional, for git hooks)

## Setup

```bash
git clone https://github.com/luongnv89/asm.git
cd asm
npm install
```

## Running

```bash
npm start        # Launch the TUI
npm run dev          # Same as start (alias)
```

To test CLI commands during development:

```bash
npx tsx bin/agent-skill-manager.ts list
npx tsx bin/agent-skill-manager.ts search "my-skill"
npx tsx bin/agent-skill-manager.ts audit --json
npx tsx bin/agent-skill-manager.ts --help
```

## Testing

```bash
npm test             # Run all tests
npm run typecheck    # Type-check without emitting
```

Test files are co-located with source files using the `*.test.ts` convention.
44 `*.test.ts` files live under `src/`, one per module — e.g. `cli.test.ts`,
`scanner.test.ts`, `installer.test.ts`, `eval/*.test.ts`. Run `npm test` for
the full, current list.

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

1. Write to a log file: `fs.writeFileSync("/tmp/sm-debug.log", JSON.stringify(data))`
2. Run tests to isolate logic from the TUI layer
3. Use CLI commands to test core logic without launching the TUI:
   ```bash
   npx tsx bin/agent-skill-manager.ts list --json
   npx tsx bin/agent-skill-manager.ts audit --json
   ```
4. Use the `--help` flag to verify CLI plumbing without launching the TUI

## Project Layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full component breakdown and data flow diagrams.
