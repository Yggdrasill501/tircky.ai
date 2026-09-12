"use client";

import { fmt } from "@/lib/measure";
import { MacroMeter } from "@/components/primitives/MacroMeter";
import type { DayTotals, Targets } from "@/lib/nutrition";

/**
 * The number the user opens the app for.
 *
 * When anything on the day is still a photo estimate, "kcal left" is itself a
 * range — the uncertainty reaches the headline rather than being smoothed into
 * a midpoint on the way up.
 */
export function DayHeader({
  label,
  dayNumber,
  totals,
  targets,
}: {
  label: string;
  dayNumber?: number;
  totals: DayTotals;
  targets: Targets;
}) {
  const est = totals.estimated;
  const hasEstimate = est.kind === "range" || (est.kind === "exact" && est.value > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: "var(--text-1)" }}>{label}</span>
        {dayNumber != null && (
          <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
            day {dayNumber}
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          className="num"
          style={{
            fontSize: 40,
            lineHeight: 1,
            color: "var(--text-1)",
            letterSpacing: "-0.02em",
          }}
        >
          {fmt(totals.kcalLeft)}
        </span>
        <span
          className="num"
          style={{ fontSize: 11, color: "var(--text-3)", letterSpacing: "0.06em" }}
        >
          KCAL LEFT
        </span>
      </div>

      <div className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
        {targets.kcal.toLocaleString("en-US")} target · {fmt(totals.kcal)} logged
        {hasEstimate && <> · {fmt(est)} estimated</>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 2 }}>
        <MacroMeter label="PROTEIN" value={totals.protein} target={targets.protein} />
        <MacroMeter label="CARBS" value={totals.carb} target={targets.carb} />
        <MacroMeter label="FAT" value={totals.fat} target={targets.fat} />
      </div>
    </div>
  );
}
