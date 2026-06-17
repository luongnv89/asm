import { Link } from "react-router-dom";
import { ArrowRight, Github } from "lucide-react";
import { useCatalog } from "../hooks/useCatalog.jsx";
import CopyButton from "../components/CopyButton.jsx";

const REPO_URL = "https://github.com/luongnv89/asm";
const NPM_CMD = "npm install -g agent-skill-manager";
const PROVIDER_COUNT = 19;

/**
 * Marketing landing page (route `/`). The catalog lives at `/skills`.
 *
 * Copy follows a Problem → Agitate → Solution arc mirroring the README:
 * "your skills are a mess" → "asm brings order". Visual language reuses
 * the editorial/terminal system already established on the changelog
 * page (Fraunces serif headlines, JetBrains Mono accents, hacker-green
 * `--brand`). Headline stats (`skills`, `repos`, `categories`) are read
 * live from the loaded catalog so they never drift from reality, with
 * static fallbacks for the brief window before the catalog hydrates.
 */
export default function LandingPage() {
  const { catalog } = useCatalog();
  const skillCount = catalog?.totalSkills ?? 3800;
  const repoCount = catalog?.totalRepos ?? 35;
  const categoryCount = catalog?.categories?.length ?? 16;

  const skillsLabel = skillCount.toLocaleString();

  return (
    <div className="lp flex flex-col gap-24 sm:gap-32 py-4 sm:py-8">
      <Hero
        skillsLabel={skillsLabel}
        repoCount={repoCount}
        providerCount={PROVIDER_COUNT}
      />
      <Stats
        skillsLabel={skillsLabel}
        repoCount={repoCount}
        categoryCount={categoryCount}
        providerCount={PROVIDER_COUNT}
      />
      <Problem />
      <Solution />
      <HowItWorks />
      <Build />
      <FinalCta skillsLabel={skillsLabel} />
    </div>
  );
}

/* ─── Hero ──────────────────────────────────────────────────────────── */

function Hero({ skillsLabel, repoCount, providerCount }) {
  return (
    <section className="grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-center pt-2 sm:pt-6">
      <div className="flex flex-col gap-7">
        <span className="lp-kicker">
          <span className="dot" aria-hidden="true" />
          agent-skill-manager
        </span>
        <h1 className="lp-title">
          One tool to manage every AI agent&apos;s <em>skills</em>.
        </h1>
        <p className="lp-lede">
          Stop juggling skill directories across Claude Code, Codex, Cursor,
          Windsurf and {providerCount - 4}+ other agents.{" "}
          <strong className="text-[var(--fg)] font-semibold">asm</strong> gives
          you a single TUI and CLI to install, search, audit, and organize all
          your agent skills — everywhere.
        </p>

        <div className="flex flex-col gap-3 max-w-[520px]">
          <div className="lp-cmd">
            <span className="prompt" aria-hidden="true">
              $
            </span>
            <span className="flex-1">{NPM_CMD}</span>
            <CopyButton
              text={NPM_CMD}
              size="sm"
              ariaLabel="Copy install command"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/skills" className="lp-cta">
              Browse {skillsLabel} skills
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-cta-ghost"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              Star on GitHub
            </a>
          </div>
          <p className="text-xs text-[var(--fg-muted)] font-[var(--lp-mono)]">
            Free &amp; open source · MIT · Node.js ≥ 18 · No signup, no backend,
            no tracking
          </p>
        </div>
      </div>

      <HeroTerminal repoCount={repoCount} />
    </section>
  );
}

function HeroTerminal({ repoCount }) {
  return (
    <div className="lp-term shadow-xl shadow-black/10">
      <div className="lp-term-bar">
        <span className="tdot" aria-hidden="true" />
        <span className="tdot" aria-hidden="true" />
        <span className="tdot" aria-hidden="true" />
        <span className="tlabel">asm — ~/projects</span>
      </div>
      <div className="lp-term-body">
        <span className="c">$</span> <span className="fg">asm install</span>{" "}
        github:anthropics/skills
        {"\n"}
        <span className="dim"> ↳ cloning anthropics/skills…</span>
        {"\n"}
        <span className="dim"> ↳ </span>
        <span className="c">✓ security scan passed</span>
        <span className="dim"> — no risky patterns</span>
        {"\n"}
        <span className="dim"> ↳ </span>
        <span className="c">✓ installed 7 skills</span>
        <span className="dim"> → claude, codex</span>
        {"\n\n"}
        <span className="c">$</span> <span className="fg">asm audit</span>{" "}
        duplicates
        {"\n"}
        <span className="dim"> ↳ </span>
        <span className="warn">⚠ 3 duplicates</span>
        <span className="dim"> across claude / cursor — </span>
        <span className="fg">asm clean</span>
        {"\n\n"}
        <span className="c">$</span> <span className="fg">asm stats</span>
        {"\n"}
        <span className="dim">
          {" "}
          142 skills · {repoCount} repos · 6 providers
        </span>
        {"\n"}
        <span className="c">▍</span>
      </div>
    </div>
  );
}

