/**
 * Changelog page. Ported from the legacy `renderChangelogPage()` in
 * website/index.html.  Entries are expressed as data + JSX fragments
 * so inline markup (code / link / strong) stays author-friendly.
 */

const REPO = "https://github.com/luongnv89/asm";

function pr(n) {
  return (
    <a
      href={`${REPO}/pull/${n}`}
      target="_blank"
      rel="noopener noreferrer"
    >{`#${n}`}</a>
  );
}
function issue(n) {
  return (
    <a
      href={`${REPO}/issues/${n}`}
      target="_blank"
      rel="noopener noreferrer"
    >{`#${n}`}</a>
  );
}

const ENTRIES = [
  {
    version: "2.5.0",
    date: "2026-04-24",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Bundle builder UI on the catalog website — interactive cart flow
            with localStorage persistence across routes, bundle metadata form
            (name / description / author / tags), and either{" "}
            <code>BundleManifest</code> JSON export or a pre-filled GitHub
            feature-request issue to publish the bundle ({pr(238)}, {pr(240)})
          </>,
          <>
            <code>google/skills</code> and{" "}
            <code>antonbabenko/terraform-skill</code> sources in the skill-index
            — 13 Google product/technology skills plus a Terraform/OpenTofu
            skill for AI agents ({pr(237)})
          </>,
          <>
            <code>asm eval</code> warning when <code>README.md</code> sits at
            the skill root — flags a common packaging mistake that previously
            slipped through scoring ({issue(227)}, {pr(234)})
          </>,
        ],
      },
      {
        tag: "changed",
        items: [
          <>
            Redesign the website <code>/changelog</code> page with an editorial
            release-log aesthetic — two-column layout with a Fraunces +
            Instrument Serif masthead, JetBrains Mono sticky version index,
            outlined tag pills, and numbered receipt-style entries; existing{" "}
            <code>ENTRIES</code> data preserved verbatim
          </>,
          <>
            Remove the <code>eu-project-ops</code> predefined website bundle and
            update bundle tests and the website changelog bundle count to match
            the reduced set
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          <>
            <code>deploy-website.yml</code> workflow now also triggers on{" "}
            <code>website-src/**</code> and <code>package.json</code> changes —
            previously release commits that bumped only those paths would not
            fire the workflow, leaving the live site stale
          </>,
        ],
      },
    ],
  },
  {
    version: "2.4.0",
    date: "2026-04-23",
    sections: [
      {
        tag: "added",
        items: [
          <>
            <code>skill-auto-improver</code> built-in skill — eval-driven
            improvement loop that runs <code>asm eval</code>, applies
            deterministic <code>--fix</code>, then iterates per-category
            playbook edits until a skill clears the 85/8 quality floor
            (overallScore &gt; 85 AND every category &ge; 8) or stops with a
            blocker report ({issue(209)}, {pr(218)})
          </>,
          <>
            <code>asm bundle modify</code> and <code>asm bundle export</code>{" "}
            subcommands — non-interactive editing via <code>--add</code>,{" "}
            <code>--remove</code>, <code>--description</code>,{" "}
            <code>--author</code>, <code>--tags</code>, plus an interactive
            prompt mode and JSON export with <code>--force</code> /{" "}
            <code>--json</code> ({issue(204)}, {issue(205)}, {pr(208)})
          </>,
          <>
            Ship 4 curated pre-defined bundles for popular workflows (
            <code>frontend-dev</code>, <code>devops</code>,{" "}
            <code>ios-release</code>, <code>content-writing</code>) — new{" "}
            <code>--predefined</code> flag on <code>asm bundle list</code> (
            {issue(206)}, {pr(211)})
          </>,
          <>
            Full React + Vite + Tailwind + shadcn/ui rewrite of the ASM catalog
            website — replaces the 4.4k-line single-file <code>index.html</code>{" "}
            with a sidebar + detail two-pane layout for catalog and bundles,
            plus <code>/bundles</code>, <code>/docs</code>, and{" "}
            <code>/changelog</code> SPA pages ({issue(228)}, {issue(229)},{" "}
            {pr(230)}, {pr(231)}, {issue(207)}, {pr(215)})
          </>,
          <>
            <code>react-window</code> virtualization of the catalog sidebar —
            click latency on the 6,783-skill catalog drops from ~10s to instant
            ({pr(232)})
          </>,
          <>
            Mobile burger menu consolidating theme toggle, GitHub link, and nav
            items at <code>&le;768px</code> with aria-expanded, aria-controls,
            Escape-to-close, and outside-click dismissal ({pr(216)}, {pr(217)})
          </>,
          "Real ASM nexus logo in the website header",
        ],
      },
      {
        tag: "changed",
        items: [
          <>
            Drop Bun from the toolchain — replace <code>@opentui/core</code>{" "}
            with <code>ink</code> for the TUI so CLI and TUI both run on Node
            &ge;18 alone, removing the <code>bun:ffi</code> native dependency (
            {pr(224)}, {pr(226)})
          </>,
          <>
            Make <code>bun</code> optional at install time — CLI runs on Node;
            Bun is only required for interactive TUI mode ({pr(221)}, {pr(223)})
          </>,
          <>
            Rename eval provider ID <code>skill-creator</code> →{" "}
            <code>skill-best-practice</code> to avoid collision with the
            Anthropic <code>skill-creator</code> skill; include warning-severity
            checks in the score denominator; add per-check √/×/⚠ breakdown under
            each extra provider's score line
          </>,
        ],
      },
      {
        tag: "performance",
        items: [
          <>
            Split <code>catalog.json</code> into a compact list + a MiniSearch
            index — faster initial load and smaller per-request payloads on the
            website ({issue(214)}, {pr(220)})
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          <>
            Include <code>relPath</code> in the catalog dedup key so
            plugin-bundle variants aren't dropped — recovers ~3k installable
            targets that the <code>owner/repo::name</code> key had silently
            collapsed; regression tests assert{" "}
            <code>totalSkills === skills.length</code> and unique{" "}
            <code>installUrl</code> per entry ({issue(201)}, {pr(203)})
          </>,
          <>
            Opt into React Router v7 future flags (
            <code>v7_startTransition</code>, <code>v7_relativeSplatPath</code>)
            to silence v6 deprecation warnings
          </>,
          "Import test accounts for missing providers so the test suite runs cleanly when optional providers aren't installed",
        ],
      },
    ],
  },
  {
    version: "2.3.0",
    date: "2026-04-21",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Add <code>skill-best-practice</code> deterministic eval provider —
            complements the <code>quality</code> provider with rule-based checks
            that validate SKILL.md frontmatter, naming, and description shape (
            {pr(197)}, {pr(198)})
          </>,
          <>
            <code>asm eval</code> accepts GitHub refs and batch-evaluates
            collections — point at a repo or collection and score every skill in
            one command ({pr(196)})
          </>,
          <>
            Scannable <code>asm list</code> output for large inventories —
            denser, easier-to-scan rows optimised for users with hundreds of
            installed skills ({pr(192)}, {pr(195)})
          </>,
          <>
            Multi-axis filtering and search highlighting on the catalog page —
            filter skills by multiple criteria simultaneously with matched terms
            highlighted in results ({pr(186)})
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          "Preserve escaped HTML entities in search highlights so angle brackets and ampersands render correctly in highlighted matches",
          <>
            Keyboard activation on the install CTA and sort safety on unknown
            grades ({pr(186)})
          </>,
        ],
      },
    ],
  },
  {
    version: "2.2.0",
    date: "2026-04-20",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Show estimated token count and <code>asm eval</code> scores on every
            consumer surface — website cards/modal, TUI list/detail, and CLI{" "}
            <code>inspect</code>. Token count uses a <code>words + spaces</code>{" "}
            heuristic labelled with <code>~</code>; eval scores include overall
            score, letter grade, per-category breakdown, and an explicit empty
            state pointing to <code>asm eval &lt;skill&gt;</code> when data is
            missing. Catalog payload is the single source of truth, so all 3,140
            indexed skills carry both signals ({pr(191)}, closes {issue(187)},{" "}
            {issue(188)})
          </>,
          <>
            Refreshed Documentation page with the full <code>asm</code> command
            reference — adds 6 missing commands (<code>import</code>,{" "}
            <code>outdated</code>, <code>update</code>, <code>doctor</code>,{" "}
            <code>bundle</code>, <code>config path</code>), expands
            global-options and install-flags tables, and adds per-command
            sections with flags and runnable examples for <code>list</code>,{" "}
            <code>search</code>, <code>inspect</code>, <code>audit</code>,{" "}
            <code>uninstall</code>, <code>stats</code>, <code>doctor</code>,{" "}
            <code>bundle</code>, <code>index</code>, <code>outdated</code>/
            <code>update</code>, <code>export</code>/<code>import</code>, and{" "}
            <code>config</code> ({pr(190)}, closes {issue(189)})
          </>,
        ],
      },
    ],
  },
  {
    version: "2.1.0",
    date: "2026-04-20",
    sections: [
      {
        tag: "added",
        items: [
          <>
            <code>heygen-com/hyperframes</code> curated-index entry — 5 new
            skills (hyperframes, hyperframes-cli, hyperframes-registry,
            website-to-hyperframes, gsap) for HTML-based video composition (
            {pr(184)})
          </>,
          <>
            Re-indexed <code>mattpocock/skills</code> (18 → 21 skills) (
            {pr(183)})
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          <>
            Skill discovery now scans 5 levels deep (was 3), catching skills
            nested under{" "}
            <code>plugins/&lt;group&gt;/skills/&lt;skill&gt;/SKILL.md</code>.
            All curated repos re-indexed — catalog grew from ~1,700 to 3,135
            skills across 24 repos ({pr(185)})
          </>,
        ],
      },
    ],
  },
  {
    version: "2.0.0",
    date: "2026-04-19",
    sections: [
      {
        tag: "breaking",
        items: [
          <>
            Drop the <code>skillgrade</code> runtime provider and its bundled
            binary — <code>asm eval &lt;skill&gt;</code> is now zero-config (no
            external binary, API key, Docker, or <code>eval.yaml</code>). The
            built-in <code>quality</code> provider scores every skill out of the
            box ({pr(180)}, {pr(182)})
          </>,
          <>
            Remove CLI flags <code>--runtime</code>, <code>--runtime init</code>
            , <code>--preset</code>, <code>--provider</code>,{" "}
            <code>--compare</code>, <code>--threshold</code>, and the{" "}
            <code>ASM_SKILLGRADE_BIN</code> env var. CI pipelines using these
            flags will fail on upgrade
          </>,
          <>
            Remove <code>docs/skillgrade-integration.md</code>
          </>,
        ],
      },
      {
        tag: "changed",
        items: [
          <>
            Cut ~5–10 MB from the npm tarball by dropping{" "}
            <code>skillgrade</code> from <code>dependencies</code> and{" "}
            <code>bundledDependencies</code>
          </>,
        ],
      },
    ],
  },
  {
    version: "1.22.0",
    date: "2026-04-19",
    sections: [
      {
        tag: "added",
        items: [
          <>
            PATH shadowing detection — <code>asm --version</code> warns when
            multiple <code>asm</code> binaries are found on <code>PATH</code>;{" "}
            <code>asm doctor</code> gains a new{" "}
            <code>checkNoPathShadowing</code> check; npm postinstall warns at
            install time; <code>install.sh</code> adds a bash-side warning
          </>,
          <>
            Expanded <code>skillgrade-missing</code> error in{" "}
            <code>asm eval</code> with a manual fallback — guides users through
            installing Skillgrade by hand when automatic install fails
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          <>
            Bundle <code>skillgrade</code> via <code>bundledDependencies</code>{" "}
            — ships inside the <code>asm</code> package, always available
            without a separate install step
          </>,
          <>
            <code>asm eval --runtime init</code> auto-initialises{" "}
            <code>eval.yaml</code> when missing; corrected misleading init hint
            in CLI output
          </>,
        ],
      },
    ],
  },
  {
    version: "1.21.0",
    date: "2026-04-19",
    sections: [
      {
        tag: "added",
        items: [
          <>
            <code>asm eval &lt;skill&gt;</code> scored-rubric static quality
            lint through a new pluggable provider framework (
            <code>quality@1.0.0</code>)
          </>,
          <>
            <code>asm eval --runtime</code> runtime evaluation via{" "}
            <a
              href="https://github.com/mgechev/skillgrade"
              target="_blank"
              rel="noopener noreferrer"
            >
              skillgrade
            </a>{" "}
            — LLM-judge + deterministic graders in a Docker sandbox (
            <strong>
              skillgrade now ships bundled with asm — zero extra install
            </strong>
            )
          </>,
          <>
            <code>ASM_SKILLGRADE_BIN</code> env override to point at a specific
            skillgrade binary (custom builds, PATH-installed versions, CI
            pinning)
          </>,
          <>
            <code>asm eval --runtime init</code> scaffolds an{" "}
            <code>eval.yaml</code> for the active skill
          </>,
          <>
            <code>asm eval --preset smoke|reliable|regression</code>,{" "}
            <code>--threshold</code>, <code>--provider docker|local</code> flags
          </>,
          <>
            <code>
              asm eval --compare &lt;id&gt;@&lt;v1&gt;,&lt;id&gt;@&lt;v2&gt;
            </code>{" "}
            diffs two provider versions on the same skill before promoting an
            upgrade
          </>,
          <>
            <code>asm eval-providers list</code> shows registered providers,
            versions, schema version, and required externals
          </>,
          <>
            Pluggable <code>EvalProvider</code> contract with semver-range
            resolution and versioned <code>EvalResult</code> schema (new{" "}
            <code>src/eval/</code> module)
          </>,
          <>
            Config section <code>eval.providers.*</code> in{" "}
            <code>~/.asm/config.yml</code> for pinning provider versions and
            runtime options
          </>,
          <>
            Add <strong>Hermes</strong> as a built-in provider (18 providers
            total) — supports <code>~/.hermes/skills/</code> and{" "}
            <code>.hermes/skills/</code>
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          <>
            Recognize Windows drive paths (e.g. <code>C:\</code>) as local
            sources in <code>asm install</code>
          </>,
        ],
      },
      {
        tag: "docs",
        items: [
          <>
            Add{" "}
            <a
              href={`${REPO}/blob/main/docs/eval-providers.md`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <code>docs/eval-providers.md</code>
            </a>{" "}
            — provider model, version pinning, <code>--compare</code> workflow,
            5-step guide to add a new provider
          </>,
          <>
            Add{" "}
            <a
              href={`${REPO}/blob/main/docs/skillgrade-integration.md`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <code>docs/skillgrade-integration.md</code>
            </a>{" "}
            — install, first <code>eval.yaml</code>, presets, CI usage,
            troubleshooting
          </>,
          <>
            Document the <code>src/eval/</code> module in{" "}
            <code>docs/ARCHITECTURE.md</code>
          </>,
        ],
      },
    ],
  },
  {
    version: "1.20.0",
    date: "2026-04-12",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Add <code>asm publish</code> command for publishing skills to the
            ASM Registry
          </>,
          "Add registry-based skill resolution — install by bare name without GitHub URLs",
          <>
            Add <code>asm outdated</code> and <code>asm update</code> commands
            for skill version management
          </>,
          <>
            Add <code>asm doctor</code> environment health check command
          </>,
          <>
            Add <code>--machine</code> flag to all commands with stable v1 JSON
            envelope
          </>,
          "Add plugin marketplace skill discovery and Codex marketplace support",
          "Add dedicated Registry page to the website with publish/install guides",
          <>
            Support multiple skill paths in <code>asm link</code>
          </>,
          <>
            Add <code>skill_path</code> to registry manifest for multi-skill
            repos
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          "Support commit SHA refs in skill clone for pinned installs",
          <>
            Create provider directory before symlinking in <code>asm link</code>
          </>,
          "Separate unit-tests CI job to avoid config file race condition",
        ],
      },
      {
        tag: "docs",
        items: [
          "Add ASM Registry publish/install section to README and website",
          <>
            Improve <code>asm link</code> usage examples for local skill
            development
          </>,
        ],
      },
    ],
  },
  {
    version: "1.19.0",
    date: "2026-03-28",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Add <code>asm bundle</code> command with five subcommands (
            <code>create</code>, <code>install</code>, <code>list</code>,{" "}
            <code>show</code>, <code>remove</code>) for reusable skill
            collections
          </>,
          "Remember user tool selection across runs — pre-checked defaults on subsequent interactive prompts",
          <>
            Support linking multiple skills from the same folder via{" "}
            <code>asm link</code>
          </>,
          <>
            Add <code>Imbad0202/academic-research-skills</code> to curated skill
            index — 4 new academic workflow skills
          </>,
        ],
      },
      {
        tag: "docs",
        items: [
          "Add Best Practices page to website with curated resources for skill authors",
        ],
      },
    ],
  },
  {
    version: "1.18.0",
    date: "2026-03-28",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Add <code>alirezarezvani/claude-skills</code> to curated skill index
            — 451 new skills across engineering, marketing, product, compliance,
            C-level advisory, and more
          </>,
        ],
      },
      {
        tag: "docs",
        items: [
          "Update skill count from 2,600+ to 2,800+ across README, website, and OG image",
          "Update Open-Source Skill Collections table with refreshed skill counts",
        ],
      },
    ],
  },
  {
    version: "1.17.0",
    date: "2026-03-26",
    sections: [
      {
        tag: "added",
        items: [
          "Acknowledgements section to README and landing page with contributor cards, avatars, PR counts, and dependency cards",
        ],
      },
      {
        tag: "fixed",
        items: [
          "Handle Windows backslash path separators in skill name extraction",
          "Load acknowledgements from JSON source of truth",
          "Fix PR count mismatch and improve data sync",
        ],
      },
      {
        tag: "changed",
        items: [
          "Expand E2E coverage — 87 to 139 tests across Node and Bun runners",
        ],
      },
    ],
  },
  {
    version: "1.16.0",
    date: "2026-03-25",
    sections: [
      {
        tag: "added",
        items: [
          <>
            <code>asm import</code> command for restoring skills from exported
            JSON manifests with <code>--force</code>, <code>--scope</code>, and{" "}
            <code>--json</code> flags
          </>,
          <>
            Match count and install hints to <code>asm search</code> available
            skills output
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          <>
            Handle <code>--json</code> flag on empty manifest import
          </>,
        ],
      },
      {
        tag: "changed",
        items: ["Reorder provider list by priority and default-check agents"],
      },
    ],
  },
  {
    version: "1.15.1",
    date: "2026-03-25",
    sections: [
      {
        tag: "added",
        items: ["Gemini CLI and Google Antigravity as built-in providers"],
      },
      { tag: "docs", items: ["Update skill count from 1,700+ to 2,600+"] },
    ],
  },
  {
    version: "1.15.0",
    date: "2026-03-24",
    sections: [
      {
        tag: "added",
        items: [
          "4 new skill sources added to curated index",
          "Verified badge to skills during ingestion",
          "Light/dark theme toggle to skill catalog",
          "Docs page, changelog page, and version display on website",
          "Copy buttons to docs page code blocks",
          "Installing Skills from Local Files documentation section",
          "Master-cai/Research-Paper-Writing-Skills to curated skill index",
        ],
      },
      {
        tag: "fixed",
        items: [
          "Website: enforce 44px touch targets and 12px min font sizes",
          "Website: improve touch targets, font sizes, and overflow handling",
          "Website: make catalog page fully responsive on mobile",
          "Website: theme remaining hardcoded colors and improve contrast",
          "Website: address theme review feedback",
          "Verified-badge: address review feedback",
          "Add trailing newline to .gitignore",
          "Remove hardcoded path and fix maxdepth in skill-index-updater",
          "Website: rebuild changelog from GitHub releases as source of truth",
          "Website: add missing versions to changelog page",
          "Website: address review feedback for docs/changelog pages",
          "Installer: update picker test for deselected defaults",
        ],
      },
    ],
  },
  {
    version: "1.14.0",
    date: "2026-03-24",
    sections: [
      {
        tag: "added",
        items: [
          "Skill catalog website with search, category filters, and one-click install commands",
          <>
            SEO optimization, AI bot indexing (<code>llms.txt</code>,{" "}
            <code>robots.txt</code>), and Google Analytics
          </>,
          "Redesign logo as The Nexus — hub-and-spoke skill graph brand identity",
          "GitHub star count and SKILL.md link on catalog website",
          "Usability review improvements and Nexus logo update for catalog",
          <>
            <code>.skill-lock.json</code> to track installed skills with
            integrity hashes
          </>,
          <>
            Re-index existing repos with <code>compatibility</code> and{" "}
            <code>allowedTools</code> fields
          </>,
          "6 new skill sources added to index",
          "Scope selection step for global/project install",
        ],
      },
      {
        tag: "fixed",
        items: [
          "Null-skills validation bug in lock module",
          <>
            Git identity in <code>getCommitHash</code> test for CI compatibility
          </>,
          "Correct step counter in install flow",
        ],
      },
    ],
  },
  {
    version: "1.13.1",
    date: "2026-03-23",
    sections: [
      {
        tag: "fixed",
        items: [
          <>
            Node.js v25 compatibility: resolve{" "}
            <code>ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING</code>
          </>,
          <>
            Cross-runtime TUI support: <code>bun:ffi</code> shim with real FFI
            on Bun, no-op stubs on Node.js
          </>,
          "Auto re-exec with Bun for interactive TUI mode when running on Node.js",
          <>
            Clean <code>dist/</code> before build to prevent stale chunks
          </>,
        ],
      },
    ],
  },
  {
    version: "1.13.0",
    date: "2026-03-23",
    sections: [
      {
        tag: "added",
        items: [
          "Parse and display all 6 SKILL.md frontmatter fields: name, description, license, compatibility, allowed-tools, metadata",
          <>
            <code>allowed-tools</code> risk coloring in CLI and TUI (red for
            Bash/Write/Edit, yellow for WebFetch/WebSearch)
          </>,
          "Warning line for skills with high-risk tools",
          <>
            <code>license</code>, <code>compatibility</code>, and{" "}
            <code>allowedTools</code> in <code>--json</code> output
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          <>
            <code>asm index search --json</code> now includes compatibility and
            allowedTools fields
          </>,
          "TUI detail overlay height accounts for warning row",
        ],
      },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-03-23",
    sections: [
      {
        tag: "added",
        items: [
          "MiniMax-AI/skills repo to curated skill index — 10 new skills",
          "Enrich skill-index with license/creator metadata and filter flags",
          <>
            Extract curated skill repos into{" "}
            <code>data/skill-index-resources.json</code>
          </>,
          <>
            <code>effort</code> field in SKILL.md frontmatter
          </>,
          "E2E tests and multi-job CI pipeline for Node 18/20/22",
        ],
      },
      {
        tag: "fixed",
        items: [
          <>
            Stub <code>bun:ffi</code> at build time for Node.js compatibility
          </>,
          <>
            Scope unit-tests CI job to <code>src/</code> to exclude E2E tests
          </>,
        ],
      },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-03-21",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Interactive checkbox picker for multi-skill install (navigate with
            ↑/↓, toggle with Space, select all with <code>a</code>)
          </>,
          "Search/filter in checkbox picker for long lists",
          "Interactive checkbox picker for provider selection during config",
          "Support Vercel skills CLI install format",
          "Support installing skills from local folder paths",
          <>
            Wave 1 provider expansion — 8 new providers, <code>$EDITOR</code>{" "}
            config fix, creator column
          </>,
          'Rename user-facing "Provider" to "Tool" in CLI and TUI',
        ],
      },
      {
        tag: "fixed",
        items: [
          <>
            Change shebang to <code>node</code> for npm global install
            compatibility
          </>,
          "Skill detail TUI description overflow",
          "Guard ingester/audit against local paths and restrict tilde expansion",
          "Checkbox picker re-render cursor positioning",
        ],
      },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-03-18",
    sections: [
      {
        tag: "added",
        items: [
          <>
            <code>asm index</code> command with bundled pre-indexed skill data
            for fast offline discovery
          </>,
          <>
            Support nested metadata blocks in SKILL.md frontmatter (dot
            notation: <code>metadata.version</code>)
          </>,
          <>
            <code>resolveVersion()</code> helper for consistent version
            resolution
          </>,
          <>
            Updated <code>asm init</code> scaffold template with metadata block
            format
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          "Duplicate install names in multi-skill installs",
          <>
            Valid JSON for <code>asm audit security --all --json</code> when no
            skills found
          </>,
          <>
            Upgrade <code>actions/checkout</code> to v5 for Node.js 20
            deprecation
          </>,
        ],
      },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-03-14",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Support GitHub subfolder URLs for <code>asm install</code> and{" "}
            <code>asm audit security</code>
          </>,
          <>
            <code>github:owner/repo#ref:path</code> shorthand syntax for
            subfolder installs
          </>,
          <>
            <code>resolveSubpath()</code> using <code>git ls-remote</code> to
            disambiguate branches from paths
          </>,
        ],
      },
    ],
  },
  {
    version: "1.8.3",
    date: "2026-03-14",
    sections: [
      {
        tag: "fixed",
        items: [
          "Replace Unicode box-drawing characters with ASCII equivalents for terminal compatibility",
        ],
      },
    ],
  },
  {
    version: "1.8.2",
    date: "2026-03-14",
    sections: [
      {
        tag: "added",
        items: [
          "Redesigned security audit report with compact 4-zone layout",
          "Deduplicate matches so same file:line appears once per category",
          "Group matches by file for compact rendering",
          "Aggregate critical/warning/info counts in threat summary",
        ],
      },
    ],
  },
  {
    version: "1.8.1",
    date: "2026-03-14",
    sections: [
      {
        tag: "fixed",
        items: [
          "Duplicate skill removal now creates symlinks to the kept instance instead of just deleting",
        ],
      },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-03-14",
    sections: [
      {
        tag: "added",
        items: [
          <>
            <code>--transport &lt;https|ssh|auto&gt;</code> flag for private
            GitHub repos via SSH
          </>,
          <>
            <code>asm audit security</code> subcommand for scanning dangerous
            patterns
          </>,
          <>
            <code>--all</code> flag for <code>asm audit security</code> to audit
            all installed skills
          </>,
          "Audit remote GitHub skills before installing",
        ],
      },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-03-13",
    sections: [
      {
        tag: "added",
        items: [
          <>
            YAML frontmatter validation for SKILL.md files using the{" "}
            <code>yaml</code> library
          </>,
          <>
            Detect and report <code>invalid-yaml</code> warnings in{" "}
            <code>asm inspect</code> and <code>asm list</code>
          </>,
        ],
      },
    ],
  },
  {
    version: "1.6.2",
    date: "2026-03-13",
    sections: [
      {
        tag: "fixed",
        items: [
          'Suppress "fatal: not a git repository" stderr noise outside git repos',
          "Fix 7 failing tests to match new grouped CLI output format from v1.6.0",
        ],
      },
    ],
  },
  {
    version: "1.6.1",
    date: "2026-03-13",
    sections: [
      {
        tag: "fixed",
        items: [
          <>
            Replace Unicode bar chart characters with ASCII-safe chars in{" "}
            <code>asm stats</code>
          </>,
        ],
      },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-03-13",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Default grouped list view with colored <code>[Provider]</code>{" "}
            badges
          </>,
          <>
            <code>--flat</code> flag for list and search commands
          </>,
          <>
            <code>-p/--provider</code> filter on list and search
          </>,
          "Stats dashboard with ASCII bar charts",
          "Provider-specific colors throughout CLI output",
          <>
            Summary footer on <code>list</code> output
          </>,
          <>
            Practical examples in all subcommand <code>--help</code> texts
          </>,
          "Actionable error hints and audit hints",
        ],
      },
      {
        tag: "changed",
        items: [
          <>
            Paths shortened with <code>~</code> prefix throughout all CLI output
          </>,
          "Inspect output uses lighter header style with provider badges",
          <>
            <code>stats --json</code> omits <code>perSkillDiskBytes</code> by
            default
          </>,
        ],
      },
    ],
  },
  {
    version: "1.5.1",
    date: "2026-03-13",
    sections: [
      {
        tag: "fixed",
        items: [
          "Compact batch install output with progress counter",
          "Replace Unicode characters with ASCII-safe equivalents",
          "Fix process hang after interactive provider selection",
        ],
      },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-03-13",
    sections: [
      {
        tag: "added",
        items: [
          <>
            <code>asm install -p all</code> to install across all enabled
            providers
          </>,
          "Primary provider receives files; others get relative symlinks",
          'Interactive provider picker includes "All providers" option',
        ],
      },
    ],
  },
  {
    version: "1.4.1",
    date: "2026-03-13",
    sections: [
      {
        tag: "added",
        items: [
          "Accept plain HTTPS GitHub URLs for install",
          <>
            Support for <code>.git</code> suffix, <code>/tree/branch</code>{" "}
            paths, and trailing slashes
          </>,
        ],
      },
      {
        tag: "fixed",
        items: ["Type annotations to fix implicit any errors"],
      },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-03-13",
    sections: [
      {
        tag: "added",
        items: [
          <>
            <code>asm install github:user/repo</code> command
          </>,
          <>
            <code>--verbose</code> / <code>-V</code> flag for debug output
          </>,
          "Node.js compatibility layer, config backup, semver sort",
          <>
            <code>export</code>, <code>init</code>, <code>stats</code>,{" "}
            <code>link</code> commands and skill health warnings
          </>,
        ],
      },
      {
        tag: "fixed",
        items: ["Pin @opentui/core to exact version 0.1.87 for stability"],
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-03-11",
    sections: [
      {
        tag: "added",
        items: [
          "Symlink-aware duplicate detection",
          <>
            <code>realPath</code> field on scanned skills via{" "}
            <code>fs.realpath()</code>
          </>,
        ],
      },
      {
        tag: "changed",
        items: [
          "Audit deduplicates by resolved real path, preferring non-symlink entries",
        ],
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-03-11",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Build step (<code>bun run build</code>) for npm distribution
          </>,
          "Build script with version and commit hash injection",
          <>
            <code>prepublishOnly</code> script for auto-build before publish
          </>,
        ],
      },
      {
        tag: "changed",
        items: [
          <>
            Bin entry points reference bundled <code>dist/</code> instead of raw
            TypeScript
          </>,
        ],
      },
      {
        tag: "fixed",
        items: [
          "Version display works in both development and production modes",
        ],
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-03-11",
    sections: [
      {
        tag: "added",
        items: [
          <>
            Non-interactive CLI mode with <code>asm</code> shorthand command
          </>,
          <>
            Duplicate skill audit — detect and remove duplicates across
            providers (<code>asm audit</code>)
          </>,
          <>
            JSON output support (<code>--json</code>) for CLI commands
          </>,
          <>
            One-command install script (<code>curl | bash</code>)
          </>,
          "TUI audit overlay with two-phase workflow",
        ],
      },
      {
        tag: "changed",
        items: ["Rebranded project to agent-skill-manager"],
      },
      {
        tag: "fixed",
        items: ["Bun global bin PATH handling and alias creation in installer"],
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-03-11",
    sections: [
      {
        tag: "added",
        items: [
          "Interactive TUI dashboard built with OpenTUI and Bun",
          "Multi-agent support: Claude Code, Codex, OpenClaw, and generic Agents",
          <>
            Configurable providers via{" "}
            <code>~/.config/agent-skill-manager/config.json</code>
          </>,
          "Global and project scope filtering with Tab cycling",
          "Real-time search and sort (by name, version, location)",
          "Detailed skill view with SKILL.md frontmatter metadata",
          "Safe uninstall with confirmation dialog and full removal plan",
          "In-TUI config editor — toggle providers on/off",
          "Pre-commit hooks, GitHub Actions CI, 63 unit tests",
        ],
      },
    ],
  },
];

const VALID_TAGS = new Set([
  "added",
  "changed",
  "fixed",
  "breaking",
  "docs",
  "performance",
]);

const TAG_LABELS = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
  breaking: "Breaking",
  docs: "Docs",
  performance: "Performance",
};

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDate(iso) {
  // iso: "2026-04-23"
  const [y, m, d] = iso.split("-");
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const mi = parseInt(m, 10) - 1;
  return {
    day: d,
    month: months[mi] ?? m,
    year: y,
    short: `${months[mi] ?? m} ${parseInt(d, 10)}, ${y}`,
  };
}

function versionSlug(v) {
  return `v-${v.replace(/\./g, "-")}`;
}

function Entry({ version, date, sections, index }) {
  const f = formatDate(date);
  return (
    <section id={versionSlug(version)} className="cl-entry">
      <header className="cl-head">
        <h2 className="cl-v">
          <span className="prefix">VERSION</span>
          {version}
        </h2>
        <div className="cl-head-rule" aria-hidden="true" />
        <time className="cl-date" dateTime={date}>
          {f.short}
        </time>
      </header>

      {sections.map((s, i) => {
        const tagClass = VALID_TAGS.has(s.tag) ? s.tag : "added";
        const label = TAG_LABELS[tagClass] ?? tagClass;
        return (
          <div key={i} className="cl-section">
            <div className="cl-section-head">
              <span className={`cl-tag ${tagClass}`}>{label}</span>
              <span className="cl-section-rule" aria-hidden="true" />
              <span className="cl-count">
                {pad(s.items.length)}{" "}
                {s.items.length === 1 ? "entry" : "entries"}
              </span>
            </div>
            <ul className="cl-items">
              {s.items.map((item, j) => (
                <li key={j} className="cl-item">
                  <span className="cl-item-num" aria-hidden="true">
                    {pad(j + 1)}
                  </span>
                  <div className="cl-item-body">{item}</div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

export default function ChangelogPage() {
  const latest = ENTRIES[0];
  const latestDate = formatDate(latest.date);

  return (
    <div className="cl-root mx-auto max-w-[1120px] px-1">
      <header className="cl-masthead">
        <div className="cl-kicker">
          <span className="dot" aria-hidden="true" />
          <span>Release Log · agent-skill-manager</span>
        </div>
        <h1 className="cl-title">
          What&apos;s <em>new</em>, what&apos;s next.
        </h1>
        <p className="cl-lede">
          A running record of every meaningful change shipped to{" "}
          <code
            style={{
              fontFamily: "var(--cl-mono)",
              fontSize: "0.9em",
              padding: "1px 6px",
              border: "1px solid var(--cl-rule)",
              borderRadius: 4,
              background: "var(--bg-input)",
              color: "var(--cl-ink)",
            }}
          >
            asm
          </code>{" "}
          — curated in the spirit of{" "}
          <a
            href="https://keepachangelog.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Keep a Changelog
          </a>
          , versioned with{" "}
          <a
            href="https://semver.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            SemVer
          </a>
          .
        </p>
        <div className="cl-meta-row">
          <span>
            Latest · <strong>v{latest.version}</strong>
          </span>
          <span>{latestDate.short}</span>
          <span>
            <strong>{ENTRIES.length}</strong> releases
          </span>
          <a
            href={`${REPO}/blob/main/CHANGELOG.md`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Full log on GitHub ↗
          </a>
        </div>
      </header>

      <div className="cl-layout">
        <aside className="cl-rail" aria-label="Version index">
          <div className="cl-rail-label">Index</div>
          <ul>
            {ENTRIES.map((e) => {
              const f = formatDate(e.date);
              return (
                <li key={e.version}>
                  <a href={`#${versionSlug(e.version)}`}>
                    <span className="v">{e.version}</span>
                    <span className="d">
                      {f.month} &apos;{f.year.slice(2)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="cl-stream">
          {ENTRIES.map((e, i) => (
            <Entry key={e.version} {...e} index={i} />
          ))}

          <div className="cl-outro">
            <span>— End of log —</span>
            <br />
            <a
              href={`${REPO}/releases`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginTop: 10, display: "inline-block" }}
            >
              Watch releases on GitHub ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
