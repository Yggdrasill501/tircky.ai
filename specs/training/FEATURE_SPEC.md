# Training Specification

> Purpose: This document specifies how training is modelled, logged, and summarized — the exercise
> catalog, the workout/exercise/set hierarchy, personal-record derivation, and the volume and
> progression metrics the dashboard and the agent both read. See `specs/ARCHITECTURE.md` for units,
> time, ownership, and provenance conventions, which this spec assumes throughout.

## Overview

A training log has to represent what actually happens in a gym, which is more varied than most schema
designs admit: straight sets, supersets, drop sets, AMRAPs, timed carries, unilateral work logged
per side, bodyweight movements with added or assisted load, and cardio measured in distance rather
than reps. A schema that only understands weight × reps forces half of those into a notes field,
where nothing can aggregate them.

The model here is three levels — **workout** → **workout exercise** → **set** — with the set as a
sparse row carrying whichever of `weight`, `reps`, `duration`, and `distance` the movement actually
has. A squat set fills weight and reps. A plank fills duration. A rowing interval fills distance and
duration. Nothing is forced into a column that does not apply, and aggregation queries filter on what
is present rather than on a movement-type discriminator.

Personal records and volume are **derived**, never entered. They are recomputed from sets on every
write, which means a corrected typo in a set from three weeks ago correctly demotes a PR that was
never real.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Exercise** | Exercise | `exercises` row | A movement in the catalog; system or user-defined |
| **Workout** | Session | `workouts` row | One training session with a start and end |
| **Workout exercise** | — | `workout_exercises` row | One exercise as performed in one workout, ordered |
| **Set** | Set | `workout_sets` row | One performed set, with whichever metrics apply |
| **Working set** | — | `set_type = 'working'` | A set that counts toward volume and PRs |
| **Superset** | Superset | `superset_group` | Exercises alternated without rest between them |
| **e1RM** | Estimated 1RM | `estimated_1rm_kg` | Load estimated to be maximal for one repetition |
| **PR** | Personal record | `personal_records` row | The best value of one metric for one exercise |
| **Volume** | Volume | derived | Σ (weight × reps) over working sets |

## Conceptual Layers

```
Catalog                 Log                          Derived
-------                 ---                          -------
exercises        ──▶    workouts                     personal_records
  (system|user)           └─ workout_exercises   ──▶ volume / tonnage rollups
                               └─ workout_sets       e1RM progression
```

The catalog is reference data; the log is the user's history; derived tables are a cache of queries
over the log that are too expensive to run on every dashboard render. Derived rows are always
reproducible from the log — dropping and rebuilding `personal_records` is a supported operation and
is how a backfill works.

## Data Model

### `public.exercises`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NULL | `NULL` = system exercise, readable by all, writable by none |
| `name` | `varchar(120)` NOT NULL | Display name, e.g. "Barbell Back Squat" |
| `slug` | `varchar(120)` NOT NULL | Normalized; unique per owner among non-deleted |
| `modality` | `modality_enum` NOT NULL | `barbell` \| `dumbbell` \| `machine` \| `cable` \| `bodyweight` \| `kettlebell` \| `band` \| `cardio` \| `other` |
| `metrics` | `metric_enum[]` NOT NULL | Which of `weight`, `reps`, `duration`, `distance` this movement uses |
| `primary_muscle` | `muscle_enum` NOT NULL | |
| `secondary_muscles` | `muscle_enum[]` NOT NULL DEFAULT `'{}'` | |
| `is_unilateral` | `boolean` NOT NULL DEFAULT false | Logged per side |
| `bodyweight_factor` | `numeric(3,2)` NULL | Fraction of bodyweight loaded, for bodyweight volume |
| `aliases` | `text[]` NOT NULL DEFAULT `'{}'` | Matched by the agent's exercise resolver |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

Indexes: `idx_exercises_user`, unique `idx_exercises_owner_slug` on `(COALESCE(user_id, '00000000-...'), slug) WHERE deleted_at IS NULL`, GIN on `aliases`.

`metrics` is what makes the sparse set row safe: the service layer validates that a set only fills
columns the exercise declares, so a plank cannot acquire a rep count and a squat cannot acquire a
distance.

`bodyweight_factor` lets bodyweight movements contribute honestly to volume — a pull-up is
approximately 1.0, a push-up approximately 0.64. Without it, a session of calisthenics reports zero
volume, and the weekly chart lies.

### `public.workouts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `title` | `varchar(160)` NULL | e.g. "Upper A" |
| `started_at` | `timestamptz` NOT NULL | |
| `ended_at` | `timestamptz` NULL | `NULL` = in progress |
| `local_date` | `date` NOT NULL | Per `specs/ARCHITECTURE.md`; day the session belongs to |
| `notes` | `text` NULL | Free text; untrusted input to the agent |
| `perceived_exertion` | `smallint` NULL | Session RPE, 1–10 |
| `location` | `varchar(120)` NULL | |
| `source` | `source_enum` NOT NULL | |
| `external_id` | `text` NULL | Provenance for imported sessions |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

