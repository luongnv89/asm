# Skillgrade Integration

[Skillgrade](https://github.com/mgechev/skillgrade) runs **unit tests for AI agent skills** — deterministic graders plus LLM-judge rubrics, Docker-isolated execution, CI-ready exit codes. `asm eval --runtime` wraps it so runtime evaluations live alongside the static `quality` linter under one command.

This guide covers:

- Installing the external `skillgrade` CLI
- Writing your first `eval.yaml`
- The three presets (smoke, reliable, regression)
- CI usage with `--runtime --machine`
- Troubleshooting when things don't work

## Install skillgrade

Skillgrade ships as an npm package:

```bash
npm i -g skillgrade
skillgrade --version
```

`asm` checks for the binary at runtime and tells you exactly what's missing if it can't find it. If you prefer container-only installs, `skillgrade` also ships a Docker image — see the upstream README for the current tag.

### Runtime prerequisites

Skillgrade needs one of:

- **Docker** (default) — isolated evaluation, no leakage between runs
- **`--provider=local`** — faster, but the skill's eval code runs on your host machine

Pick `local` for CI environments that already run inside containers; pick `docker` on developer machines and anywhere you're evaluating skills from untrusted sources.

## Your first eval.yaml

Skillgrade reads an `eval.yaml` next to your `SKILL.md`. The fastest way to get one is:

```bash
asm eval ./my-skill --runtime init
```

This calls `skillgrade init` under the hood: it reads `SKILL.md`, drafts tasks and graders via LLM, and writes `eval.yaml` for you to review. Edit it, commit it, and you're ready to run evaluations.

### Minimal eval.yaml

```yaml
name: my-skill
preset: smoke
threshold: 0.8

tasks:
  - id: basic-usage
    prompt: "Use the skill to answer: what's 2+2?"
    graders:
      - type: contains
        text: "4"
```

`threshold` is the pass rate (0..1) the skill must hit across all tasks to return exit code 0. `graders` run per task; `contains`, `regex`, and `llm-rubric` are the common ones. See the [upstream docs](https://github.com/mgechev/skillgrade) for the full grader catalog.

## Running

### Local evaluation

```bash
asm eval ./my-skill --runtime
```

Output:

```
Skillgrade runtime: PASS score=95/100

Tasks:
  basic-usage: 5/5 (basic-usage)
```

`--json` emits the full `EvalResult`; `--machine` wraps it in the v1 envelope shape (see [`docs/eval-providers.md`](./eval-providers.md)).

### Presets

Presets control trial count and grader depth so you don't re-type the same flags:

| Preset       | Trials | Use case                                        |
| ------------ | ------ | ----------------------------------------------- |
| `smoke`      | 1–3    | Fast pre-commit check; one-off spot-checking    |
| `reliable`   | 5–10   | Default for CI; stable enough for gating merges |
| `regression` | 20+    | Deep drift detection; pre-release sign-off      |

Pass via flag or `~/.asm/config.yml`:

```bash
asm eval ./my-skill --runtime --preset reliable
```

```yaml
# ~/.asm/config.yml
eval:
  providers:
    skillgrade:
      preset: reliable
      threshold: 0.9
      provider: docker
```

CLI flags override config; config overrides provider defaults.

### Thresholds

`--threshold 0.9` accepts either `0..1` fractions or `0..100` integers. The provider normalizes both to the same internal scale. If the skill's observed pass rate falls below the threshold, `asm eval` exits 1.

## CI usage

The target CI invocation:

```bash
asm eval ./my-skill --runtime --machine
```

`--machine` emits the stable v1 envelope format: `{ status, data, meta, error? }`. Wire it into GitHub Actions or similar:

```yaml
# .github/workflows/skill-eval.yml
name: eval
on: [pull_request]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: npm i -g skillgrade
      - run: |
          bunx agent-skill-manager eval ./skills/my-skill \
            --runtime --machine \
            --preset reliable --provider local \
            > eval.json
          cat eval.json
```

Non-zero exit codes fail the step. `eval.json` is attachable for post-run inspection.

### Upgrade gate with `--compare`

Before promoting a new skillgrade or provider version, gate the upgrade on a visible diff:

```bash
asm eval ./my-skill --compare skillgrade@1.0.0,skillgrade@1.1.0
```

The rendered diff shows score delta, verdict flips, category deltas, and added/removed findings. In CI, `--compare --machine` emits a `{ before, after }` envelope and exits 1 if the newer version fails.

(At the time of writing only `skillgrade@1.0.0` is registered. The aspirational example `skillgrade@2.0.0-next` will work unchanged once a v2 adapter ships; until then, the registry prints a clean "no version satisfies" error.)

## Troubleshooting

### `skillgrade not installed. Run npm i -g skillgrade`

The `skillgrade` binary isn't on `$PATH`. Install it (`npm i -g skillgrade`), then retry. `asm eval --runtime` emits this exact hint so it's easy to copy.

### `skillgrade 0.0.x is outside the required range ^0.1.0`

`asm` pins a minimum skillgrade version via the provider's `externalRequires.semverRange`. Update to a newer skillgrade release (`npm i -g skillgrade@latest`).

### `eval.yaml not found at ./my-skill/eval.yaml`

Scaffold one with `asm eval ./my-skill --runtime init`, then edit it.

### `Docker daemon is not running`

Either start Docker or switch to `--provider local`. The provider surfaces the underlying skillgrade message verbatim so the root cause is visible.

### API key errors (e.g. `ANTHROPIC_API_KEY not set`)

LLM-judge graders need provider credentials exported. Skillgrade honors the usual env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) per the provider chosen in `eval.yaml`.

### Non-zero exit with no obvious error

Run the same command with `--json` or `--verbose` to see the underlying findings array — usually one of the tasks failed its grader, and the score fell below the threshold. Check the `tasks` and `findings` arrays for details.

## See also

- [`docs/eval-providers.md`](./eval-providers.md) — provider framework + `--compare`
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — `src/eval/` module overview
- [Upstream skillgrade](https://github.com/mgechev/skillgrade) — graders, providers, CLI reference
