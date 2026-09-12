# Insights Specification

> Purpose: This document specifies the read side of the product — the derived metrics, the read
> models shared by the dashboard and the agent, and the rules that keep a chart from asserting more
> than the underlying data supports. It defines no tables of its own beyond a cache; every number
> here traces to data owned by `specs/training/FEATURE_SPEC.md`,
> `specs/nutrition/FEATURE_SPEC.md`, or `specs/health-ingest/FEATURE_SPEC.md`.

## Overview

Logging produces rows; insights are why anyone bothers. The job of this feature is to turn three
independently-collected streams — what was lifted, what was eaten, what the body did — into a small
number of statements a person can act on this week.

The hard part is restraint. Daily bodyweight is dominated by water and glycogen, so a two-point
"you gained 0.4 kg" is noise presented as signal. Weekly volume across an incomplete week reads as a
collapse. A correlation between sleep and squat performance over eleven data points is not a finding.
Every metric in this spec therefore carries an explicit sufficiency rule, and a metric that does not
meet it is **not rendered at reduced confidence — it is not rendered**, with a note saying what is
still needed.

A second principle: **insights describe, the agent explains.** A trend card says bodyweight fell
0.3 kg/week over four weeks. It does not say why. Causal questions go to
`specs/analysis-sandbox/FEATURE_SPEC.md`, where the reasoning is visible and the data behind it can
be inspected.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Read model** | — | query module | A named, reusable query shared by UI and agent tools |
| **Trend** | Trend | derived | A rate of change over a window, with sufficiency met |
| **Window** | Period | — | The range a metric is computed over |
| **Sufficiency** | — | per-metric rule | Minimum data required before a metric is shown |
| **Adherence** | Adherence | derived | Share of days in a window meeting a target |
| **Streak** | Streak | derived | Consecutive days satisfying a condition |
| **Snapshot cache** | — | `insight_snapshots` row | A precomputed metric set for a date |

## Conceptual Layers

```
Source data                       Read models                 Surfaces
-----------                       -----------                 --------
workout_sets, personal_records ─┐
meal_items, nutrition_targets  ─┼─▶ metric functions  ──▶  dashboard (RSC)
health_daily, sleep_sessions   ─┘    (one definition)   ──▶  agent read tools
                                          │              ──▶  analysis job exports
                                          ▼
                                  insight_snapshots (cache)
```

Every metric has exactly one implementation. The agent's `get_training_summary` and the dashboard's
volume chart call the same function — an agent that reports a different weekly volume than the chart
beside it destroys trust in both.

## Data Model

### `public.insight_snapshots`

