import { type Measure, exact, high, low, range, remaining, scale, sum } from "./measure";

/** Per-100g nutrients. Ordered [kcal, protein, carb, fat] as in the design. */
export interface Per100g {
  readonly kcal: number;
  readonly protein: number;
  readonly carb: number;
  readonly fat: number;
}

export type Provenance = "manual" | "said" | "scanned" | "photo" | "imported" | "health";

export interface FoodEntry {
  readonly id: string;
  readonly time: string | null;
  readonly name: string;
  readonly per100g: Per100g;
  /** Grams. A range when the portion was estimated from a photograph. */
  readonly grams: Measure;
  readonly provenance: Provenance;
  /** True until a human has confirmed a low-confidence resolution. */
  readonly needsReview?: boolean;
  /** Editable in place — the day view lets you retype the amount. */
  readonly editable?: boolean;
  /** Bounds for the portion slider, when the portion came from a photo. */
  readonly portionBounds?: { readonly min: number; readonly max: number; readonly step: number };
  readonly note?: string;
  readonly resolvedFrom?: string;
}

export interface Targets {
  readonly kcal: number;
  readonly protein: number;
  readonly carb: number;
  readonly fat: number;
}

export type MacroKey = keyof Per100g;

/** Nutrients for one entry, carrying the portion's uncertainty forward. */
export const macro = (e: FoodEntry, k: MacroKey): Measure =>
  scale(e.grams, e.per100g[k] / 100);

export const totalMacro = (entries: readonly FoodEntry[], k: MacroKey): Measure =>
  sum(entries.map((e) => macro(e, k)));

export interface DayTotals {
  readonly kcal: Measure;
  readonly protein: Measure;
  readonly carb: Measure;
  readonly fat: Measure;
  readonly kcalLeft: Measure;
  /** The portion of the total contributed by entries that are still estimates. */
  readonly estimated: Measure;
}

export function dayTotals(entries: readonly FoodEntry[], targets: Targets): DayTotals {
  const estimates = entries.filter((e) => e.grams.kind === "range");
  const kcal = totalMacro(entries, "kcal");
  return {
    kcal,
    protein: totalMacro(entries, "protein"),
    carb: totalMacro(entries, "carb"),
    fat: totalMacro(entries, "fat"),
    kcalLeft: remaining(targets.kcal, kcal),
    estimated: totalMacro(estimates, "kcal"),
  };
}

/**
 * Meter geometry. Three segments, and the split is the point: what is known,
 * what is still a range, and what is past target. The estimated span is drawn
 * as a hatch so it cannot be mistaken for logged intake, and the over-target
 * span gets a hue rotation rather than a red.
 */
export interface MeterSegments {
  readonly certainPct: number;
  readonly estimatedPct: number;
  readonly overPct: number;
}

export function meterSegments(value: Measure, target: number): MeterSegments {
  if (target <= 0) return { certainPct: 0, estimatedPct: 0, overPct: 0 };

  const certain = Math.max(0, low(value));
  const certainPct = Math.min(100, (certain / target) * 100);
  const estimatedPct = Math.min(
    100 - certainPct,
    (Math.max(0, high(value) - certain) / target) * 100,
  );
  const over = Math.max(0, high(value) - target);
  // Capped so a big overshoot cannot swallow the whole bar and lose the
  // proportion that makes the rest of it readable.
  const overPct = over > 0 ? Math.min(20, (over / target) * 100) : 0;

  return { certainPct, estimatedPct, overPct };
}

/** Re-portion a photo-estimated entry. Setting it discards the range. */
export function setPortion(e: FoodEntry, grams: number): FoodEntry {
  return { ...e, grams: exact(grams), needsReview: false };
}

export function resetPortion(e: FoodEntry): FoodEntry {
  const b = e.portionBounds;
  return b ? { ...e, grams: range(b.min, b.max), needsReview: true } : e;
}

export const isEstimated = (e: FoodEntry): boolean => e.grams.kind === "range";
