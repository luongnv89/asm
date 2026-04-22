import { cva } from "class-variance-authority";
import { cn } from "../../lib/cn.js";

/**
 * shadcn/ui Badge — JSX port. Extra tone variants cover the legacy badge
 * palette (official / verified / featured / warn / tokens / cat / eval-*).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-0.5 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors",
  {
    variants: {
      tone: {
        default:
          "border-[var(--border)] bg-[var(--bg-hover)] text-[var(--fg-dim)]",
        official:
          "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_15%,transparent)] text-[var(--brand)]",
        verified: "border-sky-500/40 bg-sky-500/10 text-sky-400",
        featured: "border-amber-500/40 bg-amber-500/15 text-amber-400",
        warn: "border-[var(--warn)] bg-[var(--warn-bg)] text-[var(--warn)]",
        tokens:
          "border-[var(--border)] bg-[var(--bg-input)] text-[var(--fg-dim)]",
        cat: "border-[var(--border)] bg-[var(--bg-input)] text-[var(--fg-dim)]",
        "eval-a": "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        "eval-b": "border-lime-500/40 bg-lime-500/10 text-lime-400",
        "eval-c": "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
        "eval-d": "border-orange-500/40 bg-orange-500/10 text-orange-400",
        "eval-f": "border-red-500/40 bg-red-500/10 text-red-400",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export function Badge({ className, tone, ...props }) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
