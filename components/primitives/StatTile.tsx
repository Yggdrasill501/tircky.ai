/**
 * A value, its window, and its sample size. The sample size is not optional:
 * an average without its denominator is a claim without evidence.
 */
export function StatTile({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "10px 12px",
        background: "var(--bg-tile)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-control)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.08em",
          color: "var(--text-3)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span className="num" style={{ fontSize: 16, color: "var(--text-1)" }}>
        {value}
      </span>
      {meta && (
        <span className="num" style={{ fontSize: 9, color: "var(--text-4)" }}>
          {meta}
        </span>
      )}
    </div>
  );
}

/**
 * What a metric shows before it has the data to be computed.
 *
 * Not a greyed-out number and not an empty box — a number a reader can see is a
 * number they will act on, whatever the styling. It states what it is waiting
 * for and how close it is, so the early state reads as anticipation rather than
 * as something broken. The dashed border is the only signal that separates it
 * from a real tile.
 */
export function InsufficiencyTile({
  label,
  have,
  need,
  eta,
  unit = "measurements",
}: {
  label: string;
  have: number;
  need: number;
  eta?: string;
  unit?: string;
}) {
  const pct = Math.min(100, (have / need) * 100);
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: "14px",
        background: "var(--bg-tile)",
        border: "1px dashed var(--line-dashed)",
        borderRadius: "var(--radius-control)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.08em",
          color: "var(--text-3)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.4 }}>
        {have} of {need} {unit}
      </span>
      <div
        style={{
          height: 4,
          background: "var(--track)",
          borderRadius: 2,
          display: "flex",
          overflow: "hidden",
          marginTop: 2,
        }}
      >
        <div style={{ width: `${pct}%`, background: "var(--text-4)" }} />
      </div>
      {eta && (
        <span className="num" style={{ fontSize: 10, color: "var(--text-4)" }}>
          {eta}
        </span>
      )}
    </div>
  );
}
