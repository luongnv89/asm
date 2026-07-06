import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import CopyButton from "../components/CopyButton";
import { Badge } from "../components/ui/badge";

/**
 * Author profile page — shows an author's skills across all indexed repos,
 * category distribution, and shareable URL.
 *
 * Data comes from the build-time author-stats.json artifact.
 */

function cssBar(value, max, width = 24) {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  return (
    <span className="inline-flex items-center">
      <span className="text-emerald-400">{"#".repeat(filled)}</span>
      <span className="text-[var(--fg-dim)]">{"-".repeat(empty)}</span>
    </span>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 className="text-lg font-semibold text-[var(--fg)] mt-6 mb-3 pb-2 border-b border-[var(--border)]">
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

export default function ProfilePage() {
  const { owner } = useParams();
  const [author, setAuthor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/author-stats.json")
      .then((r) => r.json())
      .then((data) => {
        const found = data?.stats?.find((a) => a.owner === owner);
        setAuthor(found || null);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [owner]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-[var(--fg-dim)]">Loading profile...</div>
      </div>
    );
  }

  if (!author) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <div className="text-xl font-semibold text-[var(--fg)] mb-2">
          Author not found
        </div>
        <p className="text-[var(--fg-dim)] mb-6">
          No indexed skills found for <strong>{owner}</strong>.
        </p>
        <Link to="/stats" className="text-[var(--brand)] hover:underline">
          ← Back to Stats
        </Link>
      </div>
    );
  }

  // Category distribution
  const catEntries = Object.entries(author.categories || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const maxCatCount = catEntries.length > 0 ? catEntries[0][1] : 1;

  // Build shareable URL
  const shareUrl = `${window.location.origin}/profile/${author.owner}`;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg)]">
            @{author.owner}
          </h1>
          <p className="text-[var(--fg-dim)] text-sm mt-1">
            Skill author across the indexed catalog
          </p>
        </div>
        <CopyButton text={shareUrl} size="sm" />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Skills" value={author.totalSkills} />
        <StatCard label="Repos" value={author.repos.length} />
        <StatCard label="Verified" value={author.verifiedCount} />
        <StatCard
          label="Avg Tokens"
          value={
            author.totalSkills > 0
              ? Math.round(author.totalTokens / author.totalSkills)
              : 0
          }
        />
      </div>

      {/* Shareable URL */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 mb-6">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--fg-dim)]">Share:</span>
          <code className="flex-1 text-[var(--fg)] truncate font-mono text-xs">
            {shareUrl}
          </code>
          <CopyButton text={shareUrl} size="sm" />
        </div>
      </div>

      {/* Category Distribution */}
      {catEntries.length > 0 && (
        <section>
          <SectionTitle>Category Distribution</SectionTitle>
          <div className="space-y-1">
            {catEntries.map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-3 text-sm">
                <span
                  className="w-32 text-right text-[var(--fg)] truncate"
                  title={cat}
                >
                  {cat}
                </span>
                <span className="flex-1">{cssBar(count, maxCatCount, 24)}</span>
                <span className="w-10 text-right font-mono text-[var(--fg-dim)]">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Repos */}
      <section className="mt-6">
        <SectionTitle>Repositories</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {author.repos.map((repo) => (
            <Badge key={repo} variant="secondary" className="text-xs">
              {repo}
            </Badge>
          ))}
        </div>
      </section>

      {/* Top Skills */}
      {author.topSkills.length > 0 && (
        <section className="mt-6">
          <SectionTitle>Top Skills</SectionTitle>
          <div className="space-y-2">
            {author.topSkills.map((s, i) => (
              <div
                key={`${s.name}-${s.repo}`}
                className="flex items-center gap-3 text-sm py-2 border-b border-[var(--border)] last:border-0"
              >
                <span className="w-6 text-right font-mono text-[var(--fg-muted)]">
                  {i + 1}
                </span>
                <span className="flex-1 font-medium text-[var(--fg)]">
                  {s.name}
                </span>
                <span className="text-[var(--fg-dim)] text-xs">{s.repo}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Back link */}
      <div className="mt-8">
        <Link
          to="/stats"
          className="text-[var(--brand)] hover:underline text-sm"
        >
          ← Back to Stats
        </Link>
      </div>
    </div>
  );
}
