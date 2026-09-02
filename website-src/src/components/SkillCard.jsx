import { memo } from "react";
import { Link } from "react-router-dom";
import { Star, Wrench } from "lucide-react";
import { Badge } from "./ui/badge.jsx";
import AddToCartButton from "./AddToCartButton.jsx";
import {
  formatStars,
  formatTokens,
  highlightMatches,
  encodeSkillId,
  skillRelPath,
} from "../lib/utils.js";

/**
 * Product card for a skill in the storefront grid.
 *
 * The tile on top stands in for a product photo: a hatched panel that
 * leads with the two numbers a shopper compares first — the asm eval
 * score (the "price tag") and the source repo's GitHub stars (social
 * proof). Featured/official flags sit in the tile's top corner. The
 * title is a stretched
 * link (see `.shop-link::after` in shop.css) so the whole card opens
 * the product page while the cart button stays independently
 * clickable. `locationSearch` is preserved on the link so active
 * filters and the current page survive the selection.
 */
function SkillCard({
  skill,
  index = 0,
  searchQuery,
  searchTerms,
  locationSearch,
  hasNameCollision,
}) {
  const nameHtml = highlightMatches(skill.name, searchQuery, searchTerms);
  const descHtml = highlightMatches(
    skill.description,
    searchQuery,
    searchTerms,
  );
  const usesTools =
    skill.hasTools === true ||
    (Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0);
  const isOfficial = skill.owner === "anthropics";
  const isVerified = skill.verified === true;
  const isFeatured = skill.featured === true;
  const score = skill.evalSummary || null;
  // When the same name appears at multiple install paths inside one repo
  // (plugin-bundle variants — issue #241) surface the distinguishing
  // relPath so the card is no longer visually identical to its siblings.
  const collisionPath = hasNameCollision ? skillRelPath(skill.installUrl) : "";
  const stars = formatStars(skill.stars);
  const tone = hashTone(skill.id || skill.name);

  return (
    <article
      className="shop-card shop-reveal"
      style={{ "--i": index }}
      data-skill-id={skill.id}
    >
      <div className="shop-tile" data-tone={tone}>
        {(isFeatured || isOfficial) && (
          <div className="shop-tile-flags">
            {isFeatured && <Badge tone="featured">★ featured</Badge>}
            {isOfficial && <Badge tone="official">official</Badge>}
          </div>
        )}
        <div className="shop-tile-stats">
          {score ? (
            <span
              className="shop-sticker"
              data-grade={score.grade}
              title={`asm eval score: ${score.overallScore}/100 (grade ${score.grade})`}
            >
              <b>{score.overallScore}</b>
              <small>/100 · {score.grade}</small>
            </span>
          ) : (
            <span className="shop-sticker" title="No asm eval score yet">
              <b aria-hidden="true">–</b>
              <small>not scored</small>
            </span>
          )}
          {stars && (
            <span
              className="shop-stars"
              title={`${skill.owner}/${skill.repo} GitHub stars`}
            >
              <Star aria-hidden="true" />
              <b>{stars}</b>
              <small>stars</small>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-3.5 pt-3 pb-3">
        <h3 className="shop-name leading-snug">
          <Link
            to={{
              pathname: `/skills/${encodeSkillId(skill.id)}`,
              search: locationSearch,
            }}
            className="shop-link"
            dangerouslySetInnerHTML={{ __html: nameHtml }}
          />
        </h3>
        <div
          className="shop-meta truncate"
          title={`${skill.owner}/${skill.repo}`}
        >
          {skill.owner}/{skill.repo}
        </div>
        {collisionPath && (
          <div
            className="shop-meta truncate"
            title={"Install path: " + collisionPath}
          >
            {collisionPath}
          </div>
        )}
        <p
          className="shop-desc line-clamp-2"
          dangerouslySetInnerHTML={{ __html: descHtml }}
        />
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1.5">
          {isVerified && (
            <Badge tone="verified" title="Verified source">
              ✓ verified
            </Badge>
          )}
          {typeof skill.tokenCount === "number" && (
            <Badge tone="tokens" title="Estimated tokens in SKILL.md">
              {formatTokens(skill.tokenCount)}
            </Badge>
          )}
          {usesTools && (
            <Badge tone="warn" title="This skill uses tools" className="gap-1">
              <Wrench className="h-3 w-3" aria-hidden="true" />
              tools
            </Badge>
          )}
          {(skill.categories || []).slice(0, 2).map((c) => (
            <Badge key={c} tone="cat">
              {c}
            </Badge>
          ))}
        </div>
      </div>

      <footer className="shop-above border-t border-[var(--border)] px-3.5 py-2.5">
        <AddToCartButton skill={skill} variant="card" />
      </footer>
    </article>
  );
}

/** Deterministic 0–3 tone from an id so tiles vary but stay stable. */
function hashTone(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 4;
}

export default memo(SkillCard);
