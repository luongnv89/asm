/** GA4 measurement ID — also wired in `website-src/index.html`. */
export const GA_MEASUREMENT_ID = "G-33TXRCFMWM";

/** GoatCounter site for luongnv89-hosted properties (issue #645). */
export const GOATCOUNTER_SITE = "https://luongnv89.goatcounter.com";

/** Path prefix so asm traffic is separable in the shared GoatCounter site. */
export const GOATCOUNTER_PATH_PREFIX = "/asm";

/**
 * Build GA4 page_view params for HashRouter locations.
 *
 * `location.pathname` is the virtual route (`/skills`, `/bundles/foo`, …).
 * `page_location` must include the hash so GA sees the real URL.
 */
export function buildPageViewParams(location) {
  const pagePath = location.pathname + location.search;
  const pageLocation =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}${window.location.search}#${pagePath}`
      : pagePath;
  return { page_path: pagePath, page_location: pageLocation };
}

/** GoatCounter path with the `/asm` prefix for multi-site separation. */
export function buildGoatCounterPath(location) {
  const pagePath = location.pathname + location.search;
  return pagePath === "/"
    ? GOATCOUNTER_PATH_PREFIX
    : `${GOATCOUNTER_PATH_PREFIX}${pagePath}`;
}

function getGtag() {
  if (typeof window === "undefined") return undefined;
  return typeof window.gtag === "function" ? window.gtag : undefined;
}

function getGoatCounter() {
  if (typeof window === "undefined") return undefined;
  const gc = window.goatcounter;
  return gc && typeof gc.count === "function" ? gc : undefined;
}

/** Fire GA4 + GoatCounter page views for a HashRouter navigation. */
export function trackPageView(location) {
  const gtag = getGtag();
  if (gtag) {
    try {
      gtag("event", "page_view", buildPageViewParams(location));
    } catch {
      /* never block navigation */
    }
  }

  const gc = getGoatCounter();
  if (gc) {
    try {
      gc.count({ path: buildGoatCounterPath(location) });
    } catch {
      /* never block navigation */
    }
  }
}
