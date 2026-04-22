import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./ui/button.jsx";
import { cn } from "../lib/cn.js";
import { copyToClipboard } from "../lib/utils.js";

/**
 * Copy-to-clipboard button built on shadcn's `<Button>`.
 *
 * Legacy behaviour preserved: uses `navigator.clipboard.writeText` and
 * falls back to a hidden `<textarea>` + `document.execCommand("copy")`
 * for older browsers / non-secure contexts.
 */
export default function CopyButton({
  text,
  className = "",
  size = "default",
  label = "copy",
  ariaLabel,
  variant = "outline",
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  const handleClick = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const mappedSize = size === "md" ? "default" : size;

  return (
    <Button
      type="button"
      variant={variant}
      size={mappedSize}
      aria-label={ariaLabel || "Copy to clipboard"}
      onClick={handleClick}
      className={cn(
        "gap-1",
        copied && "border-[var(--brand)] text-[var(--brand)]",
        className,
      )}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          copied!
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          {label}
        </>
      )}
    </Button>
  );
}