Indexes: `idx_workouts_user_date` on `(user_id, local_date DESC)`, unique
`idx_workouts_external` on `(user_id, source, external_id) WHERE external_id IS NOT NULL`.

### `public.workout_exercises`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `workout_id` | `uuid` NOT NULL | `ON DELETE CASCADE` |
| `exercise_id` | `uuid` NOT NULL | |
| `position` | `smallint` NOT NULL | Order within the workout |
| `superset_group` | `smallint` NULL | Equal values are alternated together |
| `notes` | `text` NULL | |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: unique `idx_workout_exercises_position` on `(workout_id, position)`.

`workout_id` is the ownership path — `user_id` is not duplicated here. RLS on this table joins to
`workouts`; the service layer scopes by workout.

### `public.workout_sets`

The sparse row. Exactly the metrics the exercise declares are populated; the rest are `NULL`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `workout_exercise_id` | `uuid` NOT NULL | `ON DELETE CASCADE` |
| `set_index` | `smallint` NOT NULL | 1-based, within the workout exercise |
| `set_type` | `set_type_enum` NOT NULL | `working` \| `warmup` \| `drop` \| `backoff` \| `amrap` \| `failure` |
| `weight_kg` | `numeric(8,3)` NULL | Canonical kilograms; negative for assisted movements |
| `reps` | `smallint` NULL | |
| `duration_s` | `integer` NULL | |
| `distance_m` | `numeric(10,2)` NULL | |
| `side` | `side_enum` NULL | `left` \| `right` \| `both`; required when the exercise is unilateral |
| `rpe` | `numeric(3,1)` NULL | 1–10, half-point granularity |
| `rir` | `smallint` NULL | Reps in reserve |
| `is_completed` | `boolean` NOT NULL DEFAULT true | False = planned but not performed |
| `estimated_1rm_kg` | `numeric(8,3)` NULL | Derived on write; see e1RM below |
| `notes` | `text` NULL | |
| `performed_at` | `timestamptz` NULL | Falls back to the workout's start |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

Indexes: unique `idx_workout_sets_index` on `(workout_exercise_id, set_index)`,
`idx_workout_sets_e1rm` on `(workout_exercise_id, estimated_1rm_kg DESC)`.

**Assisted movements use negative `weight_kg`.** An assisted pull-up at −20 kg is 20 kg of assistance;
this keeps progression monotonic (−20 → −10 → 0 → +10 is a single ascending series) rather than
requiring a separate `assistance_kg` column that every query would have to special-case.

### `public.personal_records`

Derived and append-only. Never edited by hand.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `exercise_id` | `uuid` NOT NULL | |
| `metric` | `pr_metric_enum` NOT NULL | `max_weight` \| `estimated_1rm` \| `max_reps` \| `max_volume_set` \| `max_duration` \| `max_distance` |
| `value` | `numeric(12,3)` NOT NULL | In the canonical unit for the metric |
| `rep_bracket` | `smallint` NULL | For `max_weight`: the rep count it was achieved at |
| `workout_set_id` | `uuid` NOT NULL | The set that achieved it |
| `achieved_at` | `timestamptz` NOT NULL | |
| `superseded_at` | `timestamptz` NULL | `NULL` = current record |

Indexes: `idx_prs_current` on `(user_id, exercise_id, metric) WHERE superseded_at IS NULL`.

Records are superseded rather than replaced, so "when did my squat go from 120 to 130" is a query
rather than a lost fact.

### Enums owned by this spec

`modality_enum`, `metric_enum`, `muscle_enum`, `set_type_enum`, `side_enum`, `pr_metric_enum`.

## Derived Metrics

### Estimated 1RM

Computed on every set write where `weight_kg` and `reps` are both present, `set_type` is not
`warmup`, and `reps` ≤ 12. Epley:

```
e1RM = weight × (1 + reps / 30)
```

Above 12 reps the formula's error exceeds its usefulness, so `estimated_1rm_kg` is left `NULL` rather
than stored wrong. A single rep returns the weight unchanged.

Epley is chosen over Brzycki and Lombardi for one reason: it is the one most lifters have seen, so
the number the app shows matches the number they already believe. Accuracy across formulas is within
noise at the rep ranges that matter; familiarity is not.

### Volume

Per working set: `weight_kg × reps`. For bodyweight movements where `weight_kg` is `NULL`, the
service substitutes `bodyweight_factor × ` the user's most recent bodyweight sample within 30 days,
falling back to excluding the set from volume if no bodyweight is known. Volume for duration- and
distance-only movements is undefined and reported as such rather than as zero.

