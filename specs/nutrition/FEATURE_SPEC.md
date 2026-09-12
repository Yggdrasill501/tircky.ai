# Nutrition Specification

> Purpose: This document specifies how food is modelled and logged — the food catalog and its
> external sources, the resolution pipeline that turns "two eggs and a slice of toast" into rows with
> real macros, the immutability rule that protects historical totals, and the targets the day view
> checks against. See `specs/ARCHITECTURE.md` for units, time, ownership, and provenance conventions.

## Overview

This is the feature the product exists for. Logging food conversationally is effortless, and that is
exactly why it is dangerous: a model asked to produce macros for "chicken and rice" will produce
plausible numbers, and different plausible numbers tomorrow. Over a month that variance is larger
than the deficit being tracked, and the trend line — the only reason to log at all — becomes noise.

The pipeline therefore splits the problem. **Claude does the part it is uniquely good at**: turning
messy natural language into a structured list of items, quantities, and units, including the implicit
ones ("a slice", "a handful", "medium"). **A food database does the part it is good at**: telling us
what 100 g of that food actually contains. The model proposes; the database disposes.

Where no database match exists, an LLM estimate is used — but it is written with
`resolution_method = 'llm_estimate'`, surfaced in the UI as an estimate, and counted in a metric.
The share of entries resolved that way is the standing quality signal for this feature.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Food** | Food | `foods` row | A catalog entry: generic item, branded product, or user recipe |
| **Serving** | Serving | `food_servings` row | A named portion of a food, mapped to grams |
| **Meal** | Meal | `meals` row | A group of items eaten together at a time |
| **Item** | — | `meal_items` row | One food in one meal, with a quantity and a macro snapshot |
| **Resolution** | — | `resolution_method` | How an item's food was determined |
| **Snapshot** | — | macro columns on `meal_items` | Macros computed at log time and frozen |
| **Target** | Target | `nutrition_targets` row | Daily macro goals in force over a period |
| **FDC** | — | — | USDA FoodData Central, the generic-food source |
| **OFF** | — | — | Open Food Facts, the branded/barcode source |

## Conceptual Layers

```
Text / barcode / search
         │
         ▼
  parse (Claude, structured output)  ──▶  [{ name, quantity, unit, preparation }]
         │
         ▼
  resolve (per item)
    ├─ local foods       exact slug / alias / prior user choice
    ├─ USDA FDC          generic foods
    ├─ Open Food Facts   branded, barcode
    └─ LLM estimate      flagged, low confidence
         │
         ▼
  snapshot macros  ──▶  meal_items (frozen kcal/protein/carb/fat)
         │
         ▼
  daily totals vs nutrition_targets
```

Every external lookup that succeeds is **cached as a local `foods` row**. The second time a food is
eaten it resolves locally, with no network call, no latency, and — critically — the same numbers.

## Data Model

### `public.foods`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NULL | `NULL` = shared catalog entry (cached external food or seed) |
| `source` | `food_source_enum` NOT NULL | `usda` \| `off` \| `user` \| `llm` \| `seed` |
| `source_id` | `text` NULL | FDC id or OFF barcode; unique per source |
| `name` | `varchar(200)` NOT NULL | |
| `slug` | `varchar(200)` NOT NULL | Normalized for matching |
| `brand` | `varchar(160)` NULL | |
| `barcode` | `varchar(32)` NULL | EAN/UPC |
| `aliases` | `text[]` NOT NULL DEFAULT `'{}'` | Matched during resolution |
| `is_recipe` | `boolean` NOT NULL DEFAULT false | Composed of other foods |
| `density_g_per_ml` | `numeric(6,3)` NULL | Enables volume → mass conversion |
| `verified_at` | `timestamptz` NULL | Set when the user confirms the numbers are right |
| `fetched_at` | `timestamptz` NULL | When the external source was last read |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

Indexes: unique `idx_foods_source` on `(source, source_id) WHERE source_id IS NOT NULL`,
`idx_foods_barcode`, GIN trigram on `name`, GIN on `aliases`.

### `public.food_nutrients`

One row per food. Macros are columns because every query touches them; micronutrients are `jsonb`
because they are sparse, numerous, and rarely aggregated.

