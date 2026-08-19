import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Github } from "lucide-react";
import { useCatalog } from "../hooks/useCatalog.jsx";
import CopyButton from "../components/CopyButton.jsx";
import Reveal from "../components/Reveal.jsx";
import { useInViewReveal } from "../hooks/useInViewReveal.js";
import { cn } from "../lib/cn.js";
import { prefersReducedMotion } from "../lib/motion.js";

const REPO_URL = "https://github.com/luongnv89/asm";
const NPM_CMD = "npm install -g agent-skill-manager";
const PROVIDER_COUNT = 19;

/**
 * Marketing landing page (route `/`). The catalog lives at `/skills`.
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
      <WhatsNew />
      <Problem />
      <Solution />
      <HowItWorks />
      <Build />
      <FinalCta skillsLabel={skillsLabel} />
    </div>
  );
}

/* ─── What's New (v2.14) ───────────────────────────────────────────── */

function WhatsNew() {
  const highlights = [
    {
      tag: "New",
      head: "Cross-tool skill linking",
      body: "Installing a skill you already have in another agent? asm detects it and offers Link (symlink) or Reinstall — no duplicate copies.",
    },
    {
      tag: "New",
      head: "Library activation lifecycle",
      body: "Activate skills from your local library into any provider, update in place, and deactivate without uninstalling the source.",
    },
    {
      tag: "New",
      head: "Author & repo stats on the web",
      body: "Explore top repositories, author rankings, and category pie charts on the new Stats page — drill into any author profile.",
    },
    {
      tag: "Improved",
      head: "skill-creator v1.13",
      body: "Exemplar-driven authoring, adversarial review, eval floor gates, and a predictability rubric raise the bar for publish-ready skills.",
    },
  ];
  return (
    <Reveal
      as="section"
      className="flex flex-col gap-8"
      aria-label="What's new in v2.14"
    >
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="flex flex-col gap-3 max-w-[680px]">
          <span className="lp-kicker">
            <span className="dot" aria-hidden="true" />
            what&apos;s new · v2.14
          </span>
          <h2 className="lp-section-title">
            Link once. Activate anywhere. See who ships what.
          </h2>
          <p className="lp-lede">
            v2.14 tightens the install loop across agents, adds a full library
            activation lifecycle, and surfaces catalog intelligence on the web.
          </p>
        </div>
        <Link
          to="/changelog"
          className="lp-cta-ghost shrink-0 self-start sm:self-auto"
        >
          Full release log
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </header>
      <Reveal stagger className="grid sm:grid-cols-2 gap-5">
        {highlights.map((h) => (
          <article key={h.head} className="lp-card">
            <span className="text-[10px] font-[var(--lp-mono)] uppercase tracking-wider text-[var(--brand)]">
              {h.tag}
            </span>
            <h3>{h.head}</h3>
            <p>{h.body}</p>
          </article>
        ))}
      </Reveal>
    </Reveal>
  );
}

/* ─── Hero ──────────────────────────────────────────────────────────── */

function Hero({ skillsLabel, repoCount, providerCount }) {
  return (
    <section className="grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-center pt-2 sm:pt-6">
      <Reveal immediate className="flex flex-col gap-7">
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
          you a single TUI and CLI to install, link across agents, search,
          audit, and organize all your agent skills — everywhere.
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
      </Reveal>

      <HeroTerminal repoCount={repoCount} />
    </section>
  );
}

