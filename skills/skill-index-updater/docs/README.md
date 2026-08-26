<!--
  DO NOT READ THIS FILE — This README.md is for human catalog browsing only.
  It ships inside the .skill package but is NEVER auto-loaded into agent context.
  The runtime loader only reads SKILL.md + references/ + scripts/ + agents/ when the skill triggers.
  If you're an AI agent, read the SKILL.md file instead for skill instructions.
-->

# Skill Index Updater

> Add new GitHub skill repositories to the ASM curated index, audit them, rebuild the catalog, and create a PR — all in one command.

## Highlights

- Accepts one or many GitHub URLs in any format (full URL, shorthand, `github:` prefix)
- Discovers SKILL.md files automatically (up to 5 levels deep)
- Lightweight security audit on every discovered skill
- **Per-step context delegation** — discovery and audit run in workers, each handed only the contract file it needs; the main agent holds the returned JSON, never the clones or the `references/` tree
- Detects existing repos and shows what changed (new/removed/updated skills)
- Rebuilds the website catalog and creates a ready-to-merge PR

## When to Use

| Say this...                                               | Skill will...                                       |
| --------------------------------------------------------- | --------------------------------------------------- |
| "Add this repo to the skill index: github.com/owner/repo" | Clone, audit, index, rebuild catalog, create PR     |
| "Index these skill repos: url1, url2, url3"               | Process all repos in parallel, one PR for the batch |
| "Update the skill catalog with new sources"               | Re-index existing repos and detect changes          |
| "Is this repo already in the index?"                      | Check against skill-index-resources.json            |

## How It Works

```mermaid
graph TD
    A["Parse & validate GitHub URLs"] --> B1["Discovery worker — repo 1<br/>slice: discovery-contract.md"]
    A --> B2["Discovery worker — repo N<br/>slice: discovery-contract.md"]
    B1 --> C1["Audit+eval worker — batch 1<br/>slice: audit-eval-contract.md"]
    B2 --> C2["Audit+eval worker — batch N<br/>slice: audit-eval-contract.md"]
    C1 --> D["Merge worker JSON<br/>update skill-index-resources.json"]
    C2 --> D
    D --> E["Generate index files & rebuild catalog"]
    E --> F["Commit, push, create PR"]
    style A fill:#4CAF50,color:#fff
    style F fill:#2196F3,color:#fff
```

## Usage

```
/skill-index-updater https://github.com/owner/repo1 https://github.com/owner/repo2
```

Or simply paste GitHub URLs and the skill triggers automatically.

## Resources

| Path                                                                      | Description                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [SKILL.md](../SKILL.md)                                                   | The orchestrator pipeline                                                                   |
| [references/discovery-contract.md](../references/discovery-contract.md)   | Step 2 worker slice — clone, discover every SKILL.md, return fixed JSON with the clone path |
| [references/audit-eval-contract.md](../references/audit-eval-contract.md) | Step 3 worker slice — lightweight audit + `asm eval`, returned as fixed JSON rows           |

Without the Agent tool the skill degrades gracefully: the main agent reads both contracts itself and runs Steps 2 and 3 inline, in order.

## Output

- Updated `data/skill-index-resources.json` with new repo entries
- Generated `data/skill-index/{owner}_{repo}.json` index files
- Rebuilt `website/catalog.json` with new skills categorized
- A feature branch with a PR ready for review