| Column | Type | Notes |
| --- | --- | --- |
| `food_id` | `uuid` PK FK → `foods(id)` `ON DELETE CASCADE` | |
| `kcal_per_100g` | `numeric(8,2)` NOT NULL | |
| `protein_g_per_100g` | `numeric(7,2)` NOT NULL | |
| `carb_g_per_100g` | `numeric(7,2)` NOT NULL | |
| `fat_g_per_100g` | `numeric(7,2)` NOT NULL | |
| `fiber_g_per_100g` | `numeric(7,2)` NULL | |
| `sugar_g_per_100g` | `numeric(7,2)` NULL | |
| `saturated_fat_g_per_100g` | `numeric(7,2)` NULL | |
| `sodium_mg_per_100g` | `numeric(9,2)` NULL | |
| `micros` | `jsonb` NOT NULL DEFAULT `'{}'` | Keyed by nutrient code |
| `updated_at` | `timestamptz` | |

Everything is per 100 g, always, regardless of how the source expressed it. A source reporting per
serving is converted on ingest. One denominator means the quantity arithmetic below is one formula
rather than a branch per source.

### `public.food_servings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `food_id` | `uuid` NOT NULL | `ON DELETE CASCADE` |
| `label` | `varchar(80)` NOT NULL | "1 medium", "1 slice", "1 cup", "1 scoop" |
| `grams` | `numeric(9,3)` NOT NULL | |
| `is_default` | `boolean` NOT NULL DEFAULT false | Used when a quantity has no explicit unit |
| `source` | `food_source_enum` NOT NULL | Servings may be user-added to an external food |

Indexes: unique `idx_food_servings_label` on `(food_id, lower(label))`.

This table is what makes "a slice of toast" resolvable. Without it, every non-metric quantity becomes
an LLM guess, which is precisely the drift this design exists to prevent.

### `public.meals`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `meal_type` | `meal_type_enum` NOT NULL | `breakfast` \| `lunch` \| `dinner` \| `snack` \| `pre_workout` \| `post_workout` |
| `eaten_at` | `timestamptz` NOT NULL | |
| `local_date` | `date` NOT NULL | Per `specs/ARCHITECTURE.md` |
| `note` | `text` NULL | Untrusted input to the agent |
| `raw_text` | `text` NULL | The original utterance, when logged conversationally |
| `source` | `source_enum` NOT NULL | |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

Indexes: `idx_meals_user_date` on `(user_id, local_date DESC)`.

`raw_text` is retained deliberately. When a total looks wrong three weeks later, the question is
always "what did I actually say", and without the original utterance there is no way to tell a
mis-parse from a mis-memory.

### `public.meal_items`

The snapshot table. **The macro columns here are the historical record.**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `meal_id` | `uuid` NOT NULL | `ON DELETE CASCADE` |
| `food_id` | `uuid` NULL | `NULL` only for an unresolved free-text item |
| `position` | `smallint` NOT NULL | |
| `quantity` | `numeric(9,3)` NOT NULL | As entered |
| `unit` | `varchar(32)` NOT NULL | As entered: `g`, `ml`, or a serving label |
| `grams` | `numeric(10,3)` NOT NULL | Resolved mass — the basis of every calculation |
| `kcal` | `numeric(9,2)` NOT NULL | **Snapshot** |
| `protein_g` | `numeric(8,2)` NOT NULL | **Snapshot** |
| `carb_g` | `numeric(8,2)` NOT NULL | **Snapshot** |
| `fat_g` | `numeric(8,2)` NOT NULL | **Snapshot** |
| `fiber_g` | `numeric(8,2)` NULL | **Snapshot** |
| `micros` | `jsonb` NOT NULL DEFAULT `'{}'` | **Snapshot** |
| `resolution_method` | `resolution_enum` NOT NULL | `barcode` \| `db_exact` \| `db_fuzzy` \| `prior_choice` \| `user_picked` \| `llm_estimate` \| `vision_barcode` \| `vision_estimate` \| `unresolved` |
| `confidence` | `numeric(3,2)` NULL | 0–1, populated for fuzzy and LLM paths |
| `raw_text` | `text` NULL | The fragment this item came from |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

Indexes: unique `idx_meal_items_position` on `(meal_id, position)`,
`idx_meal_items_resolution` on `(resolution_method)`.

### `public.nutrition_targets`

