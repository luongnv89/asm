# Deployment

## Publishing to npm (via Bun)

agent-skill-manager is distributed as a global CLI package.

### 1. Bump the version

Update the version in both files:

- `package.json` → `"version"`
- `src/utils/version.ts` → `VERSION_STRING` constant

### 2. Build and publish

```bash
npm publish
```

Or if using Bun's npm compatibility:

```bash
bunx npm publish
```

### 3. Install globally

Users install with:

```bash
bun install -g agent-skill-manager
```

Or use the one-command installer:

```bash
curl -sSL https://raw.githubusercontent.com/luongnv89/agent-skill-manager/main/install.sh | bash
```

## Install Script (`install.sh`)

The install script automates the full setup:

1. Detects OS (Linux, macOS, Windows/WSL) and architecture
2. Checks for Bun >= 1.0.0 (installs if missing)
3. Ensures Bun's global bin directory is in PATH
4. Installs `agent-skill-manager` globally via `bun install -g`
5. Creates command aliases (`asm`, `agent-skill-manager`)
6. Verifies installation

## Running from Source

For development or CI environments:

```bash
git clone https://github.com/luongnv89/agent-skill-manager.git
cd agent-skill-manager
bun install
bun run start
```

## CI Pipeline

GitHub Actions runs on every push to `main` and on all PRs:

1. Checkout code
2. Setup Bun (latest)
3. Install dependencies (`bun install --frozen-lockfile`)
4. Check formatting (Prettier)
5. Type check (`bun run typecheck`)
6. Run tests (`bun test`)

See `.github/workflows/ci.yml` for the full pipeline.
