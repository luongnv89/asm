import { useEffect, useMemo, useState } from "react";
import { evalScoreClass, formatTokens } from "../lib/utils.js";
import CopyButton from "./CopyButton.jsx";
import AddToBundleButton from "./AddToBundleButton.jsx";
import { Badge } from "./ui/badge.jsx";
import { Card } from "./ui/card.jsx";

/**
 * Reusable skill detail view. Rendered in the right pane of the
 * two-pane `CatalogPage` (`/` and `/skills/:id` both route to it).
 * Lazy-loads the full per-skill JSON from `slim.detailPath`; while
 * that's in flight the slim row already provides all the fields
 * needed to render a first paint.
 *
 * Props:
 *   - slim: the slim row from catalog.skills (required)
 */
export default function SkillDetail({ slim }) {
  const [detail, setDetail] = useState({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!slim?.detailPath) {
      setDetail({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setDetail({ data: null, loading: true, error: null });
    (async () => {
      try {
        const res = await fetch(slim.detailPath);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (cancelled) return;
        setDetail({ data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setDetail({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slim?.detailPath]);

  const skill = useMemo(() => detail.data || slim, [detail.data, slim]);
  if (!skill) return null;

  const cmd = "asm install " + skill.installUrl;
  const evalScoreCls = skill.evalSummary
    ? evalScoreClass(skill.evalSummary.overallScore)
    : "";

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--fg)]">
          {skill.name}
        </h1>
        <div className="text-sm text-[var(--fg-muted)] mt-1">
          {skill.owner}/{skill.repo}
        </div>
        <p className="text-sm text-[var(--fg-dim)] mt-3 leading-relaxed">
          {skill.description}
        </p>
      </header>

      <dl className="grid sm:grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-[var(--fg-muted)]">Status</dt>
        <dd>
          {skill.verified ? (
            <Badge tone="verified">✓ verified</Badge>
          ) : (
            <Badge tone="default">unverified</Badge>
          )}
        </dd>
        {skill.version && skill.version !== "0.0.0" && (
          <Row label="Version">{skill.version}</Row>
        )}
        {skill.license && <Row label="License">{skill.license}</Row>}
        {skill.creator && <Row label="Creator">{skill.creator}</Row>}
        {skill.compatibility && <Row label="Compat">{skill.compatibility}</Row>}
        {typeof skill.tokenCount === "number" && (
          <Row
            label="Est. Tokens"
            title="Estimated context cost: words + spaces in SKILL.md"
          >
            {formatTokens(skill.tokenCount)}
          </Row>
        )}
        {skill.allowedTools && skill.allowedTools.length > 0 && (
          <Row label="Tools">
            <span className="text-[var(--warn)]">
              {skill.allowedTools.join(", ")}
            </span>
          </Row>
        )}
        <Row label="Repo">
          <a
            className="text-[var(--brand)] hover:underline"
            href={`https://github.com/${skill.owner}/${skill.repo}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {skill.owner}/{skill.repo}
          </a>
        </Row>
        <Row label="Categories">
          <div className="flex flex-wrap gap-1">
            {(skill.categories || []).map((c) => (
              <Badge key={c} tone="cat">
                {c}
              </Badge>
            ))}
          </div>
        </Row>
      </dl>

      <Card className="p-4">
        <h2 className="text-xs uppercase tracking-wide text-[var(--fg-muted)] mb-2">
          asm eval score
        </h2>
        {skill.evalSummary ? (
          <div className="flex flex-col gap-3">
            <div
              className={
                "flex items-center gap-3 " +
                (evalScoreCls === "eval-a"
                  ? "text-emerald-400"
                  : evalScoreCls === "eval-b"
                    ? "text-lime-400"
                    : evalScoreCls === "eval-c"
                      ? "text-yellow-400"
                      : evalScoreCls === "eval-d"
                        ? "text-orange-400"
                        : "text-red-400")
              }
            >
              <span className="text-3xl font-semibold">
                {skill.evalSummary.overallScore}
                <span className="text-base text-[var(--fg-muted)]">/100</span>
              </span>
              <span className="text-sm text-[var(--fg-dim)]">
                grade {skill.evalSummary.grade}
              </span>
            </div>
            {skill.evalSummary.evaluatedAt && (
              <div className="text-xs text-[var(--fg-muted)]">
                Evaluated{" "}
                {new Date(skill.evalSummary.evaluatedAt).toLocaleDateString()}
                {skill.evalSummary.evaluatedVersion
                  ? " · v" + skill.evalSummary.evaluatedVersion
                  : ""}
              </div>
            )}
            {skill.evalSummary.categories?.length > 0 && (
              <table className="w-full text-xs">
                <tbody>
                  {skill.evalSummary.categories.map((c) => {
                    const pct =
                      c.max > 0 ? Math.round((c.score / c.max) * 100) : 0;
                    const tone = evalScoreClass(pct);
                    const toneColor =
                      tone === "eval-a"
                        ? "bg-emerald-500"
                        : tone === "eval-b"
                          ? "bg-lime-500"
                          : tone === "eval-c"
                            ? "bg-yellow-500"
                            : tone === "eval-d"
                              ? "bg-orange-500"
                              : "bg-red-500";
                    return (
                      <tr key={c.id}>
                        <td className="py-1 text-[var(--fg-dim)] pr-2 align-middle">
                          {c.name}
                        </td>
                        <td className="w-full align-middle">
                          <div className="h-1.5 rounded bg-[var(--bg-input)] overflow-hidden">
                            <div
                              className={"h-full " + toneColor}
                              style={{ width: pct + "%" }}
                            />
                          </div>
                        </td>
                        <td className="pl-2 text-right text-[var(--fg-dim)] whitespace-nowrap align-middle">
                          {c.score}/{c.max}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--fg-dim)]">
            No <code>asm eval</code> data is available for this skill yet. Run{" "}
            <code>asm eval &lt;skill-path&gt;</code> after installing to
            generate one.
          </p>
        )}
      </Card>

      {skill.installUrl && (
        <Card className="p-4">
          <h2
            id="quick-start"
            className="text-xs uppercase tracking-wide text-[var(--fg-muted)] mb-4"
          >
            Quick Start
          </h2>
          <div className="flex flex-col gap-4" role="list">
            <div
              className="flex gap-3"
              role="listitem"
              aria-label="Step 1 of 3: Security Check"
            >
              <div
                className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--bg-input)] flex items-center justify-center text-xs font-semibold text-[var(--fg)]"
                aria-hidden="true"
              >
                1
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--fg)] mb-1">
                  Security Check
                </div>
                <div className="text-xs text-[var(--fg-dim)] mb-2">
                  Check for security issues before installation
                </div>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 text-xs font-mono bg-[var(--bg-input)] p-2 rounded text-[var(--fg)] truncate"
                    aria-label={`Command: asm audit security ${skill.installUrl}`}
                  >
                    asm audit security {skill.installUrl}
                  </code>
                  <CopyButton
                    text={`asm audit security ${skill.installUrl}`}
                    size="md"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--border)]" />

            <div
              className="flex gap-3"
              role="listitem"
              aria-label="Step 2 of 3: Quality Evaluation"
            >
              <div
                className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--bg-input)] flex items-center justify-center text-xs font-semibold text-[var(--fg)]"
                aria-hidden="true"
              >
                2
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--fg)] mb-1">
                  Quality Evaluation
                </div>
                <div className="text-xs text-[var(--fg-dim)] mb-2">
                  Evaluate skill quality and metadata
                </div>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 text-xs font-mono bg-[var(--bg-input)] p-2 rounded text-[var(--fg)] truncate"
                    aria-label={`Command: asm eval ${skill.installUrl}`}
                  >
                    asm eval {skill.installUrl}
                  </code>
                  <CopyButton text={`asm eval ${skill.installUrl}`} size="md" />
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--border)]" />

            <div
              className="flex gap-3"
              role="listitem"
              aria-label="Step 3 of 3: Install"
            >
              <div
                className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--bg-input)] flex items-center justify-center text-xs font-semibold text-[var(--fg)]"
                aria-hidden="true"
              >
                3
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--fg)] mb-1">
                  Install
                </div>
                <div className="text-xs text-[var(--fg-dim)] mb-2">
                  Install the skill to your Claude Code environment
                </div>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 text-xs font-mono bg-[var(--bg-input)] p-2 rounded text-[var(--fg)] truncate"
                    aria-label={`Command: asm install ${skill.installUrl}`}
                  >
                    asm install {skill.installUrl}
                  </code>
                  <CopyButton
                    text={`asm install ${skill.installUrl}`}
                    size="md"
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="flex items-center gap-2 p-3">
        <code className="flex-1 text-xs font-mono text-[var(--fg)] truncate">
          {cmd}
        </code>
        <CopyButton text={cmd} size="md" />
      </Card>

      <div className="flex items-center gap-2">
        <AddToBundleButton skill={skill} />
        <span className="text-[11px] text-[var(--fg-muted)]">
          Group this skill with others into an installable bundle.
        </span>
      </div>

      {skill.skillUrl && (
        <p className="text-xs">
          <a
            href={skill.skillUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--brand)] hover:underline"
          >
            View SKILL.md on GitHub →
          </a>
        </p>
      )}

      {detail.loading && (
        <p className="text-xs text-[var(--fg-muted)]">Loading details…</p>
      )}
      {detail.error && (
        <p className="text-xs text-[var(--warn)]">
          ⚠ Could not load full details: {detail.error}
        </p>
      )}
    </div>
  );
}

function Row({ label, children, title }) {
  return (
    <>
      <dt className="text-[var(--fg-muted)]" title={title}>
        {label}
      </dt>
      <dd className="text-[var(--fg)]">{children}</dd>
    </>
  );
}
