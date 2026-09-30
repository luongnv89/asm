import { describe, expect, it } from "vitest";
import {
  buildBundleJson,
  buildIssueUrl,
  DEFAULT_BUNDLE_META,
  validateBundleForm,
  withBundleDefaults,
} from "../lib/bundle-export.js";

const NOW = new Date("2026-04-24T12:00:00.000Z");

const SKILLS = [
  {
    id: "owner/repo::a::hello-world",
    name: "hello-world",
    installUrl: "github:owner/repo:skills/hello-world",
    description: "A friendly greeting skill.",
    version: "1.0.0",
  },
  {
    id: "owner/repo::b::readme-gen",
    name: "readme-generator",
    installUrl: "github:owner/repo:skills/readme-gen",
    description: "Generates great READMEs.",
    version: "0.0.0",
  },
];

describe("buildBundleJson", () => {
  it("produces a BundleManifest with the required fields", () => {
    const meta = {
      name: "my-pack",
      description: "A test pack.",
      author: "alice",
      tags: "demo, docs",
    };
    const bundle = buildBundleJson(SKILLS, meta, NOW);
    expect(bundle).toMatchObject({
      version: 1,
      name: "my-pack",
      description: "A test pack.",
      author: "alice",
      createdAt: NOW.toISOString(),
      tags: ["demo", "docs"],
    });
    expect(bundle.skills).toHaveLength(2);
    expect(bundle.skills[0]).toEqual({
      name: "hello-world",
      installUrl: "github:owner/repo:skills/hello-world",
      description: "A friendly greeting skill.",
      version: "1.0.0",
    });
    // version "0.0.0" is the default sentinel and should be omitted
    expect(bundle.skills[1].version).toBeUndefined();
  });

  it("omits tags when empty and trims metadata", () => {
    const bundle = buildBundleJson(
      [SKILLS[0]],
      {
        name: "  trimmed  ",
        description: " with space ",
        author: "  bob ",
        tags: "  ",
      },
      NOW,
    );
    expect(bundle.name).toBe("trimmed");
    expect(bundle.description).toBe("with space");
    expect(bundle.author).toBe("bob");
    expect(bundle.tags).toBeUndefined();
  });
});

