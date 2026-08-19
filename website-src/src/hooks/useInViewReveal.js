import { useEffect, useRef, useState } from "react";
import {
  canUseIntersectionObserver,
  prefersReducedMotion,
} from "../lib/motion.js";

/**
 * Fires once when the element enters the viewport. Used for scroll-triggered
 * landing-page reveals (opacity + translate only — GPU-friendly).
 */
export function useInViewReveal({
  immediate = false,
  rootMargin = "-8% 0px",
} = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(immediate);

  useEffect(() => {
    if (immediate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: ensure visible when immediate is true after mount
      setVisible(true);
      return undefined;
    }
    if (prefersReducedMotion() || !canUseIntersectionObserver()) {
      setVisible(true);
      return undefined;
    }
    const el = ref.current;
    if (!el) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [immediate, rootMargin]);

  return { ref, visible };
}
