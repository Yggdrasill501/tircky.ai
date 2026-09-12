"use client";

import { fmt, fmtTight } from "@/lib/measure";
import { macro, type DayTotals, type FoodEntry, type Targets } from "@/lib/nutrition";
import { MacroMeter } from "@/components/primitives/MacroMeter";
import { ProvenanceMark } from "@/components/primitives/ProvenanceMark";

const COLS = "64px minmax(0,1fr) 96px 78px 60px 60px 60px";

/** The desktop review surface: one row per entry, every macro in its column. */
export function DayTable({
  entries,
  totals,
  targets,
  onQuantity,
}: {
  entries: readonly FoodEntry[];
  totals: DayTotals;
  targets: Targets;
  onQuantity: (id: string, grams: number) => void;
}) {
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 18,
          padding: "18px 20px",
          background: "var(--bg-card)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
        }}
      >
        <Summary label="ENERGY" value={fmt(totals.kcal)} meter={
          <MacroMeter label="ENERGY" value={totals.kcal} target={targets.kcal} showValue={false} />
        } foot={`of ${targets.kcal.toLocaleString("en-US")} · ${fmt(totals.estimated)} est`} />
        <Summary label="PROTEIN" value={fmt(totals.protein, "g")} meter={
          <MacroMeter label="PROTEIN" value={totals.protein} target={targets.protein} showValue={false} />
        } foot={`of ${targets.protein}`} />
        <Summary label="CARBS" value={fmt(totals.carb, "g")} meter={
          <MacroMeter label="CARBS" value={totals.carb} target={targets.carb} showValue={false} />
        } foot={`of ${targets.carb}`} />
        <Summary label="FAT" value={fmt(totals.fat, "g")} meter={
          <MacroMeter label="FAT" value={totals.fat} target={targets.fat} showValue={false} />
        } foot={`of ${targets.fat}`} />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-card)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: COLS,
            gap: 10,
            padding: "9px 18px",
            borderBottom: "1px solid var(--line)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "var(--text-3)",
          }}
        >
          <span>TIME</span>
          <span>ITEM</span>
          <span style={{ textAlign: "right" }}>AMOUNT</span>
          <span style={{ textAlign: "right" }}>KCAL</span>
          <span style={{ textAlign: "right" }}>P</span>
          <span style={{ textAlign: "right" }}>C</span>
          <span style={{ textAlign: "right" }}>F</span>
        </div>

        {entries.map((e) => {
          const estimated = e.grams.kind === "range";
          return (
            <div
              key={e.id}
              className="num"
              style={{
                display: "grid",
                gridTemplateColumns: COLS,
                gap: 10,
                padding: "10px 18px",
                borderBottom: "1px solid var(--line-hair)",
                fontSize: 12,
                color: "var(--text-2)",
                background: estimated ? "var(--bg-tile)" : undefined,
              }}
            >
              <span>{e.time ?? "—"}</span>
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  color: "var(--text-1)",
                  display: "flex",
                  gap: 6,
                  alignItems: "baseline",
                  minWidth: 0,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.name}
                </span>
                <ProvenanceMark of={e.provenance} />
              </span>
              <span style={{ textAlign: "right", color: "var(--text-1)" }}>
                {e.editable && e.grams.kind === "exact" ? (
                  <input
                    className="qty-input"
                    type="number"
                    value={Math.round(e.grams.value)}
                    aria-label={`${e.name} amount in grams`}
                    onChange={(ev) =>
                      onQuantity(e.id, Math.max(0, Number(ev.target.value) || 0))
                    }
                  />
                ) : (
                  fmtTight(e.grams)
                )}
                {" g"}
              </span>
              <span style={{ textAlign: "right", color: "var(--text-1)" }}>
                {fmt(macro(e, "kcal"))}
              </span>
              <span style={{ textAlign: "right" }}>{fmtTight(macro(e, "protein"))}</span>
              <span style={{ textAlign: "right" }}>{fmtTight(macro(e, "carb"))}</span>
              <span style={{ textAlign: "right" }}>{fmtTight(macro(e, "fat"))}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Summary({
  label,
  value,
  meter,
  foot,
}: {
  label: string;
  value: string;
  meter: React.ReactNode;
  foot: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span className="label">{label}</span>
      <span className="num" style={{ fontSize: 22, color: "var(--text-1)" }}>
        {value}
      </span>
      {meter}
      <span className="num" style={{ fontSize: 10, color: "var(--text-3)" }}>
        {foot}
      </span>
    </div>
  );
}
