import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCatalog } from "../hooks/useCatalog.jsx";
import { decodeSkillId, evalScoreClass, formatTokens } from "../lib/utils.js";
import CopyButton from "../components/CopyButton.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Card } from "../components/ui/card.jsx";

/**
 * Skill detail view. Port of the legacy modal — now a dedicated route so
 * the URL is deep-linkable (acceptance criterion). Lazy-loads the per-
 * skill JSON from `website/skills/<hash>.json` via the slim row's
 * `detailPath`.
 */
export default function SkillDetailPage() {
  const { id } = useParams();
  const decodedId = useMemo(() => decodeSkillId(id), [id]);
  const { catalog, loading } = useCatalog();
  const slim = useMemo(
    () => (catalog ? catalog.skills.find((s) => s.id === decodedId) : null),
    [catalog, decodedId],
  );

  const [detail, setDetail] = useState({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!slim?.detailPath) return;
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

  if (loading) {
    return (
      <div className="py-12 text-center text-[var(--fg-dim)]">
        Loading catalog…
      </div>
    );
  }
  if (!slim) {
    return (
      <div className="py-12 text-center">
        <p className="text-[var(--fg)]">Skill not found.</p>
        <Link to="/" className="text-[var(--brand)] hover:underline text-sm">
          ← Back to catalog
        </Link>
      </div>
    );
  }

  const skill = detail.data || slim;
  const cmd = "asm install " + skill.installUrl;
  const evalScoreCls = skill.evalSummary
    ? evalScoreClass(skill.evalSummary.overallScore)
    : "";

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div>
        <Link
          to="/"
          className="text-xs text-[var(--fg-dim)] hover:text-[var(--brand)]"
        >
          ← Back to catalog
        </Link>
      </div>
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

      <Card className="flex items-center gap-2 p-3">
        <code className="flex-1 text-xs font-mono text-[var(--fg)] truncate">
          {cmd}
        </code>
        <CopyButton text={cmd} size="md" />
      </Card>

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