Warmup sets are excluded. Drop and backoff sets are included — they are real work.

### Progression signals

Read models the dashboard and agent share, defined here and implemented once:

| Signal | Definition |
| --- | --- |
| Weekly volume | Σ volume over working sets, grouped by `local_date` truncated to the user's week start |
| Weekly hard sets | Count of working sets with `rpe ≥ 7` or `rir ≤ 3`, per muscle group |
| e1RM trend | Best `estimated_1rm_kg` per exercise per week, over a rolling window |
| Frequency | Distinct `local_date` values per exercise or muscle group per week |
| Staleness | Days since the last working set for an exercise trained at least 3 times historically |

Volume is grouped by muscle group using `primary_muscle` at full weight and each entry in
`secondary_muscles` at half. Splitting a bench press evenly across chest, shoulders, and triceps
overstates the last two; ignoring them entirely understates them. Half is a convention, stated here
so it is consistent everywhere rather than reinvented per query.

## User Roles & Permissions

Per `specs/ARCHITECTURE.md` § Security Model. Specific to this spec:

| Action | System exercise | Own exercise | Own workout |
| --- | --- | --- | --- |
| Read | Yes | Yes | Yes |
| Create | No (403) | Yes | Yes |
| Update | No (403) | Yes | Yes |
| Delete | No (403) | Yes, if unreferenced | Yes |

A user exercise referenced by any non-deleted set cannot be hard-deleted; it is soft-deleted and
disappears from pickers while remaining resolvable for historical rows.

## User Flows

### Flow 1: Log a workout live

1. The user starts a session. A `workouts` row is created with `started_at = now()`, `ended_at NULL`,
   and `local_date` computed in their timezone.
2. They add an exercise, creating a `workout_exercises` row at the next `position`.
3. Each completed set writes a `workout_sets` row. `set_index` is assigned server-side from the
   current maximum, so two rapid submissions cannot collide on the unique constraint.
4. On write, the service computes `estimated_1rm_kg` and re-evaluates personal records for that
   exercise (Flow 4).
5. Ending the session sets `ended_at`. A session left open is auto-closed by a nightly job at its
   last set's `performed_at`, because a session that was never explicitly ended is a session someone
   walked away from.

### Flow 2: Log a workout after the fact

Identical to Flow 1 except `started_at` is user-supplied and `local_date` derives from it. This is
the path the agent uses — "yesterday I squatted 5x5 at 100" resolves to a backdated workout. The
agent never invents an `ended_at` it was not told.

### Flow 3: Repeat a previous session

1. The user picks a prior workout as a template.
2. Its exercises and set structure are copied; weights are prefilled from the prior session; reps
   are prefilled but explicitly marked unconfirmed.
3. Nothing is written until the first set is confirmed. A template that is opened and abandoned
   leaves no row — otherwise the log fills with empty sessions that distort frequency counts.

### Flow 4: Personal record evaluation

Triggered on every insert, update, or soft-delete of a set.

1. The affected `(user_id, exercise_id)` pair is recomputed for each applicable metric.
2. The new best is compared against the current record (`superseded_at IS NULL`).
3. If it exceeds it, the old row is superseded and a new row is inserted.
4. **If the recomputed best is lower than the current record** — the set that held it was deleted or
   corrected downward — the current record is superseded and the true best is inserted in its place.

Step 4 is the reason records are derived rather than flagged on the set. A `is_pr` boolean set at
write time is correct only until the underlying set is edited, and then it is permanently wrong with
no mechanism to notice.

`max_weight` records are bracketed by rep count: a 140 kg single and a 120 kg triple are both
records, and collapsing them into one loses the distinction every lifter actually tracks.

### Flow 5: Correcting a set

1. The user edits weight, reps, or set type.
2. The service revalidates against the exercise's `metrics`, recomputes e1RM, and re-runs Flow 4.
3. If the edit came from the agent, an `agent_actions` row records before and after state
   (see `specs/agent/FEATURE_SPEC.md`), making it reversible.

### Flow 6: Creating a custom exercise

1. The user supplies a name; `slug` is normalized from it (lowercased, non-alphanumerics to hyphens,
   collapsed, trimmed, truncated to 120).
2. The slug is checked against the user's non-deleted exercises. System slugs are **not** part of
   that uniqueness domain — a user may define "Barbell Back Squat" that shadows the system one, and
   their row wins in name resolution.
3. `metrics` defaults from `modality`; the user may adjust.

Name resolution for the agent orders `user_id ASC NULLS LAST`, so the user's own definition takes
precedence over the system catalog of the same name.

## API Surface

Mutations are Server Actions; the agent reaches the same functions through its tool registry. Read
models are server components and a shared query module.

