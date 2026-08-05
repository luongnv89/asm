import { Link } from "react-router-dom";
import { encodeSkillId } from "../lib/utils.js";
import CopyButton from "./CopyButton.jsx";
import { Card } from "./ui/card.jsx";
import { Badge } from "./ui/badge.jsx";

/**
 * Reusable bundle detail view. Rendered on the right pane when a
 * bundle is selected from the sidebar list.
 *
 * Props:
 *   - bundle: a row from bundles.json#bundles (required)
 */
export default function BundleDetail({ bundle }) {
  if (!bundle) return null;
  const skills = bundle.skills || [];
  const tags = bundle.tags || [];
  const installCmd = "asm bundle install " + (bundle.name || "");

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--fg)]">
          {bundle.name}
        </h1>
        <p className="text-sm text-[var(--fg-dim)] mt-2 leading-relaxed">
          {bundle.description}
        </p>
        {bundle.author && (
          <div className="text-xs text-[var(--fg-muted)] mt-1">
            by {bundle.author}
          </div>
        )}
      </header>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Badge key={t} tone="cat">
              {t}
            </Badge>
          ))}
        </div>
      )}

      <Card className="flex items-center gap-2 p-3">
        <code className="flex-1 text-xs font-mono text-[var(--fg)] truncate">
          {installCmd}
        </code>
        <CopyButton text={installCmd} size="md" />
      </Card>

      <div>
        <h2 className="text-xs uppercase tracking-wide text-[var(--fg-muted)] mb-2">
          Included skills ({skills.length})
        </h2>
        {skills.length === 0 ? (
          <p className="text-sm text-[var(--fg-dim)]">
            No skills in this bundle.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {skills.map((sk) => {
              const skillInstall =
                sk.installUrl && "asm install " + sk.installUrl;
              return (
                <li
                  key={sk.id || sk.installUrl || sk.name}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    {sk.id ? (
                      <Link
                        to={`/skills/${encodeSkillId(sk.id)}`}
                        className="min-h-11 min-w-11 -m-2 px-2 inline-flex items-center font-mono text-sm text-[var(--fg)] hover:text-[var(--brand)] transition-colors"
                      >
                        {sk.name}
                      </Link>
                    ) : (
                      <span className="font-mono text-sm text-[var(--fg)]">
                        {sk.name}
                      </span>
                    )}
                    {skillInstall && (
                      <CopyButton
                        text={skillInstall}
                        size="sm"
                        label="copy"
                        ariaLabel={`Copy install command for ${sk.name}`}
                      />
                    )}
                  </div>
                  {sk.description && (
                    <p className="text-xs text-[var(--fg-dim)] mt-1 leading-relaxed">
                      {sk.description}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
