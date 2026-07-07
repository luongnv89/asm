import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCatalog } from "../hooks/useCatalog.jsx";
import { Badge } from "../components/ui/badge";
import CopyButton from "../components/CopyButton";

/**
 * Stats overview page — shows top repos by skill count, top authors,
 * and category distribution with CSS bar charts.
 *
 * Data comes from the build-time artifacts (repo-stats.json, author-stats.json,
 * index-stats.json) shipped alongside the catalog.
 */

function cssBar(value, max) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <span className="block h-2 min-w-0 rounded-full bg-[var(--bg-muted)]">
      <span
        className="block h-2 rounded-full bg-emerald-400"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

function profileShareUrl(owner) {
  if (typeof window === "undefined") return `#/profile/${owner}`;
  return `${window.location.origin}${window.location.pathname}#/profile/${encodeURIComponent(owner)}`;
}

function SectionTitle({ children }) {
  return (
    <h2 className="text-lg font-semibold text-[var(--fg)] mt-8 mb-3 pb-2 border-b border-[var(--border)]">
      {children}
    </h2>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4">
      <div className="text-sm text-[var(--fg-dim)]">{label}</div>
      <div className="text-2xl font-bold text-[var(--fg)] mt-1">{value}</div>
      {sub && <div className="text-xs text-[var(--fg-muted)] mt-1">{sub}</div>}
    </div>
  );
}

export default function StatsPage() {
  const { catalog } = useCatalog();
  const [repoStats, setRepoStats] = useState(null);
  const [authorStats, setAuthorStats] = useState(null);
  const [indexStats, setIndexStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("repo-stats.json")
        .then((r) => r.json())
        .catch(() => null),
      fetch("author-stats.json")
        .then((r) => r.json())
        .catch(() => null),
      fetch("index-stats.json")
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([rs, as, is]) => {
      setRepoStats(rs?.stats || []);
      setAuthorStats(as?.stats || []);
      setIndexStats(is?.stats || null);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-[var(--fg-dim)]">Loading statistics...</div>
      </div>
    );
  }

  // Fallback to catalog data if build artifacts not available
  const repos = repoStats || catalog?.repos || [];
  const authors = authorStats || [];
  const idx = indexStats;

  // Category distribution from catalog
  const catCounts = {};
  if (catalog?.skills) {
    for (const s of catalog.skills) {
      for (const c of s.categories || []) {
        catCounts[c] = (catCounts[c] || 0) + 1;
      }
    }
  }
  const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
  const maxCatCount = catEntries.length > 0 ? catEntries[0][1] : 1;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg)]">Stats</h1>
          <p className="text-[var(--fg-dim)] text-sm mt-1">
            Skill catalog statistics and rankings
          </p>
        </div>
        <CopyButton text={window.location.href} size="sm" />
      </div>

      {/* Index overview */}
      {idx && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Repos" value={idx.totalRepos} />
          <StatCard label="Skills" value={idx.totalSkills} />
          <StatCard label="Authors" value={idx.totalAuthors} />
          <StatCard label="Verified" value={idx.verifiedCount} />
        </div>
      )}

      {/* Category Distribution */}
      {catEntries.length > 0 && (
        <section>
          <SectionTitle>Category Distribution</SectionTitle>
          <div className="space-y-1">
            {catEntries.map(([cat, count]) => (
              <div
                key={cat}
                className="grid grid-cols-[minmax(5rem,8rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm"
              >
                <span
                  className="text-right text-[var(--fg)] truncate"
                  title={cat}
                >
                  {cat}
                </span>
                <span className="min-w-0">{cssBar(count, maxCatCount)}</span>
                <span className="text-right font-mono text-[var(--fg-dim)]">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top Repos */}
      <section className="mt-8">
        <SectionTitle>Top Repositories</SectionTitle>
        <div className="space-y-2">
          {repos.slice(0, 15).map((r, i) => (
            <div
              key={`${r.owner}/${r.repo}`}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:grid-cols-[1.5rem_minmax(0,1fr)_6rem_auto] items-center gap-3 text-sm py-2 border-b border-[var(--border)] last:border-0"
            >
              <span className="w-6 text-right font-mono text-[var(--fg-muted)]">
                {i + 1}
              </span>
              <a
                href={r.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 font-medium text-[var(--fg)] hover:text-[var(--brand)] transition-colors truncate"
                title={`${r.owner}/${r.repo}`}
              >
                {r.owner}/{r.repo}
              </a>
              <span
                className="hidden sm:block text-[var(--fg-dim)] text-xs truncate"
                title={r.description}
              >
                {r.description?.slice(0, 40)}
              </span>
              <Badge variant="secondary" className="text-xs">
                {r.skillCount} skills
              </Badge>
            </div>
          ))}
          {repos.length === 0 && (
            <div className="text-[var(--fg-dim)] text-sm py-4">
              No repository data available.
            </div>
          )}
        </div>
      </section>

      {/* Top Authors */}
      <section className="mt-8">
        <SectionTitle>Top Authors</SectionTitle>
        <div className="space-y-2">
          {authors.slice(0, 15).map((a, i) => (
            <div
              key={a.owner}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] sm:grid-cols-[1.5rem_minmax(0,1fr)_auto_auto_auto] items-center gap-3 text-sm py-2 border-b border-[var(--border)] last:border-0"
            >
              <span className="w-6 text-right font-mono text-[var(--fg-muted)]">
                {i + 1}
              </span>
              <Link
                to={`/profile/${encodeURIComponent(a.owner)}`}
                className="min-w-0 font-medium text-[var(--fg)] hover:text-[var(--brand)] transition-colors truncate"
              >
                {a.owner}
              </Link>
              <span className="hidden sm:inline text-[var(--fg-dim)] text-xs">
                {a.repos.length} repo{a.repos.length !== 1 ? "s" : ""}
              </span>
              <Badge variant="secondary" className="text-xs">
                {a.totalSkills} skills
              </Badge>
              <CopyButton text={profileShareUrl(a.owner)} size="sm" />
            </div>
          ))}
          {authors.length === 0 && (
            <div className="text-[var(--fg-dim)] text-sm py-4">
              No author data available.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
