/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGoatCounterPath,
  buildPageViewParams,
  trackPageView,
} from "../lib/analytics.js";

describe("analytics (issue #645)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.gtag;
    delete window.goatcounter;
  });

  describe("buildPageViewParams", () => {
    it("maps HashRouter locations to GA4 page_view fields", () => {
      Object.defineProperty(window, "location", {
        value: {
          origin: "https://luongnv.com",
          pathname: "/asm/",
          search: "",
          hash: "#/skills",
        },
        configurable: true,
      });

      expect(
        buildPageViewParams({ pathname: "/skills", search: "?q=test" }),
      ).toEqual({
        page_path: "/skills?q=test",
        page_location: "https://luongnv.com/asm/#/skills?q=test",
      });
    });
  });

  describe("buildGoatCounterPath", () => {
    it("prefixes routes with /asm for the shared GoatCounter site", () => {
      expect(buildGoatCounterPath({ pathname: "/", search: "" })).toBe("/asm");
      expect(buildGoatCounterPath({ pathname: "/skills", search: "" })).toBe(
        "/asm/skills",
      );
      expect(
        buildGoatCounterPath({
          pathname: "/bundles/marketing",
          search: "?x=1",
        }),
      ).toBe("/asm/bundles/marketing?x=1");
    });
  });

  describe("trackPageView", () => {
    it("calls gtag and goatcounter when both are available", () => {
      Object.defineProperty(window, "location", {
        value: {
          origin: "https://luongnv.com",
          pathname: "/asm/",
          search: "",
          hash: "#/docs",
        },
        configurable: true,
      });
      const gtag = vi.fn();
      const count = vi.fn();
      window.gtag = gtag;
      window.goatcounter = { count };

      trackPageView({ pathname: "/docs", search: "" });

      expect(gtag).toHaveBeenCalledWith("event", "page_view", {
        page_path: "/docs",
        page_location: "https://luongnv.com/asm/#/docs",
      });
      expect(count).toHaveBeenCalledWith({ path: "/asm/docs" });
    });

    it("swallows provider errors so navigation is never blocked", () => {
      window.gtag = () => {
        throw new Error("gtag blocked");
      };
      window.goatcounter = {
        count: () => {
          throw new Error("goatcounter blocked");
        },
      };

      expect(() =>
        trackPageView({ pathname: "/stats", search: "" }),
      ).not.toThrow();
    });
  });
});
