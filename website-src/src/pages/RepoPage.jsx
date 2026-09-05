import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useCatalog } from "../hooks/useCatalog.jsx";
import { buildNameCollisionKeys } from "../lib/filter-sort.js";
import { formatStars } from "../lib/utils.js";
import SkillCard from "../components/SkillCard.jsx";
import CopyButton from "../components/CopyButton.jsx";

/**
 * Repo detail page — header for one `owner/repo` plus a grid of all its
 * skills. Header facts come from `catalog.repos` (description, maintainer,
 * skillCount, stars, repoUrl) enriched by `repo-stats.json` aggregates
 * (categories, verifiedCount); the skill list is filtered from the catalog
 * via `useCatalog()` and rendered with the same `SkillCard` as the shop
 * floor. Unknown repos render a not-found state.
 */

function repoShareUrl(owner, repo) {
  if (typeof window === "undefined") return `#/repos/${owner}/${repo}`;
  return `${window.location.origin}${window.location.pathname}#/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export default function RepoPage() {
  const { owner, repo } = useParams();
  const { loading: catalogLoading, catalog } = useCatalog();
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    fetch("repo-stats.json")
      .then((r) => r.json())
      .then((data) => {
        const found = data?.stats?.find(
          (r) => r.owner === owner && r.repo === repo,
        );
        setStats(found || null);
      })
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, [owner, repo]);

  const repoMeta = useMemo(
    () =>
      catalog?.repos?.find((r) => r.owner === owner && r.repo === repo) || null,
    [catalog, owner, repo],
  );

  const skills = useMemo(() => {
    if (!catalog?.skills) return [];
    return catalog.skills.filter((s) => s.owner === owner && s.repo === repo);
  }, [catalog, owner, repo]);

  const collisionKeys = useMemo(
    () => (catalog ? buildNameCollisionKeys(catalog.skills) : null),
    [catalog],
  );

  if (catalogLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-[var(--fg-dim)]">Loading repository...</div>
      </div>
    );
  }

  if (!repoMeta && !stats && skills.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <div className="text-xl font-semibold text-[var(--fg)] mb-2">
          Repository not found
        </div>
        <p className="text-[var(--fg-dim)] mb-6">
          No indexed skills found for{" "}
          <strong>
            {owner}/{repo}
          </strong>
          .
        </p>
        <Link to="/stats" className="text-[var(--brand)] hover:underline">
          ← Back to Stats
        </Link>
      </div>
    );
  }

  const description = repoMeta?.description || "";
  const maintainer = repoMeta?.maintainer || "";
  const repoUrl =
    repoMeta?.repoUrl ||
    stats?.repoUrl ||
    `https://github.com/${owner}/${repo}`;
  const skillCount = repoMeta?.skillCount ?? stats?.skillCount ?? skills.length;
  const stars = repoMeta?.stars;
  const verifiedCount =
    stats?.verifiedCount ?? skills.filter((s) => s.verified).length;
  const catEntries = Object.entries(stats?.categories || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const shareUrl = repoShareUrl(owner, repo);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--fg)] truncate">
            {owner}/{repo}
          </h1>
          {description && (
            <p className="text-[var(--fg-dim)] text-sm mt-1">{description}</p>
          )}
          {maintainer && (
            <p className="text-[var(--fg-muted)] text-xs mt-1">
              Maintainer: {maintainer}
            </p>
          )}
        </div>
        <CopyButton text={shareUrl} size="sm" />
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2 text-sm mb-6">
        <span className="text-[var(--fg-dim)]">
          {skillCount} skill{skillCount !== 1 ? "s" : ""}
        </span>
        {verifiedCount > 0 && (
          <span className="text-[var(--fg-dim)]">
            · {verifiedCount} verified
          </span>
        )}
        {formatStars(stars) && (
          <span className="text-[var(--fg-dim)]" title="GitHub stars">
            · ★ {formatStars(stars)}
          </span>
        )}
        <a
          className="text-[var(--brand)] hover:underline"
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub →
        </a>
        <Link
          to={`/skills?repo=${encodeURIComponent(owner + "/" + repo)}`}
          className="text-[var(--brand)] hover:underline"
        >
          Filter in catalog
        </Link>
      </div>

      {/* Categories */}
      {catEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          {catEntries.map(([c, n]) => (
            <Link
              key={c}
              to={`/skills?repo=${encodeURIComponent(owner + "/" + repo)}&cat=${encodeURIComponent(c)}`}
              className="text-xs rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--fg-dim)] hover:text-[var(--brand)] hover:border-[var(--brand)]"
              title={`${n} skill${n !== 1 ? "s" : ""} in ${c}`}
            >
              {c} · {n}
            </Link>
          ))}
        </div>
      )}

      {/* Skills grid */}
      <section aria-label="Repository skills">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {skills.map((s, i) => (
            <SkillCard
              key={s.id}
              skill={s}
              index={i}
              searchQuery=""
              searchTerms={null}
              locationSearch=""
              hasNameCollision={
                !!collisionKeys &&
                collisionKeys.has(s.owner + "/" + s.repo + "::" + s.name)
              }
            />
          ))}
        </div>
        {skills.length === 0 && (
          <div className="text-[var(--fg-dim)] text-sm py-8 text-center">
            No skills indexed for this repository yet.
          </div>
        )}
      </section>

      {/* Related: other repos by the same owner are reachable via profile */}
      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        <Link
          to={`/profile/${encodeURIComponent(owner)}`}
          className="text-[var(--brand)] hover:underline"
        >
          View stats for {owner}
        </Link>
        <Link to="/stats" className="text-[var(--brand)] hover:underline">
          ← Back to Stats
        </Link>
      </div>
    </div>
  );
}
