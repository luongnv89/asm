import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  SITE_BASE,
  categoryLabel,
  categoryPageUrl,
} from "../lib/category-seo.js";

/**
 * Runtime category-SEO helpers: badge links and per-category document
 * metadata must resolve every catalog slug to its indexable static page.
 */
describe("category-seo", () => {
  it("links every known category to its static page", () => {
    for (const slug of Object.keys(CATEGORY_LABELS)) {
      expect(categoryPageUrl(slug)).toBe(
        `${SITE_BASE}/categories/${slug}.html`,
      );
    }
  });

  it("labels known slugs, title-cases unknown ones", () => {
    expect(categoryLabel("ai-agents")).toBe("AI Agents");
    expect(categoryLabel("devops")).toBe("DevOps");
    expect(categoryLabel("brand-new-cat")).toBe("Brand New Cat");
  });
});
