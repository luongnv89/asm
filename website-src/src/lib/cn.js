import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn-canonical class helper. Merges conditional class expressions and
 * de-duplicates conflicting Tailwind utilities (e.g. `px-2 px-4` → `px-4`).
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