| Action | Purpose | Notable failures |
| --- | --- | --- |
| `startWorkout(input)` | Create an in-progress session | — |
| `endWorkout(id)` | Set `ended_at` | 404 if not the caller's |
| `addWorkoutExercise(workoutId, exerciseId)` | Append at next position | 404, 400 on a deleted exercise |
| `logSet(workoutExerciseId, set)` | Insert a set, derive e1RM, re-evaluate PRs | 400 on a metric the exercise does not declare |
| `updateSet(id, patch)` | Edit and re-derive | 404, 400 |
| `deleteSet(id)` | Soft-delete and re-derive | 404 |
| `reorderExercises(workoutId, order)` | Rewrite positions in one transaction | 400 if the set of ids differs |
| `createExercise(input)` | Custom catalog entry | 400 on slug collision |
| `getTrainingSummary(range, filters)` | Progression signals | — |

## Invariants

1. A set populates only metrics declared by its exercise's `metrics` array.
2. `set_index` is contiguous from 1 within a workout exercise; deleting a middle set renumbers the
   remainder in the same transaction.
3. `estimated_1rm_kg` is non-null exactly when `weight_kg` and `reps` are present, `reps ≤ 12`, and
   `set_type <> 'warmup'`.
4. `personal_records` is fully reproducible from `workout_sets`; a rebuild from scratch produces an
   identical current-record set.
5. At most one `personal_records` row per `(user_id, exercise_id, metric, rep_bracket)` has
   `superseded_at IS NULL`.
6. A set belonging to a unilateral exercise has a non-null `side`.
7. Warmup sets contribute to no derived metric.
8. `workouts.local_date` is consistent with `started_at` under the timezone in force at creation, and
   is not rewritten thereafter.
9. System exercises (`user_id IS NULL`) are immutable through every write path.

## Key Design Decisions

**Sparse set rows over per-modality tables.** Separate `strength_sets` and `cardio_sets` tables would
make each row dense, and would make "everything I did on Tuesday" a union query that every read model
has to remember to write. One table with a declared metric set keeps reads simple and pushes the
validation into one place.

**Derived PRs, not a flag on the set.** An `is_pr` column is write-time-correct and edit-time-wrong.
Deriving records means a corrected typo demotes a record that was never real — which is the entire
reason to track records at all.

**Negative weight for assisted work.** One column, one ordering, no special cases in progression
queries. The UI renders "−20 kg" as "20 kg assistance".

**Half-weight for secondary muscles.** Any weighting is a convention. Stating it once, here, is what
keeps two different queries from silently disagreeing about how much a bench press trains triceps.

**`bodyweight_factor` instead of zero-volume calisthenics.** Multiplying by a factor and the user's
recent bodyweight is approximate; reporting zero is precisely wrong. The approximation is flagged in
the UI where it materially affects a total.

## Observability

- `workout_logged_total{source}`
- `set_logged_total{source, set_type}`
- `pr_evaluated_total{outcome=new|superseded_down|unchanged}` — `superseded_down` should be rare and
  always corresponds to an edit or deletion
- `exercise_resolution_total{outcome=exact|alias|fuzzy|created|failed}` — the agent's hit rate
- `workout_autoclosed_total` — a high rate means the end-session affordance is not discoverable

## Implementation Notes

### Module responsibilities

| Unit | Responsibility |
| --- | --- |
| Exercise catalog service | CRUD, slug normalization, shadowing rules |
| Exercise resolver | Name/alias → exercise id, user rows before system rows |
| Workout service | Session lifecycle, ordering, auto-close |
| Set service | Validation against `metrics`, e1RM, index management |
| PR engine | Flow 4, including downward supersession and full rebuild |
| Volume calculator | Working-set volume, bodyweight substitution, muscle weighting |
| Training read models | Progression signals shared by dashboard and agent |
| System exercise seed | The starting catalog, versioned in the repo |

### Seed catalog

System exercises ship as a versioned file in the repo and load via migration, one row per movement
with a hardcoded UUID — the same pattern `specs/skills/FEATURE_SPEC.md` uses for system skills, for
the same reason: the id must be stable across environments so user data referencing it survives a
reseed. The initial catalog covers the main barbell lifts, common dumbbell and machine accessories,
bodyweight basics, and a small set of cardio modalities. It is deliberately small; the agent creates
what is missing and the user's own rows are authoritative.

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `E1RM_MAX_REPS` | 12 | e1RM derivation |
| `BODYWEIGHT_LOOKBACK_DAYS` | 30 | Volume substitution |
| `SECONDARY_MUSCLE_WEIGHT` | 0.5 | Muscle-group volume |
| `HARD_SET_RPE_THRESHOLD` | 7 | Weekly hard sets |
| `WORKOUT_AUTOCLOSE_HOURS` | 12 | Nightly auto-close job |
| `STALENESS_MIN_HISTORY` | 3 | Staleness signal |

## Authors

- Claude (spec generation)
