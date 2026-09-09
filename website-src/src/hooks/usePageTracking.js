import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "../lib/analytics.js";

/**
 * Send virtual page views on HashRouter navigations (issue #645).
 *
 * The gtag snippet in index.html sets `send_page_view: false` so the initial
 * load is counted here once, same as every subsequent route change.
 */
export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location);
  }, [location]);
}