Periodized, like `user_goals` in `specs/identity/FEATURE_SPEC.md`, and for the same reason.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `effective_from` | `date` NOT NULL | |
| `effective_to` | `date` NULL | `NULL` = in force |
| `kcal` | `numeric(7,1)` NOT NULL | |
| `protein_g` | `numeric(6,1)` NOT NULL | |
| `carb_g` | `numeric(6,1)` NULL | |
| `fat_g` | `numeric(6,1)` NULL | |
| `fiber_g` | `numeric(5,1)` NULL | |
| `training_day_kcal_delta` | `numeric(6,1)` NULL | Applied on days with a logged workout |
| `note` | `text` NULL | |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

### `public.recipe_components`

For `foods` rows with `is_recipe = true`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `recipe_food_id` | `uuid` NOT NULL | The composed food |
| `component_food_id` | `uuid` NOT NULL | An ingredient |
| `grams` | `numeric(10,3)` NOT NULL | |
| `position` | `smallint` NOT NULL | |

A recipe's `food_nutrients` row is computed from its components and recomputed when they change. A
recipe cannot contain itself, directly or transitively; the service enforces this on write by walking
the component graph.

### Enums owned by this spec

`food_source_enum`, `meal_type_enum`, `resolution_enum`.

## The Snapshot Rule

**`meal_items` macro columns are written once, at log time, and are never recomputed from
`food_nutrients`.**

This is the most important rule in the spec. Consider what the alternative does. On 3 March the user
logs 200 g of a chicken breast entry that says 165 kcal/100 g, and their day totals 2,140 kcal. On
12 April they notice the entry is wrong and correct it to 195 kcal/100 g. If macros are computed by
join, 3 March silently becomes 2,200 kcal — a day they already reviewed, already reasoned about,
already used to decide their deficit was working. Every chart shifts. Nothing announces it.

The snapshot means a food correction affects everything logged **after** it and nothing logged
before. Where the user genuinely wants history restated, `recalculateMeals(foodId, fromDate)` does it
explicitly, reports how many rows and how many kcal changed, and records the operation. Restating
history is a decision, not a side effect.

## Quantity Resolution

Every item reduces to grams before any macro arithmetic:

| Entered unit | Resolution |
| --- | --- |
| `g`, `kg`, `oz`, `lb` | Direct mass conversion |
| `ml`, `l`, `fl oz`, `cup` | `grams = volume_ml × density_g_per_ml`; fails to a serving lookup if density is unknown |
| A serving label | `grams = quantity × food_servings.grams` for the matching label |
| Bare number, no unit | `grams = quantity × ` the default serving; if none, the item is unresolved |

Then, uniformly:

```
kcal = grams / 100 × kcal_per_100g          (and likewise for each macro)
```

Converting volume to mass without a density is the single most common source of silent error in food
logging — a cup of flour and a cup of oil are not the same mass, and treating 1 ml as 1 g is right
only for water. Where density is unknown the item resolves through a serving or not at all.

## Resolution Pipeline

Per parsed item, first match wins:

| Order | Method | Condition |
| --- | --- | --- |
| 0 | `vision_barcode` | A barcode was decoded from the camera; see `specs/food-capture/FEATURE_SPEC.md` |
| 1 | `barcode` | A barcode was entered; exact lookup on `foods.barcode`, then OFF |
| 2 | `prior_choice` | The user has previously resolved this exact text to a food; reuse it |
| 3 | `db_exact` | Slug or alias match against local `foods` |
| 4 | `db_fuzzy` | Trigram similarity above threshold against local `foods` |
| 5 | external | USDA FDC for generic items, OFF for branded; cache the result as a local food |
| 6 | `llm_estimate` | Nothing matched; Claude estimates per-100 g macros, flagged |

`prior_choice` ranks above exact matching on purpose. When the user has once said that their "protein
shake" means a specific product, that decision is more informative than any catalog match, and
re-asking is precisely the friction this product removes.

Steps 3–5 return candidates with scores. Above the auto-accept threshold the top candidate is taken;
between the auto-accept and floor thresholds the item is written with its best candidate and marked
**needs review**, surfaced inline in the day view rather than as a blocking prompt. Logging never
stops to ask a question — a pipeline that interrupts is a pipeline the user routes around by not
logging.

Camera input enters this same pipeline rather than bypassing it:
`specs/food-capture/FEATURE_SPEC.md` specifies barcode decoding, nutrition-label reading, and meal
photo recognition, all of which produce items that resolve here and macros that come from
`food_nutrients`. Vision identifies; this pipeline resolves.