describe("validateBundleForm", () => {
  it("requires ≥1 skill but no metadata fields", () => {
    const errors = validateBundleForm({ name: "" }, []);
    expect(errors.map((e) => e.field)).toEqual(["skills"]);
  });

  it("accepts blank description (falls back to the default)", () => {
    const errors = validateBundleForm(
      { name: "ok-name", description: "  ", author: "alice" },
      SKILLS,
    );
    expect(errors).toEqual([]);
  });

  it("accepts a blank author (falls back to the default)", () => {
    const errors = validateBundleForm(
      { name: "ok-name", description: "has one", author: "" },
      SKILLS,
    );
    expect(errors).toEqual([]);
  });

  it("rejects invalid name characters", () => {
    const errors = validateBundleForm(
      { name: "bad name!", description: "d", author: "a" },
      SKILLS,
    );
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("accepts a sensible valid form", () => {
    const errors = validateBundleForm(
      {
        name: "content.pack_v2-alpha",
        description: "A curated pack.",
        author: "alice",
      },
      SKILLS,
    );
    expect(errors).toEqual([]);
  });
});

describe("withBundleDefaults", () => {
  it("fills blank fields with the defaults and keeps provided values", () => {
    expect(withBundleDefaults({})).toMatchObject(DEFAULT_BUNDLE_META);
    expect(
      withBundleDefaults({ name: "  ", description: "", author: "" }),
    ).toMatchObject(DEFAULT_BUNDLE_META);
    const out = withBundleDefaults({
      name: "custom",
      description: "d",
      author: "a",
      tags: "x",
    });
    expect(out).toMatchObject({
      name: "custom",
      description: "d",
      author: "a",
      tags: "x",
    });
  });

  it("zero-input download produces a CLI-valid bundle", () => {
    // Mirrors the non-empty checks in src/bundler.ts validateBundle().
    const bundle = buildBundleJson(SKILLS, {}, NOW);
    expect(bundle.name).toBeTruthy();
    expect(bundle.description).toBeTruthy();
    expect(bundle.author).toBeTruthy();
    expect(bundle.createdAt).toBe(NOW.toISOString());
    expect(bundle.skills.length).toBeGreaterThan(0);
  });
});

describe("buildIssueUrl", () => {
  it("falls back to the default bundle name in the issue title", () => {
    const url = buildIssueUrl(SKILLS, {});
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("title")).toBe(
      `[FEATURE] Bundle: ${DEFAULT_BUNDLE_META.name}`,
    );
  });

  it("produces a github issues URL with title/body/labels", () => {
    const url = buildIssueUrl(SKILLS, {
      name: "my-pack",
      description: "Short desc",
      author: "alice",
      tags: "docs",
    });
    expect(url).toMatch(
      /^https:\/\/github\.com\/luongnv89\/asm\/issues\/new\?/,
    );
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("title")).toBe("[FEATURE] Bundle: my-pack");
    expect(qs.get("labels")).toBe("enhancement,feature");
    const body = qs.get("body");
    expect(body).toContain("my-pack");
    expect(body).toContain("alice");
    expect(body).toContain("hello-world");
    expect(body).toContain("readme-generator");
  });

  it("uses each skill's id (not installUrl) for the catalog deep link", () => {
    // The router's `useParams` decodes via `decodeSkillId(encodedId)`,
    // so the link target must be the skill `id`. Passing installUrl
    // here would 404 every link in the published issue.
    const url = buildIssueUrl(
      [SKILLS[0]],
      { name: "one" },
      { catalogBaseUrl: "https://example.test/asm/" },
    );
    const body = new URLSearchParams(url.split("?")[1]).get("body");
    const expectedLink = `https://example.test/asm/#/skills/${encodeURIComponent(
      SKILLS[0].id,
    )}`;
    expect(body).toContain(expectedLink);
    // And must NOT fall back to the installUrl
    expect(body).not.toContain(
      `#/skills/${encodeURIComponent(SKILLS[0].installUrl)}`,
    );
  });

  it("truncates even when the final single skill would overflow the budget", () => {
    // Regression test: earlier the truncation guard had a `i < skills.length - 1`
    // clause that let the last row through unconditionally, which could push
    // the encoded body past the cap on a bundle where one very large skill
    // sits at the end.
    const bulkyDescription = "x".repeat(2000);
    const skills = [
      {
        id: "o/r::x::huge",
        name: "huge-skill",
        installUrl: "github:o/r:skills/huge-skill",
        description: bulkyDescription,
      },
    ];
    const url = buildIssueUrl(skills, { name: "one" }, { maxBodyBytes: 500 });
    const body = new URLSearchParams(url.split("?")[1]).get("body");
    // The single bulky row should be replaced by the "…N more" note
    // rather than appended, keeping the body inside (header + footer + note).
    expect(body).toMatch(/more\*\* skill/);
    expect(body).not.toContain(bulkyDescription);
  });

  it("keeps the whole URL within the encoded byte limit under large bundles", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `o/r::x::sk-${i}`,
      name: `skill-${i}-name-that-is-somewhat-long-to-consume-bytes`,
      installUrl: `github:o/r:skills/skill-${i}-name-that-is-somewhat-long-to-consume-bytes`,
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    }));
    const maxBodyBytes = 3000;
    const url = buildIssueUrl(many, { name: "big" }, { maxBodyBytes });
    const body = new URLSearchParams(url.split("?")[1]).get("body");
    expect(body).toMatch(/more\*\* skill/);
    // Encoded body (what actually goes into the URL) stays within cap +
    // a small overhead for header/footer + truncation note.
    expect(encodeURIComponent(body).length).toBeLessThan(maxBodyBytes + 1500);
  });
});
