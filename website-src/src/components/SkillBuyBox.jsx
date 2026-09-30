import { ExternalLink, Star } from "lucide-react";
import { formatStars, formatTokens } from "../lib/utils.js";
import { evalScoreClass } from "../lib/utils.js";
import AddToCartButton from "./AddToCartButton.jsx";
import CopyButton from "./CopyButton.jsx";

/**
 * Sticky "buy box" for a skill product page — the column a shop puts
 * price, stock, and the add-to-cart button in. Here the "price" is the
 * asm eval score, the "stock facts" are trust signals, and checkout is
 * the install command.
 */
export default function SkillBuyBox({ skill }) {
  if (!skill) return null;
  const score = skill.evalSummary || null;
  const installCmd = skill.installUrl ? `asm install ${skill.installUrl}` : "";
  const usesTools =
    skill.hasTools === true ||
    (Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0);

  return (
    <aside className="shop-buybox" aria-label="Install this skill">
      <div className="flex items-end justify-between gap-3">
        {score ? (
          <div>
            <div className="shop-label">asm eval score</div>
            <div className={`shop-price ${gradeText(score.overallScore)}`}>
              {score.overallScore}
              <small>/100 · grade {score.grade}</small>
            </div>
          </div>
        ) : (
          <div>
            <div className="shop-label">asm eval score</div>
            <div className="shop-price text-[var(--fg-muted)]">
              —<small>not scored yet</small>
            </div>
          </div>
        )}
      </div>

      <ul className="shop-facts">
        <li>
          <span>Source</span>
          <span>{skill.verified ? "✓ verified" : "unverified"}</span>
        </li>
        <li>
          <span>License</span>
          <span>{skill.license || "not declared"}</span>
        </li>
        {typeof skill.tokenCount === "number" && (
          <li>
            <span>Context cost</span>
            <span>{formatTokens(skill.tokenCount)}</span>
          </li>
        )}
        {typeof skill.stars === "number" && skill.stars > 0 && (
          <li>
            <span>Repo stars</span>
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3 fill-current" aria-hidden="true" />
              {formatStars(skill.stars)}
            </span>
          </li>
        )}
        <li>
          <span>Uses tools</span>
          <span className={usesTools ? "text-[var(--warn)]" : undefined}>
            {usesTools ? "yes" : "no"}
          </span>
        </li>
      </ul>

      {installCmd && (
        <div className="flex flex-col gap-1.5">
          <div className="shop-label">Install</div>
          <div className="shop-cmd">
            <span className="prompt" aria-hidden="true">
              $
            </span>
            <code>{installCmd}</code>
            <CopyButton
              text={installCmd}
              size="sm"
              ariaLabel="Copy install command"
            />
          </div>
        </div>
      )}

      <AddToCartButton skill={skill} />
      <p className="shop-meta -mt-2">
        Cart items export as one installable bundle.
      </p>

      {skill.skillUrl && (
        <a
          href={skill.skillUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shop-mono inline-flex items-center gap-1.5 text-xs text-[var(--fg-dim)] hover:text-[var(--brand)]"
        >
          Source on GitHub
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
    </aside>
  );
}

function gradeText(overall) {
  const cls = evalScoreClass(overall);
  if (cls === "eval-a") return "text-[var(--brand)]";
  if (cls === "eval-b") return "text-[var(--fg)]";
  if (cls === "eval-c") return "text-[var(--warn)]";
  return "text-[var(--fg-dim)]";
}
