---
name: with-eval-yaml
description: Summarize a git commit range into bullet-point release notes suitable for a public CHANGELOG.
version: 1.0.0
license: MIT
creator: ASM Fixtures
compatibility: Claude Code
allowed-tools: Read Bash
effort: low
---

# With eval.yaml corpus skill

## When to Use

- When the user says "summarize commits" or "draft release notes"
- After a batch of merges, before cutting a version

## Prerequisites

- A git repository with commit history
- Knowledge of the target commit range (e.g. `v1.2.0..HEAD`)

## Instructions

1. Run `git log --oneline <range>` to list commits
2. Group commits by conventional-commit type (feat/fix/chore)
3. Emit a bullet list under each heading

## Example

```bash
$ asm eval ./with-eval-yaml --runtime
Runtime pass rate: 92%
```

## Acceptance Criteria

- Produces a markdown bullet list grouped by type
- Preserves commit short SHAs as citations
- Does not modify the git working tree

## Edge cases

- Empty range: emit a "no changes since last release" note
- Merge commits: skip unless `--include-merges` is set

## Safety

Always read-only. Never run `git rebase`, `git reset`, or force-push commands.
