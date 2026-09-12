"use client";

import { fmt } from "@/lib/measure";
import { macro, type FoodEntry } from "@/lib/nutrition";
import { EntryRow } from "@/components/primitives/EntryRow";
import { PortionRange } from "@/components/primitives/PortionRange";
import { ProvenanceMark } from "@/components/primitives/ProvenanceMark";
import { StatTile } from "@/components/primitives/StatTile";
import { HEALTH, TRAINING } from "@/lib/fixtures";
import { SectionLabel } from "./SectionLabel";

/** Take 1a: the day is the record, and the composer opens a conversation over it. */
export function DayLedger({
  entries,
  onQuantity,
  onPortion,
}: {
  entries: readonly FoodEntry[];
  onQuantity: (id: string, grams: number) => void;
  onPortion: (id: string, grams: number) => void;
}) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <SectionLabel right="g · kcal">FOOD</SectionLabel>
        {entries.map((e) =>
          e.portionBounds ? (
            <EstimatedEntry key={e.id} entry={e} onPortion={onPortion} />
          ) : (
            <EntryRow key={e.id} entry={e} onQuantity={onQuantity} />
          ),
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <SectionLabel>TRAINING</SectionLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "42px 1fr auto",
            gap: 10,
            alignItems: "baseline",
            padding: "7px 0",
            borderTop: "1px solid var(--line-hair)",
          }}
        >
          <span className="num" style={{ fontSize: 11, color: "var(--text-4)" }}>
            {TRAINING.time}
          </span>
          <span style={{ fontSize: 14, color: "var(--text-1)" }}>
            {TRAINING.title} — {TRAINING.hardSets} hard sets
          </span>
          <span className="num" style={{ fontSize: 12, color: "var(--text-2)" }}>
            {TRAINING.duration}
          </span>
        </div>
        {TRAINING.topSets.map((s) => (
          <div
            key={s.exercise}
            style={{
              display: "grid",
              gridTemplateColumns: "42px 1fr auto",
              gap: 10,
              alignItems: "baseline",
              padding: "7px 0",
              borderTop: "1px solid var(--line-hair)",
            }}
          >
            <span />
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>
              {s.exercise} — {s.detail}
            </span>
            <span className="num" style={{ fontSize: 12, color: "var(--text-1)" }}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, paddingBottom: 18, flexShrink: 0 }}>
        {HEALTH.map((h) => (
          <StatTile key={h.label} label={h.label} value={h.value} meta={h.meta} />
        ))}
      </div>
    </>
  );
}

/**
 * An entry whose portion came from a photograph. The row shows the range, and
 * the slider underneath is how it becomes a measurement.
 */
function EstimatedEntry({
  entry,
  onPortion,
}: {
  entry: FoodEntry;
  onPortion: (id: string, grams: number) => void;
}) {
  const bounds = entry.portionBounds!;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "10px 0 12px",
        borderTop: "1px solid var(--line-hair)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "42px 1fr auto",
          gap: 10,
          alignItems: "baseline",
        }}
      >
        <span className="num" style={{ fontSize: 11, color: "var(--text-4)" }}>
          {entry.time}
        </span>
        <span style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
          <span style={{ fontSize: 14, color: "var(--text-1)" }}>{entry.name}</span>
          <ProvenanceMark of={entry.provenance} />
        </span>
        <span className="num" style={{ fontSize: 12, color: "var(--text-1)" }}>
          {fmt(macro(entry, "kcal"))}
        </span>
      </div>
      <div style={{ paddingLeft: 52 }}>
        <PortionRange
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          grams={entry.grams}
          kcal={macro(entry, "kcal")}
          anchor={fmt(entry.grams, "g")}
          compact
          onChange={(g) => onPortion(entry.id, g)}
        />
      </div>
    </div>
  );
}
