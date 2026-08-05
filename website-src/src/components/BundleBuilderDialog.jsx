import { useEffect, useMemo, useRef, useState } from "react";
import { X, Download, Github, Trash2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { useBundleCart } from "../hooks/useBundleCart.jsx";
import {
  buildBundleJson,
  buildIssueUrl,
  downloadBundleJson,
  validateBundleForm,
} from "../lib/bundle-export.js";
import { Button } from "./ui/button.jsx";
import { Input } from "./ui/input.jsx";
import { cn } from "../lib/cn.js";
import { encodeSkillId } from "../lib/utils.js";

/**
 * Bundle builder dialog (#238). Opens from the header cart button
 * and lets the user review selected skills, fill bundle metadata,
 * and either export a `.json` or publish a pre-filled feature
 * request issue.
 *
 * Kept deliberately framework-free (no @radix-ui/react-dialog) to
 * match the existing `SidebarDrawer` approach — a single flexible
 * surface is fine for one modal.
 */
export default function BundleBuilderDialog({ open, onClose }) {
  const { items, remove, clear, meta, setMeta } = useBundleCart();
  const closeBtnRef = useRef(null);
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Remember the element focused at open time so we can return focus
    // when the dialog closes — a baseline expectation for modal dialogs.
    returnFocusRef.current =
      typeof document !== "undefined" ? document.activeElement : null;

    const onKey = (e) => {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      // Tab trap: cycle Tab / Shift-Tab within the panel so keyboard
      // users can't accidentally reach the page underneath.
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      // Return focus to whatever opened the dialog.
      const el = returnFocusRef.current;
      if (el && typeof el.focus === "function") {
        try {
          el.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [open, onClose]);

  const errors = useMemo(() => validateBundleForm(meta, items), [meta, items]);
  const errorsByField = useMemo(() => {
    const m = {};
    for (const e of errors) m[e.field] = e.message;
    return m;
  }, [errors]);
  const isValid = errors.length === 0;

  if (!open) return null;

  const handleExport = () => {
    setSubmitted(true);
    if (!isValid) return;
    const bundle = buildBundleJson(items, meta);
    downloadBundleJson(bundle);
  };

  const handlePublish = () => {
    setSubmitted(true);
    if (!isValid) return;
    const url = buildIssueUrl(items, meta);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleClear = () => {
    if (items.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Clear all skills from this bundle?")
    ) {
      return;
    }
    clear();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bundle-builder-title"
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4"
    >
      <button
        type="button"
        aria-label="Close bundle builder"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 bg-black/60"
      />
      <div
        ref={panelRef}
        className={cn(
          "relative w-full sm:max-w-2xl max-h-[100dvh] sm:max-h-[90vh] overflow-y-auto",
          "rounded-none sm:rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-xl",
          "flex flex-col",
        )}
      >
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-3 sticky top-0 bg-[var(--bg)] z-10">
          <div>
            <h2
              id="bundle-builder-title"
              className="text-lg font-semibold text-[var(--fg)]"
            >
              Build a bundle
            </h2>
            <p className="text-xs text-[var(--fg-dim)]">
              {items.length === 0
                ? "No skills selected yet. Add skills from the catalog to get started."
                : `${items.length} ${items.length === 1 ? "skill" : "skills"} in this bundle`}
            </p>
          </div>
          <Button
            ref={closeBtnRef}
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>

        <div className="flex-1 px-5 py-4 flex flex-col gap-5">
          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">
              Bundle metadata
            </legend>
            <Field
              id="bundle-name"
              label="Name"
              hint="Short identifier. Letters, digits, '.', '_', '-' (max 64)."
              error={submitted ? errorsByField.name : undefined}
              required
            >
              <Input
                id="bundle-name"
                value={meta.name}
                onChange={(e) => setMeta({ name: e.target.value })}
                placeholder="content-writing"
                aria-invalid={submitted && !!errorsByField.name}
                autoComplete="off"
              />
            </Field>
            <Field
              id="bundle-description"
              label="Description"
              hint="One or two sentences about what the bundle does."
            >
              <textarea
                id="bundle-description"
                value={meta.description}
                onChange={(e) => setMeta({ description: e.target.value })}
                placeholder="Content creation and marketing skills…"
                rows={2}
                className="flex w-full rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus-visible:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field id="bundle-author" label="Author">
                <Input
                  id="bundle-author"
                  value={meta.author}
                  onChange={(e) => setMeta({ author: e.target.value })}
                  placeholder="your-name"
                  autoComplete="off"
                />
              </Field>
              <Field
                id="bundle-tags"
                label="Tags"
                hint="Comma-separated, optional."
              >
                <Input
                  id="bundle-tags"
                  value={meta.tags}
                  onChange={(e) => setMeta({ tags: e.target.value })}
                  placeholder="content, marketing"
                  autoComplete="off"
                />
              </Field>
            </div>
          </fieldset>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                Skills ({items.length})
              </h3>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-[11px] text-[var(--fg-dim)] hover:text-[var(--warn)] inline-flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Clear all
                </button>
              )}
            </div>
            {submitted && errorsByField.skills && (
              <p className="text-xs text-[var(--warn)]">
                ⚠ {errorsByField.skills}
              </p>
            )}
            {items.length === 0 ? (
              <p className="text-sm text-[var(--fg-dim)] border border-dashed border-[var(--border)] rounded-md px-4 py-6 text-center">
                Your bundle is empty. Close this dialog and click{" "}
                <span className="font-medium text-[var(--fg)]">
                  Add to bundle
                </span>{" "}
                on any skill to start building.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5" role="list">
                {items.map((sk) => (
                  <li
                    key={sk.id}
                    className="flex items-start justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/skills/${encodeSkillId(sk.id)}`}
                          className="min-h-11 min-w-11 -my-2 -ml-2 px-2 inline-flex items-center font-mono text-sm text-[var(--fg)] hover:text-[var(--brand)] transition-colors truncate"
                          onClick={onClose}
                        >
                          {sk.name}
                        </Link>
                        {sk.owner && sk.repo && (
                          <span className="text-[10px] text-[var(--fg-muted)] truncate">
                            {sk.owner}/{sk.repo}
                          </span>
                        )}
                      </div>
                      {sk.description && (
                        <p className="text-xs text-[var(--fg-dim)] line-clamp-2">
                          {sk.description}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(sk.id)}
                      aria-label={`Remove ${sk.name} from bundle`}
                      className="shrink-0 text-[var(--fg-muted)] hover:text-[var(--warn)] px-1.5 py-1 rounded"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="border-t border-[var(--border)] px-5 py-3 flex flex-wrap items-center justify-end gap-2 sticky bottom-0 bg-[var(--bg)]">
          <p className="mr-auto text-[11px] text-[var(--fg-muted)] max-w-[280px]">
            Export installs via{" "}
            <code className="text-[var(--brand)]">asm bundle install</code>.
            Publish opens a pre-filled feature request.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleExport}
            disabled={items.length === 0}
            className="gap-1.5"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export .json
          </Button>
          <Button
            type="button"
            onClick={handlePublish}
            disabled={items.length === 0}
            className="gap-1.5"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            Publish
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Field({ id, label, hint, error, required, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-xs font-medium text-[var(--fg-dim)] flex items-center gap-1"
      >
        {label}
        {required && (
          <span className="text-[var(--warn)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-[var(--warn)]">⚠ {error}</p>
      ) : hint ? (
        <p className="text-[11px] text-[var(--fg-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
