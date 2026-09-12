import { exact, range } from "./measure";
import type { FoodEntry, Targets } from "./nutrition";

/* Sample data, carried over verbatim from the design canvas so the
   implementation can be compared against it side by side. Replaced by the
   service layer in Phase 1 (see specs/nutrition/FEATURE_SPEC.md). */

export const TARGETS: Targets = { kcal: 2380, protein: 185, carb: 240, fat: 78 };

export const DAY_LABEL = "Friday 12 Sep";
export const DAY_NUMBER = 42;

export const FOOD: readonly FoodEntry[] = [
  {
    id: "yog",
    time: "08:12",
    name: "Greek yogurt, 0%",
    per100g: { kcal: 65, protein: 10, carb: 4, fat: 0.4 },
    grams: exact(200),
    provenance: "manual",
    editable: true,
  },
  {
    id: "blu",
    time: "08:12",
    name: "Blueberries",
    per100g: { kcal: 46, protein: 0.6, carb: 11, fat: 0.3 },
    grams: exact(80),
    provenance: "manual",
  },
  {
    id: "chk",
    time: "12:40",
    name: "Chicken thigh, grilled",
    per100g: { kcal: 186, protein: 21, carb: 0, fat: 11 },
    grams: exact(210),
    provenance: "said",
    editable: true,
    resolvedFrom: "usda · cooked",
  },
  {
    id: "rice",
    time: "12:40",
    name: "Jasmine rice, cooked",
    per100g: { kcal: 130, protein: 2.4, carb: 28, fat: 0.3 },
    grams: exact(260),
    provenance: "said",
    editable: true,
    resolvedFrom: "usda · assumed cooked weight",
    note: "rice read as cooked weight",
  },
  {
    id: "bro",
    time: "12:41",
    name: "Broccoli, steamed",
    per100g: { kcal: 41, protein: 3.4, carb: 8, fat: 0.4 },
    grams: exact(120),
    provenance: "said",
    resolvedFrom: "usda · portion estimated",
  },
  {
    id: "bar",
    time: "16:05",
    name: "Protein bar, cocoa",
    per100g: { kcal: 393, protein: 33, carb: 44, fat: 12 },
    grams: exact(60),
    provenance: "scanned",
    editable: true,
  },
  {
    id: "sal",
    time: "19:30",
    name: "Salmon fillet",
    per100g: { kcal: 208, protein: 20, carb: 0, fat: 13 },
    grams: range(160, 240),
    provenance: "photo",
    needsReview: true,
    portionBounds: { min: 160, max: 240, step: 5 },
    note: "1 fillet · 180 g",
  },
];

export interface SetLine {
  readonly exercise: string;
  readonly detail: string;
  readonly value: string;
}

export const TRAINING = {
  title: "Push A",
  time: "18:05",
  hardSets: 18,
  duration: "62 min",
  topSets: [
    { exercise: "Bench press", detail: "top set", value: "82.5 × 6 @8" },
    { exercise: "Overhead press", detail: "top set", value: "47.5 × 5 @9" },
  ] as const satisfies readonly { exercise: string; detail: string; value: string }[],
};

export const HEALTH = [
  { label: "Sleep", value: "7h 12m", meta: "health" },
  { label: "HRV 7d", value: "58 ms", meta: "n = 7" },
  { label: "Weight", value: "81.4 kg", meta: "07:02" },
] as const;

export const CHAT_UTTERANCE = "chicken thigh 210g, jasmine rice, some broccoli";

/** The order items resolve in as the agent streams — see specs/agent. */
export const CHAT_RESOLUTION_ORDER = ["chk", "rice", "bro"] as const;

export const REVIEW_QUEUE = {
  count: 3,
  summary: "3 items — 1 photo estimate, 2 imported from chat (11 Sep)",
};