/* ─── Stats bar ─────────────────────────────────────────────────────── */

function Stats({ skillsLabel, repoCount, categoryCount, providerCount }) {
  const items = [
    { num: skillsLabel, label: "skills indexed" },
    { num: repoCount, label: "curated repos" },
    { num: categoryCount, label: "categories" },
    { num: providerCount, label: "agents supported" },
  ];
  return (
    <section
      aria-label="Catalog at a glance"
      className="grid grid-cols-2 sm:grid-cols-4 gap-y-8 gap-x-4 py-2"
    >
      {items.map((it) => (
        <div key={it.label} className="flex flex-col items-center text-center">
          <span className="lp-stat-num">{it.num}</span>
          <span className="lp-stat-label">{it.label}</span>
        </div>
      ))}
    </section>
  );
}

/* ─── Problem (Agitate) ─────────────────────────────────────────────── */

function Problem() {
  const pains = [
    {
      head: "Scattered everywhere",
      body: "~/.claude/skills/, ~/.codex/skills/, ~/.cursor/… the same skill installed three times, and you can't remember which version is where.",
    },
    {
      head: "Zero visibility",
      body: "No quick way to see what's installed, what's duplicated, or what's outdated across all your agents. You ls through hidden directories.",
    },
    {
      head: "Manual and risky",
      body: "You clone repos, copy folders, hope the SKILL.md is valid — and pray you didn't just install something that exfiltrates your codebase.",
    },
  ];
  return (
    <section className="flex flex-col gap-10">
      <header className="flex flex-col gap-4 max-w-[680px]">
        <span className="lp-kicker">
          <span className="dot" aria-hidden="true" />
          the problem
        </span>
        <h2 className="lp-section-title">
          Your AI agent skills are a&nbsp;mess.
        </h2>
        <p className="lp-lede">
          You use Claude Code at work, Codex for side projects, Cursor for
          experiments. Each tool hides skills in its own directory with its own
          conventions. The more agents you adopt, the worse it gets — every new
          one is another folder to babysit.
        </p>
      </header>
      <div className="grid sm:grid-cols-3 gap-5">
        {pains.map((p) => (
          <div
            key={p.head}
            className="border-l-2 border-[var(--warn)] pl-5 py-1 flex flex-col gap-2"
          >
            <h3 className="text-[var(--fg)] font-semibold text-base">
              {p.head}
            </h3>
            <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
              {p.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Solution ──────────────────────────────────────────────────────── */

function Solution() {
  const features = [
    {
      icon: "01",
      head: "See everything at once",
      body: "List, search, and filter every skill across all providers and scopes from one dashboard. No more spelunking through hidden directories.",
    },
    {
      icon: "02",
      head: "Install from GitHub in one command",
      body: "asm install github:user/repo handles cloning, validation, and placement — single skills, multi-skill collections, subfolders, and private repos over SSH.",
    },
    {
      icon: "03",
      head: "Catch problems before they bite",
      body: "Built-in security scanning flags shell execution, network calls, credential exposure, and obfuscation before you install. Duplicate audit cleans the rest.",
    },
    {
      icon: "04",
      head: "Create, test, and publish",
      body: "Scaffold with asm init, symlink for live reload with asm link, audit and verify metadata, then publish to the ASM Registry — one command each.",
    },
    {
      icon: "05",
      head: "Works with every major agent",
      body: "19 providers built in: Claude Code, Codex, Cursor, Windsurf, Cline, Roo, Continue, Copilot, Aider, Zed, Gemini CLI, and more. Add custom ones in seconds.",
    },
    {
      icon: "06",
      head: "Two interfaces, one tool",
      body: "A full interactive TUI with keyboard navigation and detail views — or the CLI with --json for scripting, CI, and automation.",
    },
  ];
  return (
    <section className="flex flex-col gap-10">
      <header className="flex flex-col gap-4 max-w-[680px]">
        <span className="lp-kicker">
          <span className="dot" aria-hidden="true" />
          the fix
        </span>
        <h2 className="lp-section-title">
          <em className="not-italic text-[var(--brand)] font-[var(--lp-mono)] text-[0.7em] align-middle mr-1">
            asm
          </em>{" "}
          brings order to the chaos.
        </h2>
        <p className="lp-lede">
          One command that manages skills across every AI coding agent you use.
          One TUI. One CLI. Every agent.
        </p>
      </header>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((f) => (
          <article key={f.icon} className="lp-card">
            <span className="lp-card-icon">{f.icon}</span>
            <h3>{f.head}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ─── How it works ──────────────────────────────────────────────────── */

function HowItWorks() {
  const steps = [
    {
      n: "1",
      head: "Install asm",
      body: "One command via npm or curl. Runs on Node.js ≥ 18 — no other runtime required.",
    },
    {
      n: "2",
      head: "Run asm",
      body: "It auto-discovers skills across every configured agent directory on your machine.",
    },
    {
      n: "3",
      head: "Manage everything",
      body: "Install, search, inspect, audit, and uninstall skills from the TUI or scriptable CLI.",
    },
    {
      n: "4",
      head: "Stay safe",
      body: "Security-scan before installing, detect duplicates, and clean up with confidence.",
    },
  ];
  return (
    <section className="flex flex-col gap-10">
      <header className="flex flex-col gap-4 max-w-[680px]">
        <span className="lp-kicker">
          <span className="dot" aria-hidden="true" />
          how it works
        </span>
        <h2 className="lp-section-title">From chaos to clean in four steps.</h2>
      </header>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
        {steps.map((s) => (
          <div key={s.n} className="flex flex-col gap-3">
            <span className="lp-step-num">{s.n}</span>
            <div className="lp-rule" />
            <h3 className="text-[var(--fg)] font-semibold text-base mt-1">
              {s.head}
            </h3>
            <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Build your own ────────────────────────────────────────────────── */

function Build() {
  return (
    <section className="grid lg:grid-cols-[0.95fr_1.05fr] gap-12 lg:gap-16 items-center">
      <div className="flex flex-col gap-5 max-w-[560px]">
        <span className="lp-kicker">
          <span className="dot" aria-hidden="true" />
          for skill authors
        </span>
        <h2 className="lp-section-title">
          Build, test, and ship your own skills.
        </h2>
        <p className="lp-lede">
          asm isn&apos;t just for consuming skills — it&apos;s the complete
          toolkit for creating, developing, auditing, and testing them locally
          before you share. Scaffold, symlink for live reload, scan for risks,
          then publish to the registry with a single command.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://github.com/luongnv89/asm#build-test-and-ship-your-own-skills"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-cta-ghost"
          >
            Read the dev workflow
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
          <Link
            to="/bundles"
            className="text-sm text-[var(--fg-dim)] hover:text-[var(--brand)] font-medium"
          >
            Explore bundles →
          </Link>
        </div>
      </div>

      <div className="lp-term">
        <div className="lp-term-bar">
          <span className="tdot" aria-hidden="true" />
          <span className="tdot" aria-hidden="true" />
          <span className="tdot" aria-hidden="true" />
          <span className="tlabel">author workflow</span>
        </div>
        <div className="lp-term-body">
          <span className="dim"># scaffold a new skill</span>
          {"\n"}
          <span className="c">$</span> <span className="fg">asm init</span>{" "}
          my-skill -p claude
          {"\n\n"}
          <span className="dim"># live-reload while you edit</span>
          {"\n"}
          <span className="c">$</span> <span className="fg">asm link</span>{" "}
          ./my-skill -p claude
          {"\n\n"}
          <span className="dim"># audit before you ship</span>
          {"\n"}
          <span className="c">$</span> <span className="fg">asm audit</span>{" "}
          security ./my-skill
          {"\n"}
          <span className="dim"> ↳ </span>
          <span className="c">✓ no dangerous patterns</span>
          {"\n\n"}
          <span className="dim"># publish to the registry</span>
          {"\n"}
          <span className="c">$</span> <span className="fg">asm publish</span>{" "}
          ./my-skill
          {"\n"}
          <span className="dim"> ↳ </span>
          <span className="c">✓ PR opened</span>
          <span className="dim"> — installable by name once merged</span>
        </div>
      </div>
    </section>
  );
}

/* ─── Final CTA ─────────────────────────────────────────────────────── */

function FinalCta({ skillsLabel }) {
  return (
    <section className="flex flex-col items-center text-center gap-7 py-6 sm:py-10 border-t border-[var(--border)]">
      <span className="lp-kicker">
        <span className="dot" aria-hidden="true" />
        get started in 30 seconds
      </span>
      <h2 className="lp-section-title max-w-[680px]">
        Bring order to your skills today.
      </h2>
      <p className="lp-lede mx-auto">
        Install once, manage every agent. Or browse {skillsLabel} skills in your
        browser first — no signup required.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-[480px]">
        <div className="lp-cmd">
          <span className="prompt" aria-hidden="true">
            $
          </span>
          <span className="flex-1 text-left">{NPM_CMD}</span>
          <CopyButton
            text={NPM_CMD}
            size="sm"
            ariaLabel="Copy install command"
          />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link to="/skills" className="lp-cta">
            Browse the catalog
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lp-cta-ghost"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
