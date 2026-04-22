# Contributing to agent-skill-manager

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [Git](https://git-scm.com/)

### Development Setup

```bash
git clone https://github.com/luongnv89/agent-skill-manager.git
cd agent-skill-manager
npm install
npm start        # Launch the TUI
```

### Running

```bash
npm start        # Launch the interactive TUI
npm run bin/agent-skill-manager.ts list   # Test CLI commands
```

### Running Tests

```bash
npm test             # Run all tests
npm run typecheck    # Type-check without emitting
```

## How to Contribute

### Reporting Bugs

Open a [bug report](https://github.com/luongnv89/agent-skill-manager/issues/new?template=bug_report.md) with:

- Steps to reproduce
- Expected vs. actual behavior
- Your environment (OS, Node version)

### Suggesting Features

Open a [feature request](https://github.com/luongnv89/agent-skill-manager/issues/new?template=feature_request.md) describing the problem and your proposed solution.

### Submitting Code

1. Fork the repository
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```
3. Make your changes
4. Run tests and type-checking:
   ```bash
   npm test
   npm run typecheck
   ```
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add new provider type
   fix: handle missing config directory
   docs: update keyboard shortcuts table
   ```
6. Push and open a Pull Request against `main`

### Branching Strategy

- `main` — stable, release-ready code
- `feat/*` — new features
- `fix/*` — bug fixes
- `docs/*` — documentation changes

### Code Style

- TypeScript strict mode (`tsconfig.json` has `"strict": true`)
- Pre-commit hooks handle formatting via Prettier
- Keep functions focused and files small
- Follow existing patterns in the codebase

### Testing

- Tests live alongside source files (`*.test.ts`)
- Use the Vitest (`npm test`)
- Add tests for new logic, especially in `scanner.ts`, `config.ts`, `uninstaller.ts`, `auditor.ts`, and `cli.ts`

## Pull Request Process

1. Fill out the PR template
2. Ensure CI passes (type-check + tests)
3. Keep PRs focused — one feature or fix per PR
4. A maintainer will review and merge

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
