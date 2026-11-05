# Evaluation Providers

`asm eval` evaluates a skill against a quality rubric and returns a score, verdict, and structured findings. Behind the command is a **provider framework** that plugs different evaluators into the same `EvalResult` shape — static linters today, domain-specific evaluators in the future, all speaking the same contract.

This doc covers:

- How providers work and why they're versioned on two axes
- How `asm eval` selects providers
- A checklist for adding a new provider

## How providers work

Every provider implements the [`EvalProvider`](../src/eval/types.ts) contract:

```ts
export interface EvalProvider {
  id: string; // e.g. "quality"
  version: string; // semver — bumps freely
  schemaVersion: number; // integer — only on structural breaks
  description: string;
  requires?: string[];
  externalRequires?: ExternalRequirement;
  applicable(ctx, opts): Promise<ApplicableResult>;
  run(ctx, opts): Promise<EvalResult>;
}
```

The runner in `src/eval/runner.ts` owns three cross-cutting concerns so providers don't have to: **timing** (`startedAt` + `durationMs`), **error normalization** (thrown errors become error-shaped `EvalResult` values), and **timeout enforcement** (both hard timeouts and external `AbortSignal`s).

### Provider resolution

Providers register into a shared registry (`src/eval/registry.ts`) keyed by `id` with an array of versions per id:

```ts
import { register, resolve } from "src/eval/registry";

register(qualityProviderV1); // quality@1.0.0

// Semver-range resolution — picks the highest version in range.
const p = resolve("quality", "^1.0.0");
```

Supported range shapes:

- `*` or `x` — any version
- `X.Y.Z` — exact match (including pre-release)
- `^X.Y.Z` — same major (or minor, when major is 0)
- `~X.Y.Z` — same major.minor

### Two version axes

Providers carry **two** version numbers, and the distinction matters when you plan upgrades:

| Axis            | Meaning                                                     | Bump when                                 |
| --------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `version`       | Provider semver. Participates in `resolve("id", "^1.0.0")`. | You release a new provider build.         |
| `schemaVersion` | Shape version of the `EvalResult` payload.                  | You structurally change the result shape. |

In practice, `schemaVersion` barely moves — once a provider ships v1 with its result shape, downstream parsers lock in. `version` bumps freely across feature/fix releases. Tools that consume `EvalResult` JSON output should key parsers off `schemaVersion`, not `version`.

## Listing registered providers

```bash
asm eval-providers list
```

Shows id, version, schemaVersion, description, and any `requires` tags. `--json` emits a machine-readable array of the same records.

## Provider selection

`asm eval` is zero-config: it runs every registered provider whose
`applicable()` check passes (`src/commands/eval.ts`). No config file or CLI
flag selects or pins a subset.

Version _resolution_ still lives in the registry — `resolve(id, semverRange)`
returns the highest registered version matching a range
(`src/eval/registry.ts:200`) — so multiple versions of a provider can coexist
and programmatic consumers can ask for a range.

### License category (`quality` provider)

The `license` category (`scoreLicense` in `src/evaluator-scorers-policy.ts`)
scores the frontmatter `license:` declaration against a licence file.

- **Licence file names** (`isLicenseFileName`, matched in any case):
  `LICENSE`, `LICENSE.md`, `LICENSE.txt`, `COPYING`, `COPYING.md`,
  `COPYING.txt`.
- **Own file:** one of those names in the skill folder.
- **Inherited file:** when the skill has no file of its own, the nearest one
  in a parent directory up to the skill's git root (the clone root for
  remote targets). The search never goes above the git root and is skipped
  for skills outside a git repo. An inherited file must be a regular file
  inside the git root. Symlinks are resolved, and the target must also stay
  inside the git root. A `LICENSE` directory, a broken symlink, or a symlink
  to a file outside the repo does not count.
