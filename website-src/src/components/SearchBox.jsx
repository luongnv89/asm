import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "./ui/input.jsx";
import { Button } from "./ui/button.jsx";

/**
 * Debounced search input — wraps shadcn's `<Input>` primitive with a
 * leading search icon (lucide-react) and a trailing clear button.
 *
 * Matches the legacy "one-index load, one debounce on input" contract:
 * the `draft` prop tracks keystrokes locally; after `DEBOUNCE_MS` of
 * idle it commits via `onCommit(query)`, which triggers the URL/state
 * update and the MiniSearch re-query.
 */
const DEBOUNCE_MS = 150;

export default function SearchBox({
  draft,
  onDraftChange,
  onCommit,
  disabled,
  placeholder,
}) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCommit(draft), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // onCommit identity may change — we only respond to draft updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="relative w-full">
      <Search
        aria-hidden="true"
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--fg-muted)]"
      />
      <Input
        type="search"
        value={draft}
        placeholder={placeholder || "Search skills, tags, descriptions…"}
        disabled={disabled}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (timerRef.current) clearTimeout(timerRef.current);
            onCommit(draft);
          }
        }}
        autoComplete="off"
        spellCheck="false"
        aria-label="Search skills"
        className="h-12 pl-10 pr-10 text-base"
      />
      {draft && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear search"
          onClick={() => {
            onDraftChange("");
            if (timerRef.current) clearTimeout(timerRef.current);
            onCommit("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
