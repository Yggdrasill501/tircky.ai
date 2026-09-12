"use client";

import { fmt, fmtTight, type Measure } from "@/lib/measure";
import { meterSegments } from "@/lib/nutrition";

/**
 * Three segments: logged, still-estimated, over target.
 *
 * The estimated span is a hatch rather than a lighter tint — a tint reads as
 * "less of the same thing", a hatch reads as "not the same kind of thing".
 * Over-target is a hue rotation at identical lightness and chroma, so it
 * registers as information rather than as an alarm.
 */
export function MacroMeter({
  label,
  value,
  target,
  unit = "g",
  height = 4,
  showValue = true,
}: {
  label: string;
  value: Measure;
  target: number;
  unit?: string;
  height?: number;
  showValue?: boolean;
}) {
  const { certainPct, estimatedPct, overPct } = meterSegments(value, target);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {showValue && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "var(--text-3)",
            }}
          >
            {label}
          </span>
          <span
            className="num"
            style={{ fontSize: 12, color: "var(--text-2)" }}
          >
            {fmtTight(value)} / {target} {unit}
          </span>
        </div>
      )}
      <div
        style={{
          height,
          borderRadius: height / 2,
          background: "var(--track)",
          display: "flex",
          overflow: "hidden",
        }}
        role="meter"
        aria-label={label}
        aria-valuetext={`${fmt(value)} of ${target} ${unit}`}
      >
        <div style={{ width: `${certainPct}%`, background: "var(--accent)" }} />
        {estimatedPct > 0 && (
          <div
            style={{
              width: `${estimatedPct}%`,
              background:
                "repeating-linear-gradient(90deg, var(--accent) 0 2px, transparent 2px 4px)",
            }}
          />
        )}
        {overPct > 0 && <div style={{ width: `${overPct}%`, background: "var(--over)" }} />}
      </div>
    </div>
  );
}