A cache, not a source. Safe to truncate.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` NOT NULL | Composite PK with the next two |
| `local_date` | `date` NOT NULL | |
| `metric_set` | `varchar(48)` NOT NULL | `daily` \| `weekly` \| `body` \| `training` |
| `payload` | `jsonb` NOT NULL | Computed values with their sufficiency verdicts |
| `computed_at` | `timestamptz` NOT NULL | |
| `source_version` | `smallint` NOT NULL | Bumped when a metric definition changes |

Primary key `(user_id, local_date, metric_set)`.

`source_version` is what makes a definition change safe: bumping it invalidates every cached row
without a migration, so a corrected metric cannot be served from a stale cache. Without it, changing
a formula quietly leaves old dates computed the old way — the worst kind of inconsistency, because
the chart still renders.

## Metric Catalog

Each metric declares a window, an aggregation, and a sufficiency rule. Sufficiency is not advisory;
the read model returns `{ value, sufficient: false, reason }` and surfaces render the reason.

### Nutrition

| Metric | Definition | Window | Sufficiency |
| --- | --- | --- | --- |
| Daily totals | Σ `meal_items` macros by `local_date` | 1 day | ≥ 1 logged meal |
| Target adherence | Days within ±`ADHERENCE_BAND_PCT` of the kcal target | 7 / 28 days | ≥ 5 logged days in the window |
| Protein consistency | Days meeting the protein target | 7 / 28 days | ≥ 5 logged days |
| Average intake | Mean daily kcal over logged days only | 7 / 28 days | ≥ 5 logged days |
| Estimate share | Share of items with `resolution_method = 'llm_estimate'` | 28 days | ≥ 20 items |

**Unlogged days are excluded, never treated as zero.** A forgotten day is missing data, not a fast,
and averaging it in produces a deficit the user never ran. The count of logged days is shown beside
every average so the denominator is never hidden.

### Training

| Metric | Definition | Window | Sufficiency |
| --- | --- | --- | --- |
| Weekly volume | Σ working-set volume, by user's week start | per week | Week complete, or marked partial |
| Volume by muscle | Primary at 1.0, secondary at 0.5 per `specs/training/FEATURE_SPEC.md` | per week | ≥ 1 working set |
| Hard sets | Working sets with `rpe ≥ 7` or `rir ≤ 3`, per muscle | per week | ≥ 3 sets with RPE or RIR recorded |
| e1RM trend | Weekly best `estimated_1rm_kg`, linear fit | 8 weeks | ≥ 4 weeks with data |
| Frequency | Distinct training dates per muscle | per week | — |
| Staleness | Days since last working set, exercises with ≥ 3 historical sessions | now | — |
| PR timeline | `personal_records` ordered by `achieved_at` | any | — |

The in-progress week is always marked partial and is excluded from any trend fit. Including it makes
every Monday look like a catastrophic decline.

### Body and recovery

| Metric | Definition | Window | Sufficiency |
| --- | --- | --- | --- |
| Bodyweight trend | Linear fit over a 7-day centred moving average | 14 / 28 days | ≥ 10 measurements spanning ≥ 14 days |
| Rate of change | Fit slope, kg/week | 28 days | As above |
| Goal alignment | Rate vs `user_goals.target_rate_kg_per_week` | 28 days | Trend sufficient and a goal in force |
| Sleep average | Mean `asleep_s` | 7 / 28 days | ≥ 5 sessions |
| Sleep consistency | Standard deviation of sleep onset time | 28 days | ≥ 10 sessions |
| Resting HR trend | Fit over daily averages | 28 days | ≥ 14 days |
| HRV trend | Fit over daily averages | 28 days | ≥ 14 days |

**Bodyweight is only ever presented as a smoothed trend.** Day-to-day variation of 1–2 kg from water
and gut contents swamps a 0.5 kg/week change, so raw daily points are shown as faint context behind
the trend line and never as the headline number. Presenting a raw two-day delta as progress is the
single most common way a weight chart misleads the person reading it.

### Cross-domain

These are the reason the three streams live in one database. All are **descriptive**, presented as
co-occurrence, and never phrased causally.

| Metric | Definition | Sufficiency |
| --- | --- | --- |
| Energy balance proxy | Mean intake − mean (active + basal energy) over logged days | ≥ 14 days with both |
| Intake vs training days | Mean kcal on days with a workout vs without | ≥ 5 days in each group |
| Sleep vs session quality | Mean session RPE by sleep quartile of the prior night | ≥ 20 paired observations |
| Volume vs bodyweight | Weekly volume against weekly bodyweight trend | ≥ 8 paired weeks |

Below sufficiency, the card states how many more observations are needed. A correlation over eleven
points is a coincidence with a confidence interval, and rendering it teaches the user to act on
noise.

## Dashboard Surfaces

### Today

The default view. Nutrition totals against target with remaining macros; the open or completed
workout; last night's sleep; bodyweight trend value; and a review queue of any items flagged by the
nutrition resolver. Items carry provenance badges distinguishing manual, agent, and imported entries.

### Week

Volume by muscle group, hard sets, training frequency, kcal and protein adherence, sleep average. The
current week is explicitly marked in progress.

### Trends

Longer windows with the fitted lines above: bodyweight against goal rate, e1RM per tracked lift,
resting HR and HRV, sleep duration and consistency.

### Exercise detail

Per-exercise history: every set, e1RM progression, PR timeline, frequency, and staleness.

### Rendering conventions

Chart construction — form selection, palette, axis and tooltip behaviour, light and dark treatment —
follows the project's data-visualization conventions and is settled at implementation time rather than
fixed here. Three rules are semantic rather than visual, and belong in this spec:

1. A partial period is visually distinguished from a complete one, always.
2. A fitted trend is visually distinguished from raw observations, always.
3. A metric below sufficiency renders its reason, not a greyed-out number. A number a user can read
   is a number they will act on, regardless of styling.

## User Roles & Permissions

Per `specs/ARCHITECTURE.md`. Read-only over the user's own data.

## User Flows

### Flow 1: Morning check

The user opens Today. Snapshots for yesterday are already computed by the nightly job, so the view
renders without recomputation. Today's partial totals compute live — a day in progress changes every
few hours and cannot be cached usefully.

### Flow 2: Reviewing a trend

1. The user opens Trends over 28 days.
2. Each metric's sufficiency is evaluated first; sufficient metrics render with fit and confidence,
   insufficient ones render what is still needed.
3. Tapping a point shows the underlying days, so a surprising value can be traced to the entries
   behind it.

### Flow 3: The agent answering a question

The agent calls the same read models through its tools and receives the same sufficiency verdicts. It
is instructed to report insufficiency rather than to work around it — an agent that describes a trend
the dashboard declines to show is a contradiction the user has no way to resolve.

### Flow 4: A definition changes

1. A metric's formula is corrected.
2. `INSIGHT_SOURCE_VERSION` is bumped.
3. Cached snapshots are invalidated and recomputed lazily on next access.

## API Surface

No route handlers. Read models are a query module consumed by server components and by the agent's
tool wrappers.

| Read model | Purpose |
| --- | --- |
| `getDailySnapshot(date)` | Today view |
| `getWeeklySummary(weekStart)` | Week view |
| `getBodyTrend(range)` | Smoothed bodyweight, rate, goal alignment |
| `getExerciseProgression(exerciseId, range)` | e1RM series, PRs, frequency |
| `getRecoverySummary(range)` | Sleep, resting HR, HRV |
| `getCrossDomainSignals(range)` | The descriptive cross-domain set |
| `getReviewQueue()` | Items flagged by the nutrition resolver |

Every read model returns `{ value, sufficient, reason?, sampleSize, window }`. The envelope is
uniform so no caller can consume a value without having been handed its sufficiency alongside it.

## Invariants

1. Every metric has exactly one implementation, shared by dashboard and agent.
2. Every read model returns a sufficiency verdict with its sample size; there is no bare-value return.
3. A metric below sufficiency is not rendered as a number on any surface.
4. Unlogged days are excluded from nutrition averages, never counted as zero.
5. In-progress periods are excluded from trend fits and marked partial wherever shown.
6. Bodyweight is presented as a smoothed trend; raw daily values are never the headline.
7. Cross-domain metrics are phrased descriptively; no read model emits causal language.
8. `insight_snapshots` is a cache — truncating it changes no rendered value, only latency.
9. `source_version` is bumped whenever a metric definition changes.
10. All values are rendered in the user's display units per `specs/identity/FEATURE_SPEC.md`.

## Key Design Decisions

**Sufficiency as a first-class return value.** The alternative — rendering whatever is available —
produces a dashboard that is most confident exactly when it has least data, since early on every
metric is computed from a handful of points. Carrying the verdict in the envelope means no caller can
forget to check it.

**One implementation per metric.** Duplicating a definition between a chart query and an agent tool
guarantees eventual divergence, and the divergence surfaces as the agent contradicting the screen.

**Descriptive cross-domain signals.** "You eat 400 kcal more on training days" is checkable. "Eating
more on training days improves your lifts" is a causal claim from observational data on one person,
and the product has no basis for it. The distinction is enforced in the spec because it will
otherwise erode one plausible sentence at a time.

**Trend over raw for bodyweight.** Not a display preference — a correctness requirement. The raw
series has a signal-to-noise ratio below one at the timescales users check it on.

**Snapshots cached, today computed live.** Yesterday is immutable and worth caching; today changes
continuously and a cache would mostly serve stale numbers.

## Observability

- `insight_snapshot_computed_total{metric_set}`, `insight_snapshot_duration_ms`
- `insight_cache_hit_ratio`
- `insight_insufficient_total{metric}` — which metrics most often lack data; a persistently
  insufficient metric is either mis-specified or measuring something the user does not record
- `dashboard_render_duration_ms{surface}`

## Implementation Notes

### Module responsibilities

| Unit | Responsibility |
| --- | --- |
| Metric registry | Definitions, windows, sufficiency rules, `source_version` |
| Read models | The named queries above, returning the uniform envelope |
| Trend fitting | Moving averages, linear fits, confidence |
| Snapshot service | Cache read/write, invalidation on version bump |
| Nightly snapshot job | Precompute the prior day for all metric sets |
| Unit rendering | Canonical → display per preferences |

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `INSIGHT_SOURCE_VERSION` | 1 | Metric registry |
| `BODYWEIGHT_SMOOTHING_DAYS` | 7 | Trend fitting |
| `BODYWEIGHT_MIN_MEASUREMENTS` | 10 | Sufficiency |
| `TREND_MIN_SPAN_DAYS` | 14 | Sufficiency |
| `ADHERENCE_BAND_PCT` | 5 | Nutrition adherence |
| `MIN_LOGGED_DAYS_FOR_AVERAGE` | 5 | Nutrition averages |
| `CROSS_DOMAIN_MIN_PAIRS` | 20 | Cross-domain sufficiency |
| `HARD_SET_RPE_THRESHOLD` | 7 | Shared with training spec |

## Authors

- Claude (spec generation)
