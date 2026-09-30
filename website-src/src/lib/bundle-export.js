/**
 * Client-side bundle export helpers (#238). Pure functions so they
 * can be unit-tested without a DOM. The canonical Node-side bundle
 * validator lives in `src/bundler.ts`; we deliberately don't port it
 * — instead we validate only what the user can influence in the
 * builder form, and let the CLI catch anything else at install time.
 */

const REPO_OWNER = "luongnv89";
const REPO_NAME = "asm";

/**
 * Defaults applied when the user exports without filling in the
 * checkout form (#626). Every field the CLI's `validateBundle()` in
 * `src/bundler.ts` requires (non-empty `name`, `description`,
 * `author`) gets a sensible value, so a zero-input download is still
 * a valid, installable bundle. `name` is JSON-filename-safe per the
 * form's name check below.
 */
export const DEFAULT_BUNDLE_META = {
  name: "my-bundle",
  description: "Skill bundle exported from the ASM catalog.",
  author: "anonymous",
};

/**
 * Return a copy of `meta` with blank fields replaced by
 * `DEFAULT_BUNDLE_META`. Whitespace-only counts as blank.
 */
export function withBundleDefaults(meta = {}) {
  const pick = (key) => {
    const v = (meta[key] ?? "").toString().trim();
    return v ? v : DEFAULT_BUNDLE_META[key];
  };
  return {
    ...meta,
    name: pick("name"),
    description: pick("description"),
    author: pick("author"),
  };
}

/**
 * Build a `BundleManifest` (matching `src/utils/types.ts`) from the
 * in-memory cart + the metadata form values. `createdAt` is set here
 * — not when the cart row is added — so the timestamp reflects when
 * the user exported, not when they started shopping.
 */
export function buildBundleJson(skills, meta, now = new Date()) {
  const effective = withBundleDefaults(meta);
  const tags = splitTags(effective.tags);
  const manifest = {
    version: 1,
    name: effective.name,
    description: effective.description,
    author: effective.author,
    createdAt: now.toISOString(),
    skills: skills.map((s) => {
      const ref = {
        name: s.name,
        installUrl: s.installUrl,
      };
      if (s.description) ref.description = s.description;
      if (s.version && s.version !== "0.0.0") ref.version = s.version;
      return ref;
    }),
  };
  if (tags.length > 0) manifest.tags = tags;
  return manifest;
}

/**
 * Validate the fields the user can influence in the builder form.
 * Only ≥ 1 skill is required: blank `name`/`description`/`author`
 * fall back to `DEFAULT_BUNDLE_META` at build time (#626), so the
 * form never blocks a download. A non-blank name must still be
 * JSON-filename-safe. Returns an array of { field, message } —
 * empty means valid.
 */
export function validateBundleForm(meta, skills) {
  const errors = [];
  const name = (meta.name || "").trim();
  if (name && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
    errors.push({
      field: "name",
      message:
        "Name must start with a letter or digit and use only letters, digits, '.', '_', or '-' (max 64 chars).",
    });
  }
  if (!Array.isArray(skills) || skills.length === 0) {
    errors.push({
      field: "skills",
      message: "Add at least one skill to the bundle.",
    });
  }
  return errors;
}

function splitTags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Trigger a JSON download by creating a blob URL + temporary <a>.
 * Kept out of buildBundleJson so the pure function stays testable.
 */
export function downloadBundleJson(bundle, doc = document) {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = `${bundle.name || "bundle"}.json`;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // Revoke on next tick to give browsers time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Build a GitHub "new issue" web intent URL that pre-fills the
 * feature-request template. GitHub caps pre-filled bodies around
 * ~8KB in practice (URL-encoded) — we truncate the skills list with
 * a "…N more" note when needed instead of silently dropping rows.
 *
 * Labels: `enhancement,feature` matches the labels the maintainer
 * uses on existing bundle-related issues (e.g. #238 itself). A
 * future `bundles` label can be added server-side by a triage rule.
 */
export function buildIssueUrl(skills, meta, opts = {}) {
  const owner = opts.owner || REPO_OWNER;
  const repo = opts.repo || REPO_NAME;
  const catalogBaseUrl = opts.catalogBaseUrl || "https://luongnv.com/asm/";
  const maxBytes = opts.maxBodyBytes || 7000;

  const effective = withBundleDefaults(meta);
  const title = `[FEATURE] Bundle: ${effective.name}`;
  const body = buildIssueBody(skills, effective, { catalogBaseUrl, maxBytes });

  const params = new URLSearchParams({
    title,
    body,
    labels: "enhancement,feature",
  });
  return `https://github.com/${owner}/${repo}/issues/new?${params.toString()}`;
}

function buildIssueBody(skills, meta, { catalogBaseUrl, maxBytes }) {
  const tags = splitTags(meta.tags);
  const header = [
    "## Problem Statement",
    "",
    "A community-curated skill bundle, submitted via the website bundle builder.",
    "",
    "## Proposed Solution",
    "",
    `Promote the following custom bundle to the pre-defined bundle catalog.`,
    "",
    "### Bundle metadata",
    "",
    `- **Name:** ${meta.name || "(unnamed)"}`,
    `- **Description:** ${meta.description || "(no description)"}`,
    `- **Author:** ${meta.author || "(anonymous)"}`,
    tags.length > 0 ? `- **Tags:** ${tags.join(", ")}` : null,
    `- **Skill count:** ${skills.length}`,
    "",
    "### Skills",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const footer = [
    "",
    "## Use Cases",
    "",
    "1. Users who want a one-shot install of this combination of skills.",
    "2. Maintainers looking for signal on which skill combinations are popular enough to promote.",
    "",
    "## Additional Context",
    "",
    "_Generated by the ASM website bundle builder._",
  ].join("\n");

  // Budget rows against the *URL-encoded* length so we don't blow past
  // the pre-filled issue limit (~8KB on the query string). Each raw
  // markdown character expands 1-3x after `URLSearchParams.toString()`
  // (newlines → %0A, backticks → %60, em-dash → %E2%80%94), so
  // measuring raw length dramatically under-counts.
  const rows = [];
  let truncated = 0;
  let runningEncodedLen =
    encodeURIComponent(header).length + encodeURIComponent(footer).length;
  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    // Catalog deep-link uses the skill's `id` (what the router decodes
    // via `decodeSkillId` in useParams), not `installUrl` — the two
    // values are distinct and the router won't resolve installUrl.
    const catalogLink = s.id
      ? `${catalogBaseUrl}#/skills/${encodeURIComponent(s.id)}`
      : null;
    const nameCell = catalogLink
      ? `[\`${s.name}\`](${catalogLink})`
      : `\`${s.name}\``;
    const row = `- ${nameCell} — \`${s.installUrl}\`${
      s.description ? ` — ${truncateLine(s.description, 140)}` : ""
    }`;
    const encodedRowLen = encodeURIComponent(row + "\n").length;
    if (runningEncodedLen + encodedRowLen > maxBytes) {
      truncated = skills.length - i;
      break;
    }
    rows.push(row);
    runningEncodedLen += encodedRowLen;
  }
  if (truncated > 0) {
    rows.push(
      `- …and **${truncated} more** skill${truncated === 1 ? "" : "s"} — see the attached \`.json\` for the full list.`,
    );
  }

  return header + rows.join("\n") + footer;
}

function truncateLine(s, max) {
  if (!s) return "";
  const single = String(s).replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return single.slice(0, max - 1) + "…";
}
