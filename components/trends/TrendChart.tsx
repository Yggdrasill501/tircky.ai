/**
 * Raw points recede, the fitted line is the figure.
 *
 * Bodyweight day to day swings 1–2 kg on water and gut contents, against a
 * target change of 0.4 kg a week — the raw series has a signal-to-noise ratio
 * below one at the timescale people check it on. Showing the points as faint
 * context and the fit as the statement is a correctness requirement, not a
 * styling preference.
 */
export function TrendChart({
  points,
  fit,
  goal,
  height = 170,
}: {
  points: readonly (readonly [number, number])[];
  fit: readonly [number, number, number, number];
  goal?: readonly [number, number, number, number];
  height?: number;
}) {
  const W = 840;
  const H = 170;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }} role="img" aria-label="Bodyweight trend">
      {[20, 70, 120].map((y) => (
        <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="var(--line-hair)" strokeWidth="1" />
      ))}
      {points.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3" fill="var(--chart-dot)" />
      ))}
      {goal && (
        <line
          x1={goal[0]}
          y1={goal[1]}
          x2={goal[2]}
          y2={goal[3]}
          stroke="var(--chart-goal)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      )}
      <line x1={fit[0]} y1={fit[1]} x2={fit[2]} y2={fit[3]} stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

export function Sparkline({ points }: { points: string }) {
  return (
    <svg viewBox="0 0 380 70" style={{ width: "100%", height: 70, marginTop: 4 }} aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}