### The parse step

One Claude call per utterance, structured output via `zodOutputFormat`, schema:

```
items: [{ name, quantity, unit, preparation?, brand?, confidence }]
meal_type?, eaten_at?
```

The parse step does not produce macros. It is not asked to, and the schema gives it nowhere to put
them. This is the boundary that keeps estimation out of the default path — the model cannot
accidentally supply numbers because there is no field for them.

`preparation` ("grilled", "fried", "raw") is captured because it materially changes macros and is the
most common reason a database match is wrong in a way the user would not notice.

## User Roles & Permissions

Per `specs/ARCHITECTURE.md`. Catalog foods with `user_id IS NULL` are readable by all and not
editable through the API; a user editing a shared food gets a **copy** owned by them, which then
shadows the shared row in their resolution — the same shadowing rule as exercises and skills.

## User Flows

### Flow 1: Log a meal conversationally

1. The user says "two scrambled eggs, a slice of sourdough with butter, and a flat white".
2. Parse → four items with quantities and units.
3. Resolve each per the pipeline; cache any external hits as local foods.
4. Compute grams, then macros; write `meals` + `meal_items` with snapshots.
5. The agent replies with the total and a one-line breakdown, flagging anything below the review
   threshold.
6. An `agent_actions` row makes the whole meal reversible in one step.

### Flow 2: Log by barcode

1. The user scans a barcode.
2. Local `foods.barcode` lookup; on a miss, OFF by barcode; on a miss there, the user is offered
   manual entry from the label.
3. A manually entered product is written as a `user` food with its barcode, so the next scan resolves
   locally.

### Flow 3: Correct an item

1. The user changes the food, the quantity, or the unit.
2. Macros are recomputed **for that item only**, from the food's current nutrients.
3. `resolution_method` becomes `user_picked` and confidence clears.
4. The correction is recorded as a `prior_choice` mapping from the item's `raw_text`, so the same
   phrase resolves correctly next time without being asked again.

Step 4 is what makes the system improve with use. Each correction is training data for the resolver,
stored as data rather than folded into a prompt.

### Flow 4: Correct a food's nutrients

1. The user edits `food_nutrients` on a food they own.
2. Existing `meal_items` are **unchanged** (see The Snapshot Rule).
3. The UI reports how many past entries used the old values and offers
   `recalculateMeals(foodId, fromDate)` as an explicit action with a preview of the delta.

### Flow 5: Create a recipe

1. The user composes a food from components with gram amounts.
2. Total nutrients are computed and stored on the recipe's `food_nutrients` row.
3. A serving is defined (e.g. "1 portion" = total grams / portions).
4. Editing a component recomputes the recipe's nutrients, which — per the snapshot rule — affects
   future logs only.

### Flow 6: Daily totals

1. Items are summed by `meals.local_date` (never by UTC date).
2. The target in force for that date is selected from `nutrition_targets`.
3. If a workout exists on that date and `training_day_kcal_delta` is set, it is applied.
4. The day view shows totals, remaining, and macro split, with a provenance badge per item and a
   review affordance on anything below the threshold.

## API Surface

Mutations are Server Actions; the agent reaches the same service functions through its tools.

| Action | Purpose | Notable failures |
| --- | --- | --- |
| `parseMealText(text)` | Structured parse only; writes nothing | 400 if the text yields no items |
| `logMeal(input)` | Resolve, snapshot, persist | 400 on unresolvable required fields |
| `searchFoods(query, opts)` | Local-first search, optional external fan-out | — |
| `lookupBarcode(code)` | Local → OFF | 404 if unknown to both |
| `updateMealItem(id, patch)` | Flow 3, including the `prior_choice` write | 404 |
| `createFood(input)` / `updateFood(id, patch)` | User catalog | 403 on a shared food, 400 on validation |
| `recalculateMeals(foodId, fromDate)` | Explicit historical restatement | 404 |
| `setNutritionTargets(input)` | New target period | 400 on overlap |
| `getDailyNutrition(date)` | Flow 6 read model | — |

External calls (FDC, OFF) are server-side only, rate-limited, and cached per
`FOOD_CACHE_TTL_DAYS`. A failure of either degrades resolution to the local catalog and the LLM
fallback; it never fails the log.

## Invariants

1. `meal_items` macro columns are immutable with respect to `food_nutrients` changes. Only an
   explicit item edit or `recalculateMeals` alters them.