function HeroTerminal({ repoCount }) {
  const reducedMotion = prefersReducedMotion();
  const [linesLive, setLinesLive] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (reducedMotion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show terminal lines immediately when motion is reduced
      setLinesLive(true);
      return undefined;
    }
    const t = window.setTimeout(() => setLinesLive(true), 280);
    return () => window.clearTimeout(t);
  }, [reducedMotion]);

  const lines = [
    <span key="install">
      <span className="c">$</span> <span className="fg">asm install</span>{" "}
      github:anthropics/skills
    </span>,
    <span key="clone" className="dim">
      {" "}
      ↳ cloning anthropics/skills…
    </span>,
    <span key="scan">
      <span className="dim"> ↳ </span>
      <span className="c">✓ security scan passed</span>
      <span className="dim"> — no risky patterns</span>
    </span>,
    <span key="link">
      <span className="dim"> ↳ </span>
      <span className="c">✓ linked 7 skills</span>
      <span className="dim"> → claude, codex (cross-tool link)</span>
    </span>,
    null,
    <span key="audit-cmd">
      <span className="c">$</span> <span className="fg">asm audit</span>{" "}
      duplicates
    </span>,
    <span key="dups">
      <span className="dim"> ↳ </span>
      <span className="warn">⚠ 3 duplicates</span>
      <span className="dim"> across claude / cursor — </span>
      <span className="fg">asm clean</span>
    </span>,
    null,
    <span key="stats-cmd">
      <span className="c">$</span> <span className="fg">asm stats</span>
    </span>,
    <span key="stats-out" className="dim">
      {" "}
      142 skills · {repoCount} repos · 6 providers
    </span>,
  ];

  return (
    <div
      className={cn(
        "lp-term lp-term-hero shadow-xl shadow-black/10",
        linesLive && "is-visible",
      )}
    >
      <div className="lp-term-bar">
        <span className="tdot" aria-hidden="true" />
        <span className="tdot" aria-hidden="true" />
        <span className="tdot" aria-hidden="true" />
        <span className="tlabel">asm — ~/projects</span>
      </div>
      <div className="lp-term-body">
        {lines.map((line, i) =>
          line === null ? (
            <br key={`br-${i}`} />
          ) : (
            <div
              key={i}
              className={cn("lp-term-line", linesLive && "is-visible")}
              style={
                reducedMotion
                  ? undefined
                  : { transitionDelay: `${120 + i * 65}ms` }
              }
            >
              {line}
            </div>
          ),
        )}
        <span className="lp-cursor" aria-hidden="true">
          ▍
        </span>
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
    <Reveal
      as="section"
      stagger
      aria-label="Catalog at a glance"
      className="grid grid-cols-2 sm:grid-cols-4 gap-y-8 gap-x-4 py-2"
    >
      {items.map((it) => (
        <div key={it.label} className="flex flex-col items-center text-center">
          <span className="lp-stat-num">{it.num}</span>
          <span className="lp-stat-label">{it.label}</span>
        </div>
      ))}
    </Reveal>
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
    <Reveal as="section" className="flex flex-col gap-10">
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
      <Reveal stagger className="grid sm:grid-cols-3 gap-5">
        {pains.map((p) => (
          <div
            key={p.head}
            className="lp-pain border-l-2 border-[var(--warn)] pl-5 py-1 flex flex-col gap-2"
          >
            <h3 className="text-[var(--fg)] font-semibold text-base">
              {p.head}
            </h3>
            <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
              {p.body}
            </p>
          </div>
        ))}
      </Reveal>
    </Reveal>
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
      body: "asm install github:user/repo handles cloning, validation, and placement — and when a skill already lives in another agent, offers cross-tool Link or Reinstall instead of duplicating it. Supports single skills, collections, subfolders, and private repos over SSH.",
    },
    {
      icon: "03",
      head: "Catch problems before they bite",
      body: "Built-in security scanning flags shell execution, network calls, credential exposure, and obfuscation before you install. Duplicate audit cleans the rest.",
    },
    {
      icon: "04",
      head: "Create, test, and publish",
      body: "Scaffold with asm init, symlink for live reload with asm link, activate library skills into any provider, audit with the upgraded skill-creator v1.13 toolchain, then publish to the ASM Registry — one command each.",
    },
    {
      icon: "05",
      head: "Works with every major agent",
      body: "19 providers built in: Claude Code, Codex, Cursor, Windsurf, Cline, Roo, Continue, Copilot, Aider, Zed, Gemini CLI, and more. Add custom ones in seconds.",
    },
    {
      icon: "06",
      head: "Two interfaces, one tool",
      body: "A full interactive TUI with keyboard navigation and detail views — or the CLI with --json for scripting, CI, and automation. The companion site adds a Stats dashboard with repo rankings, author profiles, and category charts.",
    },
  ];
  return (
    <Reveal as="section" className="flex flex-col gap-10">
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
      <Reveal stagger className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((f) => (
          <article key={f.icon} className="lp-card">
            <span className="lp-card-icon">{f.icon}</span>
            <h3>{f.head}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </Reveal>
    </Reveal>
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
    <Reveal as="section" className="flex flex-col gap-10">
      <header className="flex flex-col gap-4 max-w-[680px]">
        <span className="lp-kicker">
          <span className="dot" aria-hidden="true" />
          how it works
        </span>
        <h2 className="lp-section-title">From chaos to clean in four steps.</h2>
      </header>
      <Reveal
        stagger
        className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10"
      >
        {steps.map((s) => (
          <div key={s.n} className="flex flex-col gap-3">
            <span className="lp-step-num">{s.n}</span>
            <StepRule />
            <h3 className="text-[var(--fg)] font-semibold text-base mt-1">
              {s.head}
            </h3>
            <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
              {s.body}
            </p>
          </div>
        ))}
      </Reveal>
    </Reveal>
  );
}

function StepRule() {
  const { ref, visible } = useInViewReveal();
  return <div ref={ref} className={cn("lp-rule", visible && "is-visible")} />;
}

/* ─── Build your own ────────────────────────────────────────────────── */

function Build() {
  return (
    <section className="grid lg:grid-cols-[0.95fr_1.05fr] gap-12 lg:gap-16 items-center">
      <Reveal className="flex flex-col gap-5 max-w-[560px]">
        <span className="lp-kicker">
          <span className="dot" aria-hidden="true" />
          for skill authors
        </span>
        <h2 className="lp-section-title">
          Build, test, and ship your own skills.
        </h2>
        <p className="lp-lede">
          asm isn&apos;t just for consuming skills — it&apos;s the complete
          toolkit for creating, developing, activating from your library,
          auditing, and testing them locally before you share. Scaffold, symlink
          for live reload, scan for risks, then publish to the registry with a
          single command.
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
      </Reveal>

      <Reveal delay={80} className="lp-term">
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
          <span className="dim"># activate from your local library</span>
          {"\n"}
          <span className="c">$</span> <span className="fg">asm activate</span>{" "}
          my-skill -p cursor
          {"\n"}
          <span className="dim"> ↳ </span>
          <span className="c">✓ symlinked</span>
          <span className="dim"> — update or deactivate anytime</span>
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
      </Reveal>
    </section>
  );
}

/* ─── Final CTA ─────────────────────────────────────────────────────── */

function FinalCta({ skillsLabel }) {
  return (
    <Reveal
      as="section"
      className="flex flex-col items-center text-center gap-7 py-6 sm:py-10 border-t border-[var(--border)]"
    >
      <span className="lp-kicker">
        <span className="dot" aria-hidden="true" />
        get started in 30 seconds
      </span>
      <h2 className="lp-section-title max-w-[680px]">
        Bring order to your skills today.
      </h2>
      <p className="lp-lede mx-auto">
        Install once, link across every agent. Browse {skillsLabel} skills or
        explore author and repo stats in your browser first — no signup
        required.
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
          <Link to="/stats" className="lp-cta-ghost">
            View catalog stats
          </Link>
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
    </Reveal>
  );
}
