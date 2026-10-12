import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { formatStars, formatTokens } from "../lib/utils.js";
import CopyButton from "./CopyButton.jsx";
import EvalScoreBreakdown from "./EvalScoreBreakdown.jsx";
import { Badge } from "./ui/badge.jsx";
import { Card } from "./ui/card.jsx";

/**
 * Product-page body for a skill: title, description, spec sheet, eval
 * breakdown, and the three-step Quick Start. Rendered in the left
 * column of `CatalogPage`'s product view, beside `SkillBuyBox`.
 *
 * Lazy-loads the full per-skill JSON from `slim.detailPath`; while
 * that's in flight the slim row already provides all the fields
 * needed to render a first paint. An in-memory cache keyed by
 * detailPath eliminates redundant fetches when navigating between
 * skills and back.
 *
 * A network failure ("Failed to fetch") or a 5xx/408/429 response is
 * retried with a short backoff before giving up (issue #737). If the
 * details still cannot be loaded, a plain-language message with a
 * "Try again" button is shown; the slim row keeps the summary and the
 * install command usable either way.
 *
 * Props:
 *   - slim: the slim row from catalog.skills (required)
 */
const detailCache = new Map();

/** Backoff before each automatic retry; its length is the retry count. */
const RETRY_DELAYS_MS = [500, 1500];

/** Error raised for a non-2xx response, flagged when worth retrying. */
class DetailHttpError extends Error {
  constructor(status) {
    super("HTTP " + status);
    this.retryable = status >= 500 || status === 408 || status === 429;
  }
}

/**
 * `fetch` rejects with a TypeError ("Failed to fetch" in Chromium) for
 * any network-level failure: offline, DNS, reset connection, or a
 * service worker answering with Response.error().
 */
function isRetryable(err) {
  return err instanceof TypeError || err?.retryable === true;
}

function describeDetailError(err) {
  if (err instanceof TypeError) {
    return "The network request failed. Check your connection and try again.";
  }
  if (err instanceof DetailHttpError) {
    return `The server responded with ${err.message}.`;
  }
  return "The details file could not be read.";
}

export default function SkillDetail({ slim }) {
  const [detail, setDetail] = useState({
    data: null,
    loading: true,
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!slim?.detailPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset detail state when the selected skill changes
      setDetail({ data: null, loading: false, error: null });
      return;
    }
    const path = slim.detailPath;

    // Check cache first
    const cached = detailCache.get(path);
    if (cached) {
      setDetail({ data: cached, loading: false, error: null });
      return;
    }

    let cancelled = false;
    let retryTimer = null;
    const controller = new AbortController();
    setDetail({ data: null, loading: true, error: null });
    const load = async (attempt) => {
      try {
        const res = await fetch(path, { signal: controller.signal });
        if (!res.ok) throw new DetailHttpError(res.status);
        const data = await res.json();
        if (cancelled) return;
        // Store in cache
        detailCache.set(path, data);
        setDetail({ data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        if (isRetryable(err) && attempt < RETRY_DELAYS_MS.length) {
          retryTimer = setTimeout(
            () => load(attempt + 1),
            RETRY_DELAYS_MS[attempt],
          );
          return;
        }
        setDetail({
          data: null,
          loading: false,
          error: describeDetailError(err),
        });
      }
    };
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      controller.abort();
    };
  }, [slim?.detailPath, reloadKey]);

  const skill = useMemo(() => detail.data || slim, [detail.data, slim]);
  if (!skill) return null;

  return (
    <div className="shop flex flex-col gap-6 min-w-0">
      <header className="flex flex-col gap-3">
        <div className="shop-kicker">
          <span className="dot" aria-hidden="true" />
          {skill.owner}/{skill.repo}
        </div>
        <h1 className="shop-product-title">{skill.name}</h1>
        <p className="shop-lede">{skill.description}</p>
        <div className="flex flex-wrap items-center gap-1">
          {skill.verified ? (
            <Badge tone="verified">✓ verified</Badge>
          ) : (
            <Badge tone="default">unverified</Badge>
          )}
          {skill.owner === "anthropics" && (
            <Badge tone="official">official</Badge>
          )}
          {(skill.categories || []).map((c) => (
            <Badge key={c} tone="cat">
              {c}
            </Badge>
          ))}
        </div>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="shop-label">Details</h2>
        <dl className="shop-specs">
          {skill.version && skill.version !== "0.0.0" && (
            <Row label="Version">{skill.version}</Row>
          )}
          <Row label="License">{skill.license || "not declared"}</Row>
          {skill.creator && <Row label="Creator">{skill.creator}</Row>}
          {skill.compatibility && (
            <Row label="Compat">{skill.compatibility}</Row>
          )}
          {typeof skill.tokenCount === "number" && (
            <Row
              label="Est. tokens"
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
            </a>{" "}
            <Link
              to={`/repos/${encodeURIComponent(skill.owner)}/${encodeURIComponent(skill.repo)}`}
              className="text-[var(--brand)] hover:underline"
            >
              (view all skills)
            </Link>
          </Row>
          {typeof skill.stars === "number" && skill.stars > 0 && (
            <Row label="GitHub" title="Source repository star count">
              <span className="inline-flex items-center gap-1">
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
        </dl>
      </section>

      <Card className="p-4 rounded-xl">
        <h2 className="shop-label mb-3">asm eval score</h2>
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
        <Card className="p-4 rounded-xl">
          <h2 id="quick-start" className="shop-label mb-4">
            Quick Start
          </h2>
          <div className="flex flex-col gap-4" role="list">
            <Step
              n="1"
              of="3"
              title="Security Check"
              blurb="Check for security issues before installation"
              cmd={`asm audit security ${skill.installUrl}`}
            />
            <div className="border-t border-[var(--border)]" />
            <Step
              n="2"
              of="3"
              title="Quality Evaluation"
              blurb="Evaluate skill quality and metadata"
              cmd={`asm eval ${skill.installUrl}`}
            />
            <div className="border-t border-[var(--border)]" />
            <Step
              n="3"
              of="3"
              title="Install"
              blurb="Install the skill to your environment"
              cmd={`asm install ${skill.installUrl}`}
            />
          </div>
        </Card>
      )}

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

      {detail.loading && <p className="shop-meta">Loading details…</p>}
      {detail.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-2 rounded-md border border-[var(--warn)] bg-[var(--warn-bg)] px-3 py-1 text-xs text-[var(--fg)]"
        >
          <span>
            <span className="text-[var(--warn)]" aria-hidden="true">
              ⚠
            </span>{" "}
            Could not load full details. {detail.error} The summary and install
            command above still work.
          </span>
          <button
            type="button"
            className="inline-flex min-h-11 items-center px-2 -mx-2 underline underline-offset-2 hover:text-[var(--brand)] transition-colors"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function Step({ n, of, title, blurb, cmd }) {
  return (
    <div
      className="flex gap-3"
      role="listitem"
      aria-label={`Step ${n} of ${of}: ${title}`}
    >
      <div
        className="shop-mono flex-shrink-0 w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--bg-input)] flex items-center justify-center text-xs font-semibold text-[var(--fg)]"
        aria-hidden="true"
      >
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--fg)] mb-1">{title}</div>
        <div className="text-xs text-[var(--fg-dim)] mb-2">{blurb}</div>
        <div className="shop-cmd">
          <span className="prompt" aria-hidden="true">
            $
          </span>
          <code aria-label={`Command: ${cmd}`}>{cmd}</code>
          <CopyButton text={cmd} size="sm" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, children, title }) {
  return (
    <>
      <dt title={title}>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
