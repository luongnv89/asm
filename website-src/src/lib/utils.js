/**
 * Shared helpers ported from `website/index.html`. Keep behaviour identical
 * so search, sort, filter, and rendering produce the same results as the
 * legacy UI. Where a helper is a pure copy, the comment notes the origin.
 */

// License bucketing — group near-duplicate license strings into canonical
// buckets so the facet pill row stays readable. Display-only transformation;
// raw strings are still shown in the detail view.
export function licenseBucket(raw) {
  if (!raw) return "Unknown";
  const s = String(raw).toLowerCase();
  if (/\bmit\b/.test(s)) return "MIT";
  if (/apache/.test(s)) return "Apache-2.0";
  if (/\bbsd\b/.test(s)) return "BSD";
  if (/\bgpl|gnu general public/.test(s)) return "GPL";
  if (/\bcc[- ]?by|creative commons/.test(s)) return "CC";
  if (/\bcecill\b/.test(s)) return "CeCILL";
  if (/^license$/.test(s.trim())) return "Unknown";
  return "Other";
}

// Source bucketing — derive from owner/verified flag.
export function skillSource(s) {
  if (s.owner === "anthropics") return "official";
  if (s.verified === true) return "verified";
  return "community";
}

// Format an estimated token count as "~N tokens" / "~1.2k tokens" /
// "~12k tokens". Mirrors src/utils/token-count.ts:formatTokenCount so the
// website + CLI agree.
export function formatTokens(count) {
  if (typeof count !== "number" || !isFinite(count) || count < 0)
    return "~0 tokens";
  if (count < 1000) return "~" + count + " tokens";
  if (count < 10000) {
    const k = (count / 1000).toFixed(1).replace(/\.0$/, "");
    return "~" + k + "k tokens";
  }
  return "~" + Math.round(count / 1000) + "k tokens";
}

// Pick a CSS class suffix for a 0..100 eval score so the badge colour
// reflects quality. Returns "eval-a", "eval-b", ..., "eval-f".
export function evalScoreClass(score) {
  if (typeof score !== "number") return "";
  if (score >= 90) return "eval-a";
  if (score >= 80) return "eval-b";
  if (score >= 65) return "eval-c";
  if (score >= 50) return "eval-d";
  return "eval-f";
}

export function setToCsv(set) {
  return Array.from(set).join(",");
}

export function csvToSet(csv) {
  if (!csv) return new Set();
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Tokenize a query the same way MiniSearch does (roughly) so the highlight
// matcher finds the same word boundaries the search did.
function tokenizeQuery(query) {
  return query
    .trim()
    .toLowerCase()
    .split(/[\s\-_.,;:()[\]{}"']+/)
    .filter((t) => t.length >= 2);
}

const escapeHtmlEl =
  typeof document !== "undefined" ? document.createElement("span") : null;

// Escape HTML for use in dangerouslySetInnerHTML. Only called by the
// highlighter — normal React text rendering escapes for us automatically.
function escapeHtml(str) {
  if (!escapeHtmlEl) {
    // jsdom-less test environment shouldn't hit this path, but fall back
    // to a manual escape so a unit test doesn't crash.
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  escapeHtmlEl.textContent = str || "";
  return escapeHtmlEl.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Wrap matching tokens in `<mark class="hl">`. Returns an HTML string that
 * must be rendered via `dangerouslySetInnerHTML`. Safe because escapeHtml()
 * is applied before any replacement, so only `<mark>` tags are introduced.
 *
 * @param {string} text Plain text to highlight.
 * @param {string} query Raw search query.
 * @param {string[] | null | undefined} terms Optional MiniSearch term list.
 */
export function highlightMatches(text, query, terms) {
  const escaped = escapeHtml(text);
  let tokens;
  if (terms && terms.length) {
    tokens = terms
      .map((t) => String(t).toLowerCase())
      .filter((t) => t.length >= 2);
  } else {
    if (!query || !query.trim()) return escaped;
    tokens = tokenizeQuery(query);
  }
  if (!tokens.length) return escaped;
  // Dedupe + sort by length (longest first) so overlapping matches prefer
  // the most specific token, and escape regex metacharacters.
  const uniq = Array.from(new Set(tokens)).sort((a, b) => b.length - a.length);
  const pattern = uniq
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp("(" + pattern + ")", "gi");
  const entitySplitRe = /(&(?:#\d+|#x[a-f0-9]+|[a-z0-9]+);)/gi;
  const entityPartRe = /^&(?:#\d+|#x[a-f0-9]+|[a-z0-9]+);$/i;
  return escaped
    .split(entitySplitRe)
    .map((part) =>
      entityPartRe.test(part)
        ? part
        : part.replace(re, '<mark class="hl">$1</mark>'),
    )
    .join("");
}

// Encode a skill id for safe use in a URL path segment. Slashes, colons,
// and double-colons must survive round-trip through react-router.
export function encodeSkillId(id) {
  return encodeURIComponent(id);
}

export function decodeSkillId(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

// Copy a string to the clipboard with a `document.execCommand` fallback
// for ancient browsers / non-secure contexts. Returns a promise that
// resolves regardless of the path used.
export async function copyToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}
