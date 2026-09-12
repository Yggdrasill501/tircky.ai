/**
 * Format an unknown thrown value for a log line.
 *
 * `err.message` alone is not enough: Node's AggregateError — which is what a
 * failed TCP connect to a host resolving to both ::1 and 127.0.0.1 produces —
 * carries an EMPTY message and puts the real causes in `errors`. Logging only
 * the message turns "the database is not running" into a blank line.
 */
export function formatError(err: unknown): string {
  if (err instanceof AggregateError) {
    const causes = err.errors.map((e) => formatError(e)).join("; ");
    return `${err.name}${err.message ? `: ${err.message}` : ""} [${causes}]`;
  }

  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    const base = err.message || err.name;
    const withCode = code ? `${base} (${code})` : base;
    return err.cause ? `${withCode} <- ${formatError(err.cause)}` : withCode;
  }

  return String(err);
}
