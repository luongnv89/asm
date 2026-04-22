import { forwardRef } from "react";
import { cn } from "../../lib/cn.js";

/**
 * shadcn/ui Input — JSX port. Styled against the legacy `--bg-input` /
 * `--border` / `--fg` theme tokens so it inherits dark/light mode.
 */
const Input = forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--fg)] ring-offset-[var(--bg)] placeholder:text-[var(--fg-muted)] focus-visible:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
