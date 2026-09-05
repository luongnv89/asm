import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  X,
  Download,
  Github,
  Trash2,
  ExternalLink,
  ShoppingCart,
} from "lucide-react";
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
 * Cart drawer (#238, redesigned as a storefront cart). Slides in from
 * the right, lists the skills in the cart, collects the bundle
 * metadata as "checkout details", and offers two ways to check out:
 * export a `.json` bundle, or publish a pre-filled feature request.
 *
 * Kept deliberately framework-free (no @radix-ui/react-dialog) to
 * match the existing `SidebarDrawer` approach.
 */
export default function CartDrawer({ open, onClose }) {
  const { items, remove, clear, meta, setMeta } = useBundleCart();
  const closeBtnRef = useRef(null);
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Remember the element focused at open time so we can return focus
    // when the drawer closes — a baseline expectation for modal dialogs.
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
      // Return focus to whatever opened the drawer.
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
      !window.confirm("Remove every skill from your cart?")
    ) {
      return;
    }
    clear();
  };

  const count = items.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cart-title"
      className="shop fixed inset-0 z-50 flex justify-end"
    >
      <button
        type="button"
        aria-label="Close cart"
        onClick={onClose}
        tabIndex={-1}
        className="shop-drawer-scrim absolute inset-0 bg-black/60"
      />
      <div
        ref={panelRef}
        className={cn(
          "shop-drawer relative flex h-full w-full max-w-[520px] flex-col",
          "border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl",
        )}
      >
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <div className="shop-kicker">
              <span className="dot" aria-hidden="true" />
              Checkout
            </div>
            <h2
              id="cart-title"
              className="shop-title mt-1 !text-[30px] leading-none"
            >
              Your cart
            </h2>
            <p className="shop-meta mt-1.5">
              {count === 0
                ? "No skills in your cart yet."
                : `${count} ${count === 1 ? "skill" : "skills"} in your cart`}
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

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="shop-label">Items ({count})</h3>
              {count > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="shop-mono inline-flex items-center gap-1 text-[11px] text-[var(--fg-dim)] hover:text-[var(--warn)]"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Empty cart
                </button>
              )}
            </div>
            {submitted && errorsByField.skills && (
              <p className="text-xs text-[var(--warn)]">
                ⚠ {errorsByField.skills}
              </p>
            )}
            {count === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center">
                <ShoppingCart
                  className="h-6 w-6 text-[var(--fg-muted)]"
                  aria-hidden="true"
                />
                <p className="text-sm text-[var(--fg-dim)]">
                  Your cart is empty.
                </p>
                <p className="text-xs text-[var(--fg-muted)]">
                  Browse the catalog and press{" "}
                  <span className="font-medium text-[var(--fg)]">
                    Add to cart
                  </span>{" "}
                  on any skill.
                </p>
                <Link
                  to="/skills"
                  onClick={onClose}
                  className="mt-2 inline-flex h-9 items-center rounded-md border border-[var(--border)] px-3 text-xs font-medium text-[var(--fg)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  Browse skills
                </Link>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5" role="list">
                {items.map((sk) => (
                  <li
                    key={sk.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          to={`/skills/${encodeSkillId(sk.id)}`}
                          className="min-h-11 min-w-11 -my-2 -ml-2 px-2 inline-flex items-center font-mono text-sm text-[var(--fg)] hover:text-[var(--brand)] transition-colors truncate"
                          onClick={onClose}
                        >
                          {sk.name}
                        </Link>
                        {sk.owner && sk.repo && (
                          <span className="shop-meta truncate">
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
                      aria-label={`Remove ${sk.name} from cart`}
                      className="shrink-0 rounded px-1.5 py-1 text-[var(--fg-muted)] hover:text-[var(--warn)]"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <fieldset className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
            <legend className="shop-label float-left w-full mb-1">
              Checkout details
            </legend>
            <p className="text-xs text-[var(--fg-dim)] -mt-1">
              These become the metadata of the bundle you export or publish.
              Leave any field blank to use its default — Export works with zero
              input.
            </p>
            <Field
              id="bundle-name"
              label="Bundle name"
              hint="Short identifier. Letters, digits, '.', '_', '-' (max 64)."
              error={submitted ? errorsByField.name : undefined}
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
              error={submitted ? errorsByField.description : undefined}
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
              <Field
                id="bundle-author"
                label="Author"
                error={submitted ? errorsByField.author : undefined}
              >
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
        </div>

        <footer className="border-t border-[var(--border)] bg-[var(--bg-card)] px-5 py-4 flex flex-col gap-3">
          <p className="shop-meta">
            Export installs with{" "}
            <code className="text-[var(--brand)]">asm bundle install</code>.
            Publish opens a pre-filled feature request on GitHub.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleExport}
              disabled={count === 0}
              className="gap-1.5"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export .json
            </Button>
            <Button
              type="button"
              onClick={handlePublish}
              disabled={count === 0}
              className="gap-1.5"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              Publish
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({ id, label, hint, error, required, children }) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        required: required || children.props.required,
        "aria-required":
          required || children.props["aria-required"] || undefined,
        "aria-describedby": describedBy || children.props["aria-describedby"],
        ...(children.props["aria-invalid"] === undefined && error !== undefined
          ? { "aria-invalid": !!error }
          : null),
      })
    : children;
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
      {control}
      {error ? (
        <p id={errorId} className="text-[11px] text-[var(--warn)]">
          ⚠ {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[11px] text-[var(--fg-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
