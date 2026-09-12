"use client";

import { fmt, type Measure } from "@/lib/measure";

/**
 * The control with no precedent: a slider across an estimated portion range.
 *
 * Dragging it converts an estimate into a measurement — the range is discarded
 * and the day total stops being a range too. That propagation is the point;
 * without it the control would just be a nicer way to guess.
 */
export function PortionRange({
  min,
  max,
  step,
  grams,
  kcal,
  anchor,
  onChange,
  compact = false,
}: {
  min: number;
  max: number;
  step: number;
  grams: Measure;
  kcal: Measure;
  anchor?: string;
  onChange: (grams: number) => void;
  compact?: boolean;
}) {
  const set = grams.kind === "exact";
  const sliderValue = set ? grams.value : (min + max) / 2;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 8 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Portion in grams"
        style={{ width: "100%", height: 14 }}
      />
      <div
        className="num"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--text-4)",
        }}
      >
        <span>{min} g</span>
        <span style={{ color: "var(--text-2)" }}>{anchor ?? fmt(grams, "g")}</span>
        <span>{max} g</span>
      </div>
      {!compact && (
        <span style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>
          {set
            ? `Set to ${Math.round(sliderValue)} g — now a measured value, the range is discarded.`
            : `Estimated from the photo. Left as a range until you set it; the day total carries the range too (${fmt(kcal, "kcal")}).`}
        </span>
      )}
    </div>
  );
}