- **Private licence:** a `license:` value that is not an SPDX identifier but
  marks the skill as private. The accepted forms, in any case, are: a value
  starting with `Proprietary` (e.g. `Proprietary-1.0`), exactly `UNLICENSED`
  (npm's convention), a value starting with `private`, `SEE LICENSE IN <file>`
  (or `SEE LICENCE IN <file>`), and any value containing "All rights
  reserved". The SPDX `Unlicense` (public domain) is not private.
- **SPDX license expressions** (`parseSpdxExpression`, per
  [SPDX 2.3 Annex D](https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/)):
  `OR`, `AND`, `WITH <exception>`, parentheses, the `+` suffix (no space
  before it), and `LicenseRef-…` / `DocumentRef-…:LicenseRef-…`, with
  precedence `+`, `WITH`, `AND`, `OR`. Identifiers and exceptions match in any
  case. Operators must be upper-case (Annex D.2), so `MIT or Apache-2.0` is
  invalid and prose like "Proprietary and confidential" is not an expression.
  An expression scores as SPDX when every identifier is recognised. A
  `LicenseRef-` also counts, but its text belongs in the licence file. An
  unknown identifier (`MIT OR Foo-1.0`), an unknown exception, or invalid
  syntax (`MIT OR`) scores 2, and the finding names the identifier or the
  syntax error.
- **Recognised exceptions:** `LLVM-exception`, `Classpath-exception-2.0`,
  `GCC-exception-3.1`, `Autoconf-exception-3.0`, `Bison-exception-2.2` (from
  the SPDX License Exceptions List). Any other exception is not recognised.
- **Deprecated ids:** `GPL-2.0`, `GPL-3.0`, `LGPL-2.1`, `LGPL-3.0` and
  `AGPL-3.0` are still on the SPDX License List, so they are recognised and
  `GPL-2.0+` is valid. A suggestion names the `-only` / `-or-later` form.
- **SPDX mixed with private terms** (`Apache-2.0 OR Proprietary`): the SPDX
  rule applies, 10 with a licence file and 5 without. The SPDX terms need the
  licence text, and a private alternative must not raise the no-file score
  above what the open licence earns alone. The finding says `SPDX licence
rule applied`. The private rule (#771) applies only when the value names no
  SPDX identifier or `LicenseRef-`, or does not parse as an expression. So
  "PROPRIETARY AND CONFIDENTIAL" and "All rights reserved" stay private.
- **`asm eval --fix`:** it scores licences the same way as plain `asm eval`,
  with the skill folder's entries and the inherited file, so `--fix
--dry-run` and plain eval agree.

| Score | Position                                                                                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10    | SPDX (identifier or expression) or private licence declared, plus a licence file (own or inherited from the repo)                                                |
| 8     | Private licence declared (`Proprietary`, `UNLICENSED`, `SEE LICENSE IN <file>`, `private`, "All rights reserved"), no licence file                               |
| 5     | SPDX licence declared, no licence file anywhere                                                                                                                  |
| 2     | A licence declared that is neither SPDX nor private, an expression with an unknown id or exception or invalid syntax, or a licence file with no `license:` field |
| 0     | No licence declared (an inherited repo LICENSE alone does not count)                                                                                             |

The findings name the case that applied: `LICENSE file present at skill root.`,
`LICENSE inherited from the enclosing repository (…).`,
`Private licence declared: …`, `… (valid SPDX license expression, every
identifier recognised).`, or `… mixes SPDX terms with private terms (…) —
SPDX licence rule applied: …`.

### Output modes

| Mode       | Flag        | Use case                             |
| ---------- | ----------- | ------------------------------------ |
| Human      | _(default)_ | Terminal reading; colors by default  |
| JSON       | `--json`    | Ad-hoc scripting                     |
| Machine v1 | `--machine` | CI pipelines; stable envelope schema |

## Checklist: add a new provider

Follow these steps when wiring a new evaluator into the framework.

### 1. Create the provider module

Scaffold under `src/eval/providers/<id>/v<N>/`:

```
src/eval/providers/myprovider/v1/
├── index.ts        // exports myProviderV1: EvalProvider
├── index.test.ts   // adapter unit tests
└── (optional) adapter.ts, spawn.ts, fixtures/
```

Export a constant named `<id>ProviderV<N>` implementing `EvalProvider`. Keep every external dependency (network, subprocess, filesystem writes) behind an injectable seam so tests can run without them.

### 2. Implement `applicable()` cheaply

Return `{ ok: false, reason }` with an actionable message when the provider can't run (missing binary, wrong version). `applicable()` runs synchronously-fast — no LLM calls, no long IO.

### 3. Implement `run()` against the contract

- Return `score` in `[0..100]`, not whatever scale your underlying tool uses.
- Set `passed` per your provider's threshold semantics.
- Emit at least one category (`"overall"` is fine for providers without a breakdown).
- Leave `startedAt`/`durationMs` as placeholders — the runner stamps them.
- Put raw tool output in `raw` so downstream consumers can reach the full payload.
- Don't catch your own errors. The runner wraps them into error-shaped results.

### 4. Register the provider

Edit [`src/eval/providers/index.ts`](../src/eval/providers/index.ts):

```ts
import { register } from "../registry";
import { myProviderV1 } from "./myprovider/v1";

export function registerBuiltins(): void {
  // ...existing...
  register(myProviderV1);
}
```

Providers register unconditionally. Environment checks (binary present, API key exported) belong in `applicable()`, not at registration time — `asm eval-providers list` must be deterministic across machines.

### 5. Add tests and docs

- Unit tests co-located at `index.test.ts`.
- An integration test in `src/cli-eval.test.ts` (if the provider needs CLI plumbing).
- A short paragraph in `docs/eval-providers.md` and an entry in `docs/ARCHITECTURE.md`.

## See also

- [`src/eval/types.ts`](../src/eval/types.ts) — contract definitions
- [`src/eval/registry.ts`](../src/eval/registry.ts) — semver range matching
- [`src/eval/runner.ts`](../src/eval/runner.ts) — timing + error normalization
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — `src/eval/` module overview
