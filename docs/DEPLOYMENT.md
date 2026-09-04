# Deployment

## Publishing to npm

agent-skill-manager is distributed as a global CLI package.

### 1. Bump the version

Update the version in both files:

- `package.json` → `"version"`
- `src/utils/version.ts` → `VERSION_STRING` constant

### 2. Build and publish

```bash
npm publish
```

`prepublishOnly` runs `npm run build` automatically, so the published tarball
always ships a fresh `dist/`.

### 3. Install globally

Users install with:

```bash
npm install -g agent-skill-manager
```

Or use the one-command installer:

```bash
curl -sSL https://raw.githubusercontent.com/luongnv89/asm/main/install.sh | bash
```

## Install Script (`install.sh`)

The install script automates the full setup:

1. Detects OS (Linux, macOS, Windows/WSL) and architecture
2. Checks for Node.js >= 22 and npm >= 9 (instructs you to install them if missing)
3. Installs `agent-skill-manager` globally via `npm install -g`
4. Verifies installation — npm's `bin` field provides both `asm` and `agent-skill-manager`
5. Warns if a stale `asm` binary on PATH shadows the fresh install

## Running from Source

For development or CI environments:

```bash
git clone https://github.com/luongnv89/asm.git
cd asm
npm install
npm start
```

## CI Pipeline

GitHub Actions runs on every push to `main` and on all PRs:

1. Checkout code
2. Setup Node.js (matrix: 22, 24)
3. Install dependencies (`npm ci`)
4. Run unit tests (`npx vitest run src/`)
5. Audit production dependencies (`npx tsx scripts/ci-npm-audit.ts --omit=dev`) in a separate `audit` job (timeout 5 min, per-step 3 min) — hard-fails on high/critical advisories; skips (exit 0, not a lockfile rebuild) when the npm audit endpoint returns HTTP 400, is retired, or hangs past 90s (#608)
6. Audit all dependencies (`npx tsx scripts/ci-npm-audit.ts`) — same skip/fail policy, including `devDependencies`
7. Build (`npm run build`) and verify the `dist/` entry point
8. Run Node.js E2E and npm-install E2E suites against the packed tarball

See `.github/workflows/ci.yml` for the full pipeline.
