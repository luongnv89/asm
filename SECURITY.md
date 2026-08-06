# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 2.x     | Yes       |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Open a [private security advisory](https://github.com/luongnv89/asm/security/advisories/new) on GitHub
3. Include detailed steps to reproduce the vulnerability
4. Allow up to 48 hours for an initial response

### What to Include

- Type of vulnerability
- Full paths of affected source files
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce
- Proof-of-concept or exploit code (if possible)
- Impact of the issue

### What to Expect

- Acknowledgment of your report within 48 hours
- Regular updates on our progress
- Credit in the security advisory (if desired)
- Notification when the issue is fixed

## Security Best Practices

When contributing to this project:

- Never commit secrets, API keys, or credentials
- Use environment variables for sensitive configuration
- Follow secure coding practices
- Report any security concerns immediately

## Local Security Checks

This repository runs local-first security checks through pre-commit. The
runner at `scripts/security_check.py` invokes the tools listed in
`security/security-tools.json`, writes a JSON + Markdown report under
`security/`, and exits non-zero on `HIGH` or `CRITICAL` findings.

### Selected Tools

| Category        | Tool                        | Why selected                                                       | Runtime network    |
| --------------- | --------------------------- | ------------------------------------------------------------------ | ------------------ |
| Secrets         | gitleaks                    | Single binary, scans repo content fully offline                    | No                 |
| Dependencies    | trivy `fs --skip-db-update` | Reads `package-lock.json` against locally warmed vuln DB           | No (DB pre-warmed) |
| Static analysis | semgrep                     | Local rules under `security/semgrep-rules.yml` (no registry fetch) | No                 |

### Run Locally

```bash
# Direct invocation
python3 scripts/security_check.py

# Through pre-commit
pre-commit run security-check --all-files
```

Reports land at `security/security-report.json` and `security/security-report.md`.

### Warm the Vulnerability Database

The trivy hook uses `--skip-db-update`, so the DB must be warmed once and
periodically refreshed:

```bash
trivy fs --download-db-only .
```

### Explicit Bypass

Bypass is discouraged. When necessary, run the runner directly with `--force`,
type the literal `YES` at the prompt, then commit with `--no-verify`.
`pre-commit` closes hook stdin, so the prompt cannot be answered from inside
`git commit`.

```bash
SECURITY_CHECK_ARGS=--force python3 scripts/security_check.py
# Type YES at the prompt, then:
git commit --no-verify
```

Record every bypass below (date, reason, link to the recorded report) so the
override is auditable.

#### Bypass Log

_None recorded._

### CI Mirror

`.github/workflows/security.yml` runs the same `scripts/security_check.py`
on `push` to `main` and on every `pull_request`. The workflow installs
`gitleaks`, `trivy`, and `semgrep`, caches the trivy vulnerability database
between runs, and uploads `security/security-report.{json,md}` as the
`security-reports` artifact. Failure parity with the local hook: any
`HIGH` or `CRITICAL` finding fails the job.
