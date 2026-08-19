import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { formatTokens } from "../lib/utils.js";
import CopyButton from "./CopyButton.jsx";
import EvalScoreBreakdown from "./EvalScoreBreakdown.jsx";
import AddToBundleButton from "./AddToBundleButton.jsx";
import { Badge } from "./ui/badge.jsx";
import { Card } from "./ui/card.jsx";

/** Format a star count for display: "1200" → "1.2k". */
function formatStars(n) {
  if (typeof n !== "number" || n <= 0) return null;
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset detail state when the selected skill changes
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
        {typeof skill.stars === "number" && skill.stars > 0 && (
          <Row label="GitHub" title="Source repository star count">
            <span className="flex items-center gap-1">
              <Star
                className="h-3.5 w-3.5 fill-[var(--fg)] text-[var(--fg)]"
                aria-hidden="true"
              />
              {formatStars(skill.stars)}
            </span>
          </Row>
        )}
        <Row label="Author stats">
          <Link
            to={`/profile/${encodeURIComponent(skill.owner)}`}
            className="text-[var(--brand)] hover:underline"
          >
            View stats for {skill.owner}
          </Link>
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
          <EvalScoreBreakdown summary={skill.evalSummary} />
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
                  Install the skill to your environment
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
