"use client";

import { fmt, fmtTight } from "@/lib/measure";
import { macro, type FoodEntry } from "@/lib/nutrition";
import { ProvenanceMark } from "./ProvenanceMark";

/**
 * The most-used component in the product: time, item, amount, energy.
 *
 * Uncertainty is carried by the value itself — "160–240 g · 333–499" — never by
 * a colour or an icon. An unreviewed model estimate is the one case that dims,
 * because it is the one case where the name itself is not yet trustworthy.
 */
export function EntryRow({
  entry,
  onQuantity,
  timeColumn = 42,
}: {
  entry: FoodEntry;
  onQuantity?: (id: string, grams: number) => void;
  timeColumn?: number;
}) {
  const kcal = macro(entry, "kcal");
  const dim = entry.needsReview && entry.provenance !== "photo";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${timeColumn}px 1fr auto`,
        gap: 10,
        alignItems: "baseline",
        padding: "7px 0",
        borderTop: "1px solid var(--line-hair)",
      }}
    >
      <span className="num" style={{ fontSize: 11, color: "var(--text-4)" }}>
        {entry.time ?? "—"}
      </span>

      <span style={{ display: "flex", gap: 7, alignItems: "baseline", minWidth: 0 }}>
        <span
          style={{
            fontSize: 14,
            color: dim ? "var(--text-3)" : "var(--text-1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.name}
        </span>
        <ProvenanceMark of={entry.provenance} review={dim} />
      </span>

      <span
        className="num"
        style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12 }}
      >
        {entry.editable && onQuantity && entry.grams.kind === "exact" ? (
          <input
            className="qty-input"
            type="number"
            value={Math.round(entry.grams.value)}
            aria-label={`${entry.name} amount in grams`}
            onChange={(e) => onQuantity(entry.id, Math.max(0, Number(e.target.value) || 0))}
          />
        ) : (
          <span style={{ width: 44, textAlign: "right", color: "var(--text-2)" }}>
            {fmtTight(entry.grams)}
          </span>
        )}
        <span
          style={{
            minWidth: 40,
            textAlign: "right",
            color: dim ? "var(--text-3)" : "var(--text-1)",
          }}
        >
          {fmt(kcal)}
        </span>
      </span>
    </div>
  );
}
