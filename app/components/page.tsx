"use client";

import { useState } from "react";
import { AppNav } from "@/components/AppNav";
import { EntryRow } from "@/components/primitives/EntryRow";
import { MacroMeter } from "@/components/primitives/MacroMeter";
import { PortionRange } from "@/components/primitives/PortionRange";
import { InsufficiencyTile, StatTile } from "@/components/primitives/StatTile";
import { exact, range } from "@/lib/measure";
import { macro, type FoodEntry } from "@/lib/nutrition";

/** 1e — the component sheet. Entry row, macro meter, provenance, portion range. */
const SALMON: FoodEntry = {
  id: "sheet-sal",
  time: "19:30",
  name: "Salmon fillet",
  per100g: { kcal: 208, protein: 20, carb: 0, fat: 13 },
  grams: range(160, 240),
  provenance: "photo",
  portionBounds: { min: 160, max: 240, step: 5 },
  note: "1 fillet · 180 g",
};

const STATES: readonly FoodEntry[] = [
  { id: "s1", time: "08:12", name: "Typed by hand — no mark", per100g: { kcal: 65, protein: 10, carb: 4, fat: 0.4 }, grams: exact(200), provenance: "manual" },
  { id: "s2", time: "12:40", name: "Said to the agent", per100g: { kcal: 186, protein: 21, carb: 0, fat: 11 }, grams: exact(210), provenance: "said" },
  { id: "s3", time: "16:05", name: "Barcode", per100g: { kcal: 393, protein: 33, carb: 44, fat: 12 }, grams: exact(60), provenance: "scanned" },
  { id: "s4", time: "19:30", name: "Photo estimate", per100g: { kcal: 208, protein: 20, carb: 0, fat: 13 }, grams: range(160, 240), provenance: "photo" },
  { id: "s5", time: null, name: "Backfilled from chat", per100g: { kcal: 206, protein: 12, carb: 20, fat: 9 }, grams: exact(200), provenance: "imported" },
  { id: "s6", time: "23:02", name: "Model estimate, unreviewed", per100g: { kcal: 190, protein: 8, carb: 22, fat: 8 }, grams: exact(200), provenance: "said", needsReview: true },
];

export default function ComponentsPage() {
  const [salmon, setSalmon] = useState<FoodEntry>(SALMON);

  return (
    <div data-theme="light" style={{ minHeight: "100dvh", background: "var(--bg-canvas)", color: "var(--text-1)" }}>
      <AppNav />
      <div style={{ padding: 28, maxWidth: 1000, margin: "0 auto" }}>
        <div
          data-theme="dark"
          style={{
            borderRadius: "var(--radius-card)",
            background: "var(--bg-screen)",
            border: "1px solid var(--line-frame)",
            padding: 28,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: 28,
            color: "var(--text-1)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Label>ENTRY ROW — STATES</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {STATES.map((e) => (
                <EntryRow key={e.id} entry={e} timeColumn={44} />
              ))}
            </div>
            <span style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>
              One mark, absent for the default case. Uncertainty is carried by the value itself — a
              range instead of a point — never by colour.
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Label>MACRO METER</Label>
              <MacroMeter label="UNDER" value={exact(134)} target={185} />
              <MacroMeter label="WITH ESTIMATE" value={range(134, 174)} target={185} />
              <MacroMeter label="OVER" value={exact(91)} target={78} />
              <span style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>
                Over target is a second segment in a different hue at the same weight — information,
                not alarm.
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Label>PORTION RANGE CONTROL</Label>
              <div
                style={{
                  padding: 14,
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-control)",
                  background: "var(--bg-card)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 14 }}>{salmon.name}</span>
                  <span className="num" style={{ fontSize: 12 }}>
                    {salmon.grams.kind === "exact"
                      ? `${Math.round(salmon.grams.value)} g`
                      : `${salmon.grams.low}–${salmon.grams.high} g`}
                  </span>
                </div>
                <PortionRange
                  min={160}
                  max={240}
                  step={5}
                  grams={salmon.grams}
                  kcal={macro(salmon, "kcal")}
                  anchor={salmon.note}
                  onChange={(g) => setSalmon((s) => ({ ...s, grams: exact(g) }))}
                />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Label>STAT TILE / INSUFFICIENCY</Label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <StatTile label="Hard sets · 7 d" value="74" meta="n = 4 sessions" />
                <InsufficiencyTile label="Bodyweight trend" have={6} need={10} eta="≈ 9 more days" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.1em",
        color: "var(--text-3)",
      }}
    >
      {children}
    </span>
  );
}
