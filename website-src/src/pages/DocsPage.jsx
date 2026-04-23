/**
 * Documentation page. Ported from the legacy
 * `renderDocsPage()` in website/index.html. Structure and wording are
 * preserved; presentation relies on the shared `.prose-asm` styles.
 */
export default function DocsPage() {
  return (
    <article className="mx-auto max-w-[820px] py-6 prose-asm">
      <h1>Documentation</h1>

      <section className="doc-section">
        <h2>Getting Started</h2>
        <h3>Install via npm (recommended)</h3>
        <pre>
          <code>npm install -g agent-skill-manager</code>
        </pre>
        <p>
          Requires <a href="https://bun.sh">Bun</a> ≥ 1.0.0 as the runtime.
          Install Bun:
        </p>
        <pre>
          <code>curl -fsSL https://bun.sh/install | bash</code>
        </pre>
        <h3>One-liner install</h3>
        <pre>
          <code>
            curl -sSL
            https://raw.githubusercontent.com/luongnv89/asm/main/install.sh |
            bash
          </code>
        </pre>
        <p>Then launch the interactive TUI:</p>
        <pre>
          <code>asm</code>
        </pre>
      </section>

      <section className="doc-section">
        <h2>CLI Command Reference</h2>
        <p>
          Run <code>asm &lt;command&gt; --help</code> on any command for full
          per-command usage, options, and examples.
        </p>
        <table>
          <thead>
            <tr>
              <th>Command</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <Row cmd="asm" desc="Launch interactive TUI" />
            <Row cmd="asm list" desc="List all discovered skills" />
            <Row
              cmd="asm search <query>"
              desc="Search installed skills and the skill index"
            />
            <Row
              cmd="asm inspect <skill-name>"
              desc="Show detailed info for a skill"
            />
            <Row
              cmd="asm install <source>"
              desc="Install a skill from GitHub, the registry, or a local path"
            />
            <Row
              cmd="asm uninstall <skill-name>"
              desc="Remove a skill (with confirmation)"
            />
            <Row
              cmd="asm init <name>"
              desc="Scaffold a new skill with SKILL.md template"
            />
            <Row
              cmd="asm link <path> [<path2> ...]"
              desc="Symlink a local skill (or many) for live development"
            />
            <Row
              cmd="asm export"
              desc="Export skill inventory as a JSON manifest"
            />
            <Row
              cmd="asm import <file>"
              desc="Import skills from a previously exported manifest"
            />
            <Row
              cmd="asm outdated"
              desc="Show which installed skills have newer versions"
            />
            <Row
              cmd="asm update [name...]"
              desc="Update outdated skills (with security re-audit)"
            />
            <Row cmd="asm audit" desc="Detect duplicate skills across tools" />
            <Row
              cmd="asm audit security <name|source>"
              desc="Run a security audit on an installed or remote skill"
            />
            <Row
              cmd="asm publish [path]"
              desc="Validate, audit, and submit a skill to the ASM Registry"
            />
            <Row
              cmd="asm eval <skill-path>"
              desc="Score a skill against best practices (quality lint)"
            />
            <Row
              cmd="asm eval-providers list"
              desc="List registered eval providers and versions"
            />
            <Row
              cmd="asm bundle <subcommand>"
              desc="Manage skill bundles (create, install, list, show, remove)"
            />
            <Row
              cmd="asm index <subcommand>"
              desc="Manage the skill index (ingest, search, list, remove)"
            />
            <Row
              cmd="asm stats"
              desc="Show aggregate skill metrics dashboard"
            />
            <Row
              cmd="asm doctor"
              desc="Run environment health checks and diagnostics"
            />
            <Row
              cmd="asm config <subcommand>"
              desc="Manage configuration (show, path, reset, edit)"
            />
          </tbody>
        </table>

        <h3>Global Options</h3>
        <p>
          These flags are accepted by most commands. Per-command flags are
          listed in their own sections below.
        </p>
        <FlagTable
          rows={[
            ["-h, --help", "Show help for any command"],
            ["-v, --version", "Print version and exit"],
            ["--json", "Output as JSON (where supported)"],
            ["--machine", "Stable machine-readable JSON envelope (v1)"],
            [
              "-s, --scope <scope>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code> (default: both)
              </>,
            ],
            [
              "-p, --tool <name>",
              "Target tool / provider (claude, codex, openclaw, agents, …)",
            ],
            [
              "--sort <field>",
              <>
                Sort by: <code>name</code>, <code>version</code>, or{" "}
                <code>location</code>
              </>,
            ],
            ["--flat", "Show one row per tool instance (list, search)"],
            ["-y, --yes", "Skip confirmation prompts"],
            ["-f, --force", "Overwrite if target already exists"],
            ["--no-color", "Disable ANSI colors"],
            ["-V, --verbose", "Show debug output"],
          ]}
        />
      </section>

      <section className="doc-section">
        <h2>Discovery Commands</h2>

        <h3>
          <code>asm list</code> — List installed skills
        </h3>
        <p>
          By default, skills installed across multiple tools are grouped into a
          single row with tool badges.
        </p>
        <FlagTable
          rows={[
            [
              "--sort <field>",
              <>
                Sort by: <code>name</code>, <code>version</code>, or{" "}
                <code>location</code> (default: name)
              </>,
            ],
            [
              "-s, --scope <s>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code>
              </>,
            ],
            [
              "-p, --tool <p>",
              "Filter by tool (claude, codex, openclaw, agents, …)",
            ],
            ["--flat", "Show one row per tool instance (ungrouped)"],
            ["--json", "Output as JSON array"],
            [
              "--machine",
              "Output in stable machine-readable v1 envelope format",
            ],
          ]}
        />
        <CodeBlock>{`asm list                          # List all skills (grouped)
asm list --flat                   # One row per tool instance
asm list -p claude                # Only Claude Code skills
asm list -s project               # Only project-scoped skills
asm list --sort version           # Sort by version
asm list --json                   # Output as JSON`}</CodeBlock>

        <h3>
          <code>asm search</code> — Search installed and indexed skills
        </h3>
        <p>
          Searches both installed skills and the skill index. Available skills
          include copy-paste install commands.
        </p>
        <FlagTable
          rows={[
            [
              "--sort <field>",
              <>
                Sort by: <code>name</code>, <code>version</code>, or{" "}
                <code>location</code>
              </>,
            ],
            [
              "-s, --scope <s>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code>
              </>,
            ],
            ["-p, --tool <p>", "Filter by tool"],
            ["--installed", "Show only installed skills"],
            ["--available", "Show only available (not installed) skills"],
            ["--flat", "Show one row per tool instance"],
            ["--json", "Output as JSON array"],
            ["--machine", "Machine-readable v1 envelope output"],
          ]}
        />
        <CodeBlock>{`asm search code                   # Search installed and available
asm search review -p claude       # Within Claude Code only
asm search "test" --installed     # Installed skills only
asm search "test" --available     # Available skills only
asm search openspec --json        # Matches as JSON`}</CodeBlock>

        <h3>
          <code>asm inspect</code> — Show details for a skill
        </h3>
        <p>
          Shows version, description, file count, and all provider
          installations. The <code>&lt;skill-name&gt;</code> argument is the
          directory name.
        </p>
        <FlagTable
          rows={[
            [
              "-s, --scope <s>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code>
              </>,
            ],
            ["--json", "Output as JSON object"],
          ]}
        />
        <CodeBlock>{`asm inspect code-review           # Show details for code-review
asm inspect code-review --json    # Output as JSON
asm inspect code-review -s global # Global installations only`}</CodeBlock>
      </section>

      <section className="doc-section">
        <h2>Installing Skills from GitHub</h2>
        <p>Install skills directly from GitHub repositories:</p>
        <CodeBlock>{`asm install github:user/my-skill
asm install github:user/my-skill#v1.0.0 -p claude
asm install github:user/skills --path skills/code-review
asm install github:user/skills --all -p claude -y
asm install https://github.com/user/skills/tree/main/skills/code-review`}</CodeBlock>

        <h3>Source Formats</h3>
        <table>
          <thead>
            <tr>
              <th>Format</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <Row
              cmd="code-review"
              desc="Install by name from the curated registry"
            />
            <Row
              cmd="author/code-review"
              desc="Scoped registry name (no ambiguity)"
            />
            <Row cmd="github:owner/repo" desc="Install from default branch" />
            <Row cmd="github:owner/repo#ref" desc="Specific branch or tag" />
            <Row
              cmd="github:owner/repo#ref:path"
              desc="Subfolder on a specific branch"
            />
            <Row cmd="https://github.com/owner/repo" desc="HTTPS URL" />
            <Row
              cmd="https://github.com/owner/repo/tree/branch/path"
              desc="Subfolder URL (auto-detects branch)"
            />
            <Row
              cmd="/abs/path/to/skill or ./relative or ~/path"
              desc="Local folder"
            />
          </tbody>
        </table>

        <h3>Install Flags</h3>
        <FlagTable
          rows={[
            [
              "-p, --tool <name>",
              <>
                Target tool (claude, codex, openclaw, agents, …, or{" "}
                <code>all</code> for every tool)
              </>,
            ],
            [
              "-s, --scope <scope>",
              <>
                Installation scope: <code>global</code> or <code>project</code>{" "}
                (default: prompt)
              </>,
            ],
            ["--name <name>", "Override skill directory name"],
            ["--path <subdir>", "Install a specific skill from a subdirectory"],
            [
              "--skill <name>",
              <>
                Alias for <code>--path</code> (Vercel skills CLI compatibility)
              </>,
            ],
            ["--all", "Install all skills found in the repo"],
            [
              "-m, --method <method>",
              <>
                Install method: <code>default</code> or <code>vercel</code>{" "}
                (delegates to <code>npx skills add</code>)
              </>,
            ],
            [
              "-t, --transport <mode>",
              <>
                Transport: <code>https</code>, <code>ssh</code>, or{" "}
                <code>auto</code> (default: auto)
              </>,
            ],
            [
              "--no-cache",
              "Force fresh registry fetch (bypass 1-hour TTL cache)",
            ],
            ["-f, --force", "Overwrite if skill already exists"],
            ["-y, --yes", "Skip confirmation prompt"],
            ["--json", "Output result as JSON"],
            [
              "--machine",
              "Machine-readable output (includes resolution source)",
            ],
          ]}
        />
      </section>

      <section className="doc-section">
        <h2>Installing Skills from Local Files</h2>
        <p>
          You can install skills from a local directory on your machine. The
          directory must contain a valid <code>SKILL.md</code> file.
        </p>

        <h3>Install from a local path</h3>
        <CodeBlock>{`asm install ./path/to/my-skill`}</CodeBlock>
        <p>Absolute and home-relative paths are also supported:</p>
        <CodeBlock>{`asm install /absolute/path/to/skill
asm install ~/my-skills/awesome-skill`}</CodeBlock>

        <h3>Install to a specific agent</h3>
        <CodeBlock>{`asm install ./my-skill -p claude`}</CodeBlock>

        <h3>Symlink for live development</h3>
        <p>
          Instead of copying, use <code>asm link</code> to create a symlink.
          Changes to the source files are reflected immediately in the agent —
          no reinstall needed:
        </p>
        <CodeBlock>{`asm link ./my-skill -p claude`}</CodeBlock>
        <p>
          This is the fastest iteration loop for skill development. Edit your{" "}
          <code>SKILL.md</code>, and the agent picks up changes on the next run.
        </p>

        <h3>Local install vs link</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>
                <code>install</code>
              </th>
              <th>
                <code>link</code>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Method</td>
              <td>Copies files to agent directory</td>
              <td>Creates a symlink</td>
            </tr>
            <tr>
              <td>Live updates</td>
              <td>No — must reinstall</td>
              <td>Yes — changes reflected immediately</td>
            </tr>
            <tr>
              <td>Best for</td>
              <td>Final deployment</td>
              <td>Active development</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="doc-section">
        <h2>SKILL.md Specification</h2>
        <p>
          Every skill is a directory containing a <code>SKILL.md</code> file
          with YAML frontmatter:
        </p>
        <CodeBlock>{`---
name: my-skill
description: "A short description of what this skill does"
license: "MIT"
compatibility: "Claude Code, Codex"
allowed-tools: Bash Read Grep Glob WebFetch
effort: medium
metadata:
  version: 1.0.0
  creator: "Your Name"
---`}</CodeBlock>

        <h3>Frontmatter Fields</h3>
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Required</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow name="name" req="yes" desc="Unique skill identifier" />
            <FieldRow
              name="description"
              req="yes"
              desc="One-line summary shown in listings"
            />
            <FieldRow name="license" req="no" desc="SPDX license identifier" />
            <FieldRow
              name="compatibility"
              req="no"
              desc="Comma-separated compatible AI agents"
            />
            <FieldRow
              name="allowed-tools"
              req="no"
              desc="Space-delimited tool names the skill uses"
            />
            <FieldRow
              name="effort"
              req="no"
              desc="Effort level: low, medium, high, or max"
            />
            <FieldRow
              name="metadata.version"
              req="no"
              desc="Semver version (defaults to 0.0.0)"
            />
            <FieldRow
              name="metadata.creator"
              req="no"
              desc="Author name and optional email"
            />
          </tbody>
        </table>
      </section>

      <section className="doc-section">
        <h2>Supported Agent Tools</h2>
        <p>
          <code>asm</code> ships with 18 built-in providers, all enabled by
          default:
        </p>
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Global Path</th>
              <th>Project Path</th>
            </tr>
          </thead>
          <tbody>
            <ToolRow
              tool="Claude Code"
              g="~/.claude/skills/"
              p=".claude/skills/"
            />
            <ToolRow tool="Codex" g="~/.codex/skills/" p=".codex/skills/" />
            <ToolRow
              tool="OpenClaw"
              g="~/.openclaw/skills/"
              p=".openclaw/skills/"
            />
            <ToolRow tool="Agents" g="~/.agents/skills/" p=".agents/skills/" />
            <ToolRow tool="Cursor" g="~/.cursor/rules/" p=".cursor/rules/" />
            <ToolRow
              tool="Windsurf"
              g="~/.windsurf/rules/"
              p=".windsurf/rules/"
            />
            <ToolRow
              tool="Cline"
              g="~/Documents/Cline/Rules/"
              p=".clinerules/"
            />
            <ToolRow tool="Roo Code" g="~/.roo/rules/" p=".roo/rules/" />
            <ToolRow
              tool="Continue"
              g="~/.continue/rules/"
              p=".continue/rules/"
            />
            <ToolRow
              tool="GitHub Copilot"
              g="~/.github/instructions/"
              p=".github/instructions/"
            />
            <ToolRow tool="Aider" g="~/.aider/skills/" p=".aider/skills/" />
            <ToolRow
              tool="OpenCode"
              g="~/.config/opencode/skills/"
              p=".opencode/skills/"
            />
            <ToolRow
              tool="Zed"
              g="~/.config/zed/prompt_overrides/"
              p=".zed/rules/"
            />
            <ToolRow tool="Augment" g="~/.augment/rules/" p=".augment/rules/" />
            <ToolRow tool="Amp" g="~/.amp/skills/" p=".amp/skills/" />
            <ToolRow
              tool="Gemini CLI"
              g="~/.gemini/skills/"
              p=".gemini/skills/"
            />
            <ToolRow
              tool="Google Antigravity"
              g="~/.antigravity/skills/"
              p=".antigravity/skills/"
            />
            <ToolRow tool="Hermes" g="~/.hermes/skills/" p=".hermes/skills/" />
          </tbody>
        </table>
      </section>

      <section className="doc-section">
        <h2>
          Configuration (<code>asm config</code>)
        </h2>
        <p>
          Config file is created at{" "}
          <code>~/.config/agent-skill-manager/config.json</code> on first run
          with 18 default providers.
        </p>
        <table>
          <thead>
            <tr>
              <th>Subcommand</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <Row cmd="config show" desc="Print current config as JSON" />
            <Row cmd="config path" desc="Print the config file path" />
            <Row
              cmd="config edit"
              desc={
                <>
                  Open the config in <code>$EDITOR</code>
                </>
              }
            />
            <Row
              cmd="config reset"
              desc={
                <>
                  Reset config to defaults (with confirmation; <code>-y</code>{" "}
                  to skip)
                </>
              }
            />
          </tbody>
        </table>
        <CodeBlock>{`asm config show     # View current config
asm config path     # Print config file path
asm config edit     # Edit in $EDITOR
asm config reset -y # Reset without confirmation`}</CodeBlock>
        <p>
          Disable a provider by setting <code>&quot;enabled&quot;: false</code>{" "}
          in the config. Add custom skill directories via{" "}
          <code>customPaths</code>.
        </p>
      </section>

      <section className="doc-section">
        <h2>Creating Your Own Skills</h2>
        <h3>Typical workflow</h3>
        <ol>
          <li>
            <strong>Scaffold</strong> — <code>asm init my-skill -p claude</code>
          </li>
          <li>
            Edit your <code>SKILL.md</code>
          </li>
          <li>
            <strong>Link for live testing</strong> —{" "}
            <code>asm link ./my-skill -p claude</code>
          </li>
          <li>Test with your AI agent</li>
          <li>
            <strong>Security audit</strong> —{" "}
            <code>asm audit security my-skill</code>
          </li>
          <li>
            <strong>Verify metadata</strong> — <code>asm inspect my-skill</code>
          </li>
          <li>
            <strong>Score quality</strong> — <code>asm eval ./my-skill</code>
          </li>
          <li>Push to GitHub</li>
          <li>
            <strong>Verify install flow</strong> —{" "}
            <code>asm install github:you/my-skill</code>
          </li>
          <li>
            <strong>Publish to registry</strong> —{" "}
            <code>asm publish ./my-skill</code>
          </li>
        </ol>
      </section>

      <section className="doc-section">
        <h2>
          Evaluating Skills (<code>asm eval</code>)
        </h2>
        <p>
          <code>asm eval &lt;skill&gt;</code> is zero-config: no external
          binary, no API key, no Docker, no <code>eval.yaml</code>. The built-in{" "}
          <code>quality@1.0.0</code> provider runs a scored rubric over
          structure, frontmatter, clarity, and safety, and prints improvement
          suggestions.
        </p>

        <h3>Core commands</h3>
        <CodeBlock>{`# Score a skill on disk
asm eval ./my-skill

# List registered eval providers
asm eval-providers list`}</CodeBlock>

        <h3>Pluggable provider framework</h3>
        <p>
          Every evaluator implements a common <code>EvalProvider</code> contract
          and resolves via a semver range, so new providers can be added without
          touching the CLI.
        </p>

        <p>
          See the full guide:{" "}
          <a
            href="https://github.com/luongnv89/asm/blob/main/docs/eval-providers.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            Eval Providers
          </a>
          .
        </p>
      </section>

      <section className="doc-section">
        <h2>
          Updating Skills (<code>asm outdated</code>, <code>asm update</code>)
        </h2>

        <h3>
          <code>asm outdated</code>
        </h3>
        <p>Show which installed skills have newer versions available.</p>
        <FlagTable
          rows={[
            ["--json", "Output as JSON"],
            ["--machine", "Stable machine-readable output"],
          ]}
        />
        <CodeBlock>{`asm outdated                       # Show outdated skills
asm outdated --json                # Output as JSON`}</CodeBlock>

        <h3>
          <code>asm update [name...]</code>
        </h3>
        <p>
          Update outdated skills to their latest version with security re-audit.
          Pass one or more skill names to update only those, or omit to update
          all outdated skills.
        </p>
        <FlagTable
          rows={[
            ["-y, --yes", "Skip confirmation prompts"],
            ["--json", "Output as JSON"],
            ["--machine", "Stable machine-readable output"],
          ]}
        />
        <CodeBlock>{`asm update                         # Update all outdated skills
asm update code-review             # Update a specific skill
asm update --yes                   # Skip confirmation prompts`}</CodeBlock>
      </section>

      <section className="doc-section">
        <h2>
          Backup and Restore (<code>asm export</code>, <code>asm import</code>)
        </h2>

        <h3>
          <code>asm export</code>
        </h3>
        <p>
          Export skill inventory as a portable JSON manifest. Useful for backup,
          sharing, or scripting.
        </p>
        <FlagTable
          rows={[
            [
              "-s, --scope <s>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code>
              </>,
            ],
          ]}
        />
        <CodeBlock>{`asm export                        # Export all skills (stdout)
asm export -s global              # Export global skills only
asm export > skills.json          # Save to a file`}</CodeBlock>

        <h3>
          <code>asm import &lt;file&gt;</code>
        </h3>
        <p>
          Import skills from a previously exported JSON manifest. Recreates
          skill installations based on the manifest. Existing skills are skipped
          unless <code>--force</code> is set.
        </p>
        <FlagTable
          rows={[
            [
              "-s, --scope <s>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code>
              </>,
            ],
            ["-f, --force", "Overwrite existing skills"],
            ["-y, --yes", "Skip confirmation prompt"],
            ["--json", "Output results as JSON"],
          ]}
        />
        <CodeBlock>{`asm import skills.json              # Import from manifest
asm import skills.json --force      # Overwrite existing skills
asm import skills.json -s global    # Import only global skills`}</CodeBlock>
      </section>

      <section className="doc-section">
        <h2>
          Skill Bundles (<code>asm bundle</code>)
        </h2>
        <p>
          A bundle is a reusable recipe of skills for a particular workflow,
          domain, or project setup. Create one from your installed skills, share
          it, and install it later in another environment.
        </p>
        <table>
          <thead>
            <tr>
              <th>Subcommand</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <Row
              cmd="bundle create <name>"
              desc="Create a new bundle from installed skills (interactive)"
            />
            <Row
              cmd="bundle install <name|file>"
              desc="Install all skills from a saved bundle or bundle file"
            />
            <Row cmd="bundle list" desc="List all saved bundles" />
            <Row cmd="bundle show <name|file>" desc="Show bundle details" />
            <Row cmd="bundle remove <name>" desc="Remove a saved bundle" />
          </tbody>
        </table>
        <h3>Flags</h3>
        <FlagTable
          rows={[
            [
              "-s, --scope <s>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code>
              </>,
            ],
            ["-y, --yes", "Skip confirmation prompts"],
            ["--json", "Output as JSON"],
          ]}
        />
        <CodeBlock>{`asm bundle create my-workflow       # Create from installed skills
asm bundle install my-workflow      # Install a saved bundle
asm bundle install ./bundle.json    # Install from a file
asm bundle list                     # Show all saved bundles
asm bundle show my-workflow         # Show bundle details
asm bundle remove my-workflow       # Remove a saved bundle`}</CodeBlock>
      </section>

      <section className="doc-section">
        <h2>
          Skill Index (<code>asm index</code>)
        </h2>
        <p>
          Manage the local skill index used by <code>asm search</code> for
          available (not-yet-installed) skills.
        </p>
        <table>
          <thead>
            <tr>
              <th>Subcommand</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <Row
              cmd="index ingest <repo>"
              desc="Ingest a skill repository into the index"
            />
            <Row
              cmd="index search <query>"
              desc="Search indexed skills by name or description"
            />
            <Row cmd="index list" desc="List all indexed repositories" />
            <Row
              cmd="index remove <owner/repo>"
              desc="Remove a repo from the index"
            />
          </tbody>
        </table>
        <h3>Flags</h3>
        <FlagTable
          rows={[
            ["--json", "Output as JSON"],
            [
              "--has <field>",
              <>
                Only show skills that have <code>&lt;field&gt;</code> (license,
                creator, version)
              </>,
            ],
            [
              "--missing <field>",
              <>
                Only show skills missing <code>&lt;field&gt;</code>
              </>,
            ],
            ["-y, --yes", "Skip confirmation prompts"],
          ]}
        />
        <CodeBlock>{`asm index ingest github:obra/superpowers          # Index a repo
asm index search code review                       # Search indexed skills
asm index search marketing --has license           # Only with license
asm index search "" --missing creator              # Skills missing creator
asm index list                                    # List indexed repos
asm index remove obra/superpowers                 # Remove from index`}</CodeBlock>
      </section>

      <section className="doc-section">
        <h2>
          Auditing (<code>asm audit</code>)
        </h2>
        <p>
          Detect duplicate skills across tools or run security audits on
          installed and remote skills.
        </p>
        <table>
          <thead>
            <tr>
              <th>Subcommand</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>audit</code> (or <code>audit duplicates</code>)
              </td>
              <td>Find duplicate skills (default)</td>
            </tr>
            <Row
              cmd="audit security <name|source>"
              desc="Run security audit on an installed skill or GitHub source"
            />
          </tbody>
        </table>
        <h3>Flags</h3>
        <FlagTable
          rows={[
            ["--json", "Output as JSON"],
            ["--machine", "Stable machine-readable v1 envelope output"],
            [
              "-y, --yes",
              "Auto-remove duplicates, keeping one instance per group",
            ],
            [
              "-s, --scope <s>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code>
              </>,
            ],
            ["--all", "(security) Audit all installed skills"],
          ]}
        />
        <CodeBlock>{`asm audit                                     # Find duplicates
asm audit -y                                  # Auto-remove duplicates
asm audit security code-review                # Audit an installed skill
asm audit security github:user/repo           # Audit a remote skill before install
asm audit security --all                      # Audit all installed skills`}</CodeBlock>
      </section>

      <section className="doc-section">
        <h2>
          Uninstalling (<code>asm uninstall</code>)
        </h2>
        <p>
          Remove a skill and its associated rule files. Shows a removal plan
          before proceeding and asks for confirmation.
        </p>
        <FlagTable
          rows={[
            ["-y, --yes", "Skip confirmation prompt"],
            [
              "-s, --scope <s>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code>
              </>,
            ],
          ]}
        />
        <CodeBlock>{`asm uninstall code-review             # Remove with confirmation
asm uninstall code-review -y          # Remove without confirmation
asm uninstall code-review -s project  # Remove project copy only`}</CodeBlock>
      </section>

      <section className="doc-section">
        <h2>
          Stats (<code>asm stats</code>)
        </h2>
        <p>
          Show aggregate skill metrics with provider distribution charts, scope
          breakdown, disk usage, and duplicate summary.
        </p>
        <FlagTable
          rows={[
            ["--json", "Output as JSON"],
            [
              "-s, --scope <s>",
              <>
                Filter: <code>global</code>, <code>project</code>, or{" "}
                <code>both</code>
              </>,
            ],
          ]}
        />
        <CodeBlock>{`asm stats                         # Full dashboard
asm stats -s global               # Global skills only
asm stats --json                  # Output as JSON`}</CodeBlock>
      </section>

      <section className="doc-section">
        <h2>
          Doctor (<code>asm doctor</code>)
        </h2>
        <p>
          Run environment health checks and diagnostics. Validates prerequisites
          for using <code>asm</code> — git, GitHub CLI, Node.js, config, lock
          file, registry, installed skills, and disk space.
        </p>
        <FlagTable
          rows={[
            ["--json", "Output as JSON"],
            ["--machine", "Stable machine-readable v1 envelope output"],
          ]}
        />
        <CodeBlock>{`asm doctor                        # Run all health checks
asm doctor --json                 # Output as JSON
asm doctor --machine              # Machine-readable output`}</CodeBlock>
      </section>

      <section className="doc-section">
        <h2>ASM Registry — Install and Publish by Name</h2>
        <p>
          The{" "}
          <a
            href="https://github.com/luongnv89/asm-registry"
            target="_blank"
            rel="noopener noreferrer"
          >
            ASM Registry
          </a>{" "}
          is the curated index of community-published skills. Once listed,
          anyone can install by name — no GitHub URL needed.
        </p>

        <h3>Install from the registry</h3>
        <CodeBlock>{`asm install code-review
asm install luongnv89/code-review
asm install code-review --no-cache`}</CodeBlock>
        <p>
          <code>asm install</code> resolves the name against the registry index,
          downloads the manifest, clones the pinned commit, and installs the
          skill.
        </p>

        <h3>Publish your skill</h3>
        <CodeBlock>{`asm publish ./my-skill`}</CodeBlock>
        <p>
          The publish pipeline validates your <code>SKILL.md</code>, runs a
          security audit, generates a signed manifest with the current commit
          SHA, and automatically opens a pull request against the registry via
          the{" "}
          <a
            href="https://cli.github.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            <code>gh</code> CLI
          </a>
          .
        </p>
        <CodeBlock>{`asm publish --dry-run ./my-skill   # preview manifest, no PR
asm publish --force ./my-skill    # override security warnings
asm publish --yes ./my-skill      # skip confirmation (CI)`}</CodeBlock>

        <h3>Publish flags</h3>
        <FlagTable
          rows={[
            ["--dry-run", "Preview the manifest without creating a PR"],
            ["--force", "Override warning-level security findings"],
            ["--yes", "Skip the confirmation prompt"],
            ["--machine", "Output as a machine-readable JSON envelope"],
          ]}
        />

        <h3>How registry resolution works</h3>
        <ol>
          <li>
            <code>asm install code-review</code> fetches the registry index
            (cached 1 hour)
          </li>
          <li>
            Finds the manifest for <code>code-review</code> — including pinned{" "}
            <code>commit</code> and <code>skill_path</code>
          </li>
          <li>
            Clones the repo at that exact commit and navigates to the skill
            subdirectory
          </li>
          <li>
            Installs as if you ran{" "}
            <code>asm install github:author/repo#commit:path</code>
          </li>
        </ol>
        <p>
          If multiple authors publish the same name, <code>asm</code> shows a
          disambiguation prompt. Use a scoped name (<code>author/skill</code>)
          to skip it.
        </p>
      </section>

      <section className="doc-section">
        <h2>TUI Keyboard Shortcuts</h2>
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <KeyRow k="↑/↓ or j/k" a="Navigate skill list" />
            <KeyRow k="Enter" a="View skill details" />
            <KeyRow k="d" a="Uninstall selected skill" />
            <KeyRow k="/" a="Search / filter skills" />
            <KeyRow k="Esc" a="Back / clear filter / close dialog" />
            <KeyRow k="Tab" a="Cycle scope: Global → Project → Both" />
            <KeyRow k="s" a="Cycle sort: Name → Version → Location" />
            <KeyRow k="r" a="Refresh / rescan skills" />
            <KeyRow k="c" a="Open configuration" />
            <KeyRow k="a" a="Audit duplicates" />
            <KeyRow k="q" a="Quit" />
          </tbody>
        </table>
      </section>
    </article>
  );
}

function Row({ cmd, desc }) {
  return (
    <tr>
      <td>
        <code>{cmd}</code>
      </td>
      <td>{desc}</td>
    </tr>
  );
}

function FlagTable({ rows }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Flag</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([flag, desc]) => (
          <tr key={flag}>
            <td>
              <code>{flag}</code>
            </td>
            <td>{desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FieldRow({ name, req, desc }) {
  return (
    <tr>
      <td>
        <code>{name}</code>
      </td>
      <td>{req}</td>
      <td>{desc}</td>
    </tr>
  );
}

function ToolRow({ tool, g, p }) {
  return (
    <tr>
      <td>{tool}</td>
      <td>
        <code>{g}</code>
      </td>
      <td>
        <code>{p}</code>
      </td>
    </tr>
  );
}

function KeyRow({ k, a }) {
  return (
    <tr>
      <td>
        <code>{k}</code>
      </td>
      <td>{a}</td>
    </tr>
  );
}

function CodeBlock({ children }) {
  return (
    <pre>
      <code>{children}</code>
    </pre>
  );
}
