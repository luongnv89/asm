import { forwardRef } from "react";
import { cva } from "class-variance-authority";
import { Slot } from "./slot.jsx";
import { cn } from "../../lib/cn.js";

/**
 * shadcn/ui Button — JSX port. Variants mirror the canonical shadcn
 * variants but reference our CSS custom-property theme tokens so the
 * button respects the legacy dark/light palette.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--brand)] text-[var(--bg)] hover:bg-[var(--brand-dim)]",
        outline:
          "border border-[var(--border)] bg-transparent text-[var(--fg-dim)] hover:border-[var(--brand)] hover:text-[var(--fg)]",
        ghost:
          "bg-transparent text-[var(--fg-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]",
        secondary:
          "bg-[var(--bg-hover)] text-[var(--fg)] hover:bg-[var(--bg-input)]",
      },
      size: {
        default: "h-9 px-3 py-2",
        sm: "h-7 rounded px-2 text-xs",
        lg: "h-10 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Button = forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
