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