2. `meal_items.grams` is always populated and is the sole basis of macro arithmetic.
3. All `food_nutrients` values are per 100 g, regardless of source expression.
4. A `meal_items` row with `food_id IS NULL` has `resolution_method = 'unresolved'` and zeroed macros,
   and is excluded from daily totals while remaining visible in the day view.
5. Every successful external lookup is persisted as a local `foods` row before the item is written.
6. `resolution_method = 'llm_estimate'` rows are visually distinguished in every surface that shows
   them.
7. At most one `nutrition_targets` row per user has `effective_to IS NULL`; periods do not overlap.
8. A recipe's component graph is acyclic.
9. Daily totals group on `local_date`, never on a UTC-derived date.
10. Shared foods (`user_id IS NULL`) are immutable through the API; editing one produces a user-owned
    copy.

## Key Design Decisions

**The model parses; the database resolves.** Stated once more because it is the whole design: the
parse schema has no macro fields, so estimation cannot leak into the default path. Every number in a
normal log traces to a food row someone can inspect.

**Snapshots over joins.** Detailed above. The short version: a nutrition log is a historical record,
and historical records do not change when reference data is corrected.

**Per-100 g canonical form.** Sources express nutrients per serving, per container, per ounce. One
denominator, normalized on ingest, collapses that into a single arithmetic path.

**`prior_choice` above exact match.** The user's own past decision outranks the catalog. This is the
mechanism by which the system stops asking the same question.

**Never block the log.** Ambiguity is written with the best candidate and flagged for review rather
than raised as a modal. The failure mode of an interrupting logger is not bad data — it is no data.

**Two sources, deliberately.** USDA FDC has reliable generic foods and no European branded products;
Open Food Facts has barcodes and global coverage with crowd-edited quality. Neither alone covers a
normal week of eating. OFF text is treated as untrusted per `specs/ARCHITECTURE.md` § Security Model.

## Observability

- `food_resolution_total{method}` — the `llm_estimate` and `unresolved` shares are the headline
  quality signal for this feature
- `food_resolution_confidence` — histogram over fuzzy and LLM paths
- `meal_logged_total{source}`
- `food_external_lookup_total{provider, outcome}` and `food_external_lookup_duration_ms`
- `food_cache_hit_ratio` — local resolution share; expected to climb toward a plateau as the user's
  catalog fills, and a flat line means caching is not working
- `meal_item_corrected_total{from_method}` — which resolution paths the user most often has to fix
- `recalculate_meals_total{rows_affected}` — deliberately rare

## Implementation Notes

### Module responsibilities

| Unit | Responsibility |
| --- | --- |
| Meal parser | Claude structured-output call, items only |
| Resolution pipeline | The ordered strategy chain, scoring, thresholds |
| FDC client | USDA lookup, per-100 g normalization, rate limiting |
| OFF client | Barcode and product lookup, normalization, untrusted-text fencing |
| Food catalog service | CRUD, shadowing, copy-on-edit of shared foods |
| Serving resolver | Quantity + unit + food → grams, including density |
| Macro calculator | Grams + per-100 g nutrients → snapshot |
| Recipe service | Component graph, cycle check, nutrient rollup |
| Targets service | Periodization, training-day delta |
| Daily read model | Totals, remaining, provenance, review queue |

### Seed catalog

A small seed of common whole foods ships in the repo with stable hardcoded UUIDs and loads by
migration — the same pattern as system exercises and system skills. It exists so the first week of
logging resolves locally instead of hammering external APIs while the cache is cold.

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `FUZZY_AUTO_ACCEPT_SCORE` | 0.82 | Resolution pipeline |
| `FUZZY_FLOOR_SCORE` | 0.55 | Resolution pipeline |
| `REVIEW_CONFIDENCE_THRESHOLD` | 0.70 | Needs-review flag |
| `FOOD_CACHE_TTL_DAYS` | 30 | External lookup cache |
| `FDC_RATE_LIMIT_PER_HOUR` | 1000 | FDC client |
| `OFF_RATE_LIMIT_PER_MINUTE` | 60 | OFF client |
| `MAX_ITEMS_PER_MEAL` | 40 | Parse validation |
| `MAX_RECIPE_DEPTH` | 4 | Cycle and depth check |

## Authors

- Claude (spec generation)
