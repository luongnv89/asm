# CLI Implementation Plan

## Overview

Add a non-interactive CLI mode to `agent-skill-manager` so that all TUI features (list, search, inspect, uninstall, config) are accessible from scripts and pipelines.

**Approach:** Zero new dependencies — hand-rolled arg parser in `src/cli.ts`, reusing existing core modules (`scanner`, `config`, `uninstaller`). `bin/skill-manager.ts` updated to route to CLI or TUI based on arguments.

---

## Design Summary

### Command Tree

```
agent-skill-manager                        # (no args) Launch interactive TUI
agent-skill-manager list                   # List all discovered skills
agent-skill-manager search <query>         # Search skills by name/description/provider
agent-skill-manager inspect <skill-name>   # Show detailed info for a skill
agent-skill-manager uninstall <skill-name> # Remove a skill (with confirmation)
agent-skill-manager config show            # Print current config
agent-skill-manager config path            # Print config file path
agent-skill-manager config reset           # Reset config to defaults
agent-skill-manager config edit            # Open config in $EDITOR
```

### Global Options

| Flag              | Short | Description                                                    |
| ----------------- | ----- | -------------------------------------------------------------- |
| `--help`          | `-h`  | Show help for any command                                      |
| `--version`       | `-v`  | Print version and exit                                         |
| `--json`          |       | Output as JSON (for `list`, `search`, `inspect`)               |
| `--scope <scope>` | `-s`  | Filter scope: `global`, `project`, or `both` (default: `both`) |
| `--no-color`      |       | Disable ANSI colors (also respects `NO_COLOR` env)             |

### Command Details

**`list`**

- Options: `--sort <name|version|location>` (default: `name`), `--scope`, `--json`
- Output: table (name, version, provider, scope, type, path) or JSON array
- Piping: clean table to stdout, no ANSI when piped

**`search <query>`**

- Arguments: `<query>` (required)
- Options: `--sort`, `--scope`, `--json`
- Output: same as `list` but filtered

**`inspect <skill-name>`**

- Arguments: `<skill-name>` (the directory name of the skill)
- Options: `--scope`, `--json`
- Output: full skill metadata (name, version, description, path, provider, symlink info, file count)

**`uninstall <skill-name>`**

- Arguments: `<skill-name>` (required)
- Options: `--yes` / `-y` (skip confirmation), `--scope`
- Behavior: shows removal plan, asks for confirmation (unless `--yes`), executes removal
- Stderr: confirmation prompt + result log
- Exit codes: 0 success, 1 error, 2 usage error

**`config show`** — prints config JSON to stdout
**`config path`** — prints config file path
**`config reset`** — resets to defaults (with confirmation unless `--yes`)
**`config edit`** — opens in `$EDITOR`

### Example Invocations

```bash
# List all skills as a table
agent-skill-manager list

# List global skills as JSON (for piping to jq)
agent-skill-manager list --scope global --json

# Search for "code-review" skills
agent-skill-manager search code-review

# Inspect a specific skill
agent-skill-manager inspect blog-draft

# Uninstall a skill non-interactively
agent-skill-manager uninstall blog-draft --yes

# Check config
agent-skill-manager config show
```

### I/O Conventions

- Stdout: command output (tables, JSON)
- Stderr: errors, confirmation prompts, progress messages
- Respects `NO_COLOR` env var and `--no-color` flag
- Detects non-TTY stdout and auto-disables colors when piped
- Exit codes: 0 = success, 1 = runtime error, 2 = usage error

---

## Phase 1 — Foundation (skeleton + `list` command)

| #   | Task                                   | Files                                            | Expected Behavior                                                                            | Test                                        | Effort |
| --- | -------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------- | ------ |
| 1   | Create CLI arg parser & command router | `src/cli.ts` (new)                               | Parse `process.argv` into command + options, dispatch to handlers                            | Unit test: parse known args, reject unknown | M      |
| 2   | Create output formatter (table + JSON) | `src/formatter.ts` (new)                         | Format `SkillInfo[]` as aligned table or JSON array                                          | Unit test: table output, JSON output        | S      |
| 3   | Implement `list` command               | `src/cli.ts`                                     | `agent-skill-manager list` prints skill table; `--json` prints JSON; `--scope`/`--sort` work | Unit test + manual verify                   | S      |
| 4   | Update entry point to route CLI vs TUI | `bin/skill-manager.ts`                           | Subcommands route to CLI, no args launches TUI, `--help` shows full help with commands       | Unit test: help output includes commands    | S      |
| 5   | Tests for Phase 1                      | `src/cli.test.ts`, `src/formatter.test.ts` (new) | All tests pass                                                                               | `bun test`                                  | M      |

### Phase 1 deliverables

```bash
agent-skill-manager list
agent-skill-manager list --json
agent-skill-manager list --scope global --sort version
agent-skill-manager --help     # updated to show subcommands
agent-skill-manager --version  # still works
```

---

## Phase 2 — Complete (all remaining commands)

| #   | Task                                    | Files                            | Expected Behavior                                                                    | Test                                  | Effort |
| --- | --------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- | ------ |
| 6   | Implement `search <query>`              | `src/cli.ts`                     | Filtered list output, same formatting as `list`                                      | Unit test: filters correctly          | S      |
| 7   | Implement `inspect <skill-name>`        | `src/cli.ts`                     | Detailed single-skill output (table + JSON modes)                                    | Unit test: finds skill, shows details | S      |
| 8   | Implement `uninstall <skill-name>`      | `src/cli.ts`                     | Shows plan, prompts confirmation, executes removal; `--yes` skips prompt             | Unit test: plan output, `--yes` flag  | M      |
| 9   | Implement `config` subcommands          | `src/cli.ts`                     | `config show`, `config path`, `config reset`, `config edit` all work                 | Unit test per subcommand              | M      |
| 10  | Color/NO_COLOR support + pipe detection | `src/formatter.ts`, `src/cli.ts` | `--no-color`, `NO_COLOR` env, non-TTY auto-disable                                   | Unit test: color stripping            | S      |
| 11  | Error handling + exit codes             | `src/cli.ts`                     | Unknown command → exit 2 with help hint, runtime errors → exit 1 with stderr message | Unit test: exit codes                 | S      |

### Phase 2 deliverables

```bash
agent-skill-manager search code-review
agent-skill-manager search code-review --json
agent-skill-manager inspect blog-draft
agent-skill-manager inspect blog-draft --json
agent-skill-manager uninstall blog-draft
agent-skill-manager uninstall blog-draft --yes
agent-skill-manager config show
agent-skill-manager config path
agent-skill-manager config reset
agent-skill-manager config edit
```

---

## Phase 3 — Polish

| #   | Task                              | Files        | Expected Behavior                                       | Test          | Effort |
| --- | --------------------------------- | ------------ | ------------------------------------------------------- | ------------- | ------ |
| 12  | Update README with CLI usage docs | `README.md`  | New CLI section with all commands and examples          | Manual review | S      |
| 13  | Update help text for all commands | `src/cli.ts` | Per-command `--help` shows usage, options, and examples | Manual verify | S      |

---

## Files Created / Modified

### New files

- `src/cli.ts` — CLI arg parser, command handlers, help text
- `src/formatter.ts` — Table and JSON output formatting
- `src/cli.test.ts` — CLI tests
- `src/formatter.test.ts` — Formatter tests

### Modified files

- `bin/skill-manager.ts` — Route to CLI commands or TUI
- `README.md` — CLI documentation section (Phase 3)
