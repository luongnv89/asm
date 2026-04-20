# Skill Index Updater

> Add new GitHub skill repositories to the ASM curated index, audit them, rebuild the catalog, and create a PR — all in one command.

## Highlights

- Accepts one or many GitHub URLs in any format (full URL, shorthand, `github:` prefix)
- Discovers SKILL.md files automatically (up to 5 levels deep)
- Lightweight security audit on every discovered skill
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
    A["Parse & validate GitHub URLs"] --> B["Clone repos & discover SKILL.md files"]
    B --> C["Audit skills (frontmatter + security scan)"]
    C --> D["Update skill-index-resources.json"]
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

## Output

- Updated `data/skill-index-resources.json` with new repo entries
- Generated `data/skill-index/{owner}_{repo}.json` index files
- Rebuilt `website/catalog.json` with new skills categorized
- A feature branch with a PR ready for review
