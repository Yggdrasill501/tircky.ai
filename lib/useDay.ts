"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { exact } from "./measure";
import { FOOD, TARGETS } from "./fixtures";
import { dayTotals, setPortion, type FoodEntry } from "./nutrition";

/**
 * Day state. Stands in for the service layer from specs/nutrition — the shape
 * of what it returns is what the real one has to provide, so swapping it out
 * later touches this file and nothing that renders.
 */
export function useDay() {
  const [entries, setEntries] = useState<readonly FoodEntry[]>(FOOD);

  const setQuantity = useCallback((id: string, grams: number) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, grams: exact(grams) } : e)),
    );
  }, []);

  const setPortionFor = useCallback((id: string, grams: number) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? setPortion(e, grams) : e)));
  }, []);

  const totals = useMemo(() => dayTotals(entries, TARGETS), [entries]);
  const estimatedCount = useMemo(
    () => entries.filter((e) => e.grams.kind === "range").length,
    [entries],
  );

  return { entries, totals, targets: TARGETS, estimatedCount, setQuantity, setPortionFor };
}

export function useMediaQuery(query: string): boolean {
  // Starts false on the server and on the first client paint, then corrects in
  // an effect. Guessing a breakpoint during SSR produces a hydration mismatch
  // and a visible layout flip; one frame of the mobile layout does not.
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

/** True once the client has mounted — for anything that must not render on the server. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
