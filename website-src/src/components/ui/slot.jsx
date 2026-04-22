import { Children, cloneElement, forwardRef, isValidElement } from "react";

/**
 * Minimal Slot implementation — merges a wrapping component's className
 * and props with its single child. Replaces `@radix-ui/react-slot` so we
 * don't pull the full Radix tree just to support `asChild`.
 */
export const Slot = forwardRef(({ children, ...props }, ref) => {
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const mergedProps = {
    ...props,
    ...child.props,
    className: [props.className, child.props.className]
      .filter(Boolean)
      .join(" "),
    ref,
  };
  return cloneElement(child, mergedProps);
});
Slot.displayName = "Slot";
