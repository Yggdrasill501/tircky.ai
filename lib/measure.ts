/**
 * A measured value that may not be precisely known.
 *
 * This is the type the design turns on. A photo-estimated portion is not a
 * number with an error bar hidden behind it — it is genuinely a range, and the
 * range has to survive every sum it takes part in. Collapsing it to a midpoint
 * at the point of entry would make the day total look precise when it isn't,
 * which is the exact dishonesty the whole product is built to avoid.
 */
export type Measure =
  | { readonly kind: "exact"; readonly value: number }
  | { readonly kind: "range"; readonly low: number; readonly high: number };

export const exact = (value: number): Measure => ({ kind: "exact", value });

export const range = (low: number, high: number): Measure =>
  low === high ? exact(low) : { kind: "range", low, high };

export const isRange = (m: Measure): m is { kind: "range"; low: number; high: number } =>
  m.kind === "range";

export const low = (m: Measure): number => (m.kind === "exact" ? m.value : m.low);
export const high = (m: Measure): number => (m.kind === "exact" ? m.value : m.high);

/** Midpoint. Only for laying out a meter — never for display as a value. */
export const mid = (m: Measure): number =>
  m.kind === "exact" ? m.value : (m.low + m.high) / 2;

export const add = (a: Measure, b: Measure): Measure =>
  a.kind === "exact" && b.kind === "exact"
    ? exact(a.value + b.value)
    : range(low(a) + low(b), high(a) + high(b));

export const sum = (ms: readonly Measure[]): Measure => ms.reduce(add, exact(0));

export const scale = (m: Measure, k: number): Measure =>
  m.kind === "exact"
    ? exact(m.value * k)
    : k < 0
      ? range(m.high * k, m.low * k)
      : range(m.low * k, m.high * k);

/**
 * Subtract from a fixed target. Note the inversion: more intake means less
 * remaining, so the high end of intake produces the low end of what's left.
 * Getting this backwards is the easy mistake, and it reads as plausible.
 */
export const remaining = (target: number, consumed: Measure): Measure =>
  consumed.kind === "exact"
    ? exact(target - consumed.value)
    : range(target - consumed.high, target - consumed.low);

const group = (n: number): string => Math.round(n).toLocaleString("en-US");

/** Render a measure. A range renders as a range — there is no "close enough". */
export function fmt(m: Measure, unit = ""): string {
  const suffix = unit ? ` ${unit}` : "";
  return m.kind === "exact"
    ? `${group(m.value)}${suffix}`
    : `${group(m.low)}–${group(m.high)}${suffix}`;
}

/** Compact form for tight columns: no thousands separators. */
export function fmtTight(m: Measure, unit = ""): string {
  const suffix = unit ? ` ${unit}` : "";
  return m.kind === "exact"
    ? `${Math.round(m.value)}${suffix}`
    : `${Math.round(m.low)}–${Math.round(m.high)}${suffix}`;
}
