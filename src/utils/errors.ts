import { stripControlBytes } from "./control-chars";

/**
 * Extract a display message from a thrown value of unknown shape — the typed
 * equivalent of `err?.message ?? String(err)`: a `.message` property is used
 * verbatim (Error instance or error-like object); anything else falls back to
 * stringifying the value itself.
 */
export function errorMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return message == null ? String(err) : String(message);
}

/**
 * Prepare a thrown value for the CLI's `Fatal error:` handler (#834). Error
 * messages often quote a typed argument, a path or an author string, so each
 * line of a thrown string, and of an Error's `message` and `stack` (its
 * `cause` chain and `AggregateError.errors` included), has its control bytes
 * replaced with `?`. The Error is changed in place and returned, so
 * `console.error` formats it exactly as before; line breaks stay. An Error
 * whose `message` or `stack` cannot be set (a getter-only DOMException, a
 * frozen object) is replaced by its stripped stack text. Other values pass
 * through: `util.inspect` already escapes control characters inside the
 * strings it quotes.
 */
export function fatalErrorForDisplay(err: unknown): unknown {
  const stripLines = (text: string) =>
    text.split("\n").map(stripControlBytes).join("\n");
  if (typeof err === "string") return stripLines(err);
  if (!(err instanceof Error)) return err;
  const seen = new Set<Error>();
  let settable = true;
  const visit = (e: unknown): void => {
    if (!(e instanceof Error) || seen.has(e)) return;
    seen.add(e);
    try {
      e.message = stripLines(e.message);
      if (typeof e.stack === "string") e.stack = stripLines(e.stack);
    } catch {
      settable = false;
    }
    visit((e as { cause?: unknown }).cause);
    if (e instanceof AggregateError && Array.isArray(e.errors)) {
      for (const inner of e.errors) visit(inner);
    }
  };
  visit(err);
  return settable ? err : stripLines(String(err.stack ?? err));
}
