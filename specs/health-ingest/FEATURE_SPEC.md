# Health Ingest Specification

> Purpose: This document specifies how health data from outside the application enters it — the Apple
> Health `export.zip` pipeline that is implemented, the direct sample-push API reserved for a future
> first-party iOS app, the deduplication that makes re-importing safe, and the rollups that make
> hundreds of thousands of samples queryable. See `specs/ARCHITECTURE.md` for units, time, ownership,
> and provenance conventions.

## Overview

HealthKit has no cloud API. Apple exposes health data to on-device apps only, and the sole way to get
it off a phone without shipping an iOS app is the Health app's own export — a ZIP containing an XML
document of every sample ever recorded. That file is the input this spec is built around.

Two properties of it drive nearly every decision here:

**It is very large.** `export.xml` routinely runs 500 MB to 2 GB uncompressed, with hundreds of
thousands to millions of `<Record>` elements. It cannot be buffered, cannot be DOM-parsed, and cannot
be processed inside an HTTP request.

**It has no stable identifiers.** Apple's export format does not emit the underlying `HKObject`
UUIDs. A record carries only `type`, `sourceName`, `sourceVersion`, `device`, `unit`, `creationDate`,
`startDate`, `endDate`, and `value`. Since every export is a full export — not a delta — importing
twice would duplicate everything unless identity is derived from content.

The pipeline is therefore: upload → durable job → stream-unzip → stream-parse → normalize → dedupe by
content hash → batch insert → recompute rollups. The same pipeline, from the normalize step onward,
serves the direct push API when the iOS app exists. That is the point of specifying the stub now: the
app becomes a new *producer*, not a new pipeline.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Import** | Import | `ingest_batches` row | One upload or push and everything derived from it |
| **Sample** | Data point | `health_samples` row | One measurement over an instant or interval |
| **Quantity sample** | — | `value_num` populated | A numeric measurement: heart rate, steps, mass |
| **Category sample** | — | `value_text` populated | An enumerated state: a sleep stage, a mindful minute |
| **Type** | Metric | `health_samples.type` | The normalized metric key, e.g. `resting_heart_rate` |
| **Dedupe key** | — | `dedupe_hash` | Content-derived identity, used when no source UUID exists |
| **Rollup** | — | `health_daily` row | A per-day aggregate of one type |
| **Sleep session** | Sleep | `sleep_sessions` row | Contiguous sleep assembled from stage samples |

## Conceptual Layers

```
Producers                 Pipeline                        Store              Consumers
---------                 --------                        -----              ---------
export.zip upload  ──┐                                     health_samples ──▶ charts
                     ├──▶ stage ──▶ parse ──▶ normalize ──▶ (dedupe)      ──▶ agent tools
iOS app (stubbed)  ──┘      │         │          │          health_daily  ──▶ analysis jobs
                            │         │          │          sleep_sessions
                            ▼         ▼          ▼
                       object      streaming   unit +
                       storage     SAX/JSON    type map
```

Producers differ only in how they reach the normalize step. A ZIP arrives as a file and is parsed;
the API arrives as JSON and is validated. Everything after normalization — dedupe, insert, rollup —
is shared code.

## Data Model

### `public.ingest_batches`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `source` | `source_enum` NOT NULL | `import` for ZIP, `native_api` for push |
| `producer` | `varchar(80)` NOT NULL | `apple_health_zip` \| `tricky_ios` \| `claude_chat_export` (see `specs/chat-import/FEATURE_SPEC.md`) |
| `status` | `batch_status_enum` NOT NULL | `pending` \| `staging` \| `parsing` \| `completed` \| `partial` \| `failed` |
| `storage_path` | `varchar(1024)` NULL | `imports/<userId>/<batchId>/export.zip`; null for API pushes |
| `file_bytes` | `bigint` NULL | |
| `stats` | `jsonb` NOT NULL DEFAULT `'{}'` | Counts per type, inserted vs skipped, timings |
| `error` | `text` NULL | |
| `observed_from` / `observed_to` | `timestamptz` NULL | Range covered by the batch |
| `started_at` / `finished_at` | `timestamptz` NULL | |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `idx_ingest_batches_user` on `(user_id, created_at DESC)`.

`partial` is a first-class terminal status, not a variant of failure. A 2 GB export with a few
thousand malformed records should import the millions that are fine and report what it skipped.

### `public.health_samples`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `type` | `varchar(64)` NOT NULL | Normalized key, not the HealthKit identifier |
| `value_num` | `numeric(14,4)` NULL | Quantity samples |
| `value_text` | `varchar(64)` NULL | Category samples |
| `unit` | `varchar(24)` NOT NULL | Canonical unit for the type |
| `started_at` | `timestamptz` NOT NULL | |
| `ended_at` | `timestamptz` NOT NULL | Equals `started_at` for instantaneous samples |
| `local_date` | `date` NOT NULL | From the record's own UTC offset — see below |
| `source_name` | `varchar(160)` NULL | Untrusted: app- or device-supplied |
| `source_device` | `varchar(200)` NULL | Untrusted |
| `external_uuid` | `uuid` NULL | Populated only by the native API |
| `dedupe_hash` | `bytea` NOT NULL | See Deduplication |
| `ingest_batch_id` | `uuid` NOT NULL | |
| `source` | `source_enum` NOT NULL | |
| `created_at` | `timestamptz` | |

Indexes:
- unique `idx_health_samples_uuid` on `(user_id, external_uuid) WHERE external_uuid IS NOT NULL`
- unique `idx_health_samples_dedupe` on `(user_id, dedupe_hash)`
- `idx_health_samples_query` on `(user_id, type, started_at DESC)`
- BRIN on `started_at` — the table is append-mostly and time-ordered, and BRIN costs almost nothing
  at this row count

No `updated_at` and no `deleted_at`: samples are immutable facts. A correction is a new batch.

**`local_date` comes from the record, not from the user's current timezone.** This is the one place
that departs from the `specs/ARCHITECTURE.md` default, and the export makes it possible: Apple writes
dates as `2024-03-14 07:42:11 +0100`, carrying the offset in force where and when the sample was
recorded. Using it means a run in Tokyo is filed under the Tokyo day it happened on, which is both
more accurate than the user's current zone and stable under later preference changes.

### `public.health_daily`

Derived, rebuildable, and the table every chart actually reads.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` NOT NULL | Composite PK with the next two |
| `local_date` | `date` NOT NULL | |
| `type` | `varchar(64)` NOT NULL | |
| `sum` / `avg` / `min` / `max` | `numeric(16,4)` NULL | Only those meaningful for the type |
| `count` | `integer` NOT NULL | |
| `first_at` / `last_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` | |

Primary key `(user_id, local_date, type)`.

Which aggregate is meaningful is a property of the type and is declared in the type registry: steps
and active energy sum; heart rate and body mass average; VO2 max takes the maximum. Summing heart
rate is meaningless, and a schema that permits the query invites it.

### `public.sleep_sessions`

Assembled from `sleep_analysis` samples, which arrive as many short interleaved stage intervals
rather than one night.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `started_at` / `ended_at` | `timestamptz` NOT NULL | |
| `local_date` | `date` NOT NULL | The night's *waking* date |
| `in_bed_s` / `asleep_s` / `deep_s` / `rem_s` / `core_s` / `awake_s` | `integer` NOT NULL | |
| `efficiency` | `numeric(4,3)` NULL | `asleep_s / in_bed_s` |
| `interruptions` | `smallint` NOT NULL | Awake intervals within the session |
| `source_name` | `varchar(160)` NULL | |
| `ingest_batch_id` | `uuid` NOT NULL | |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: unique `idx_sleep_sessions_night` on `(user_id, local_date)`, `idx_sleep_sessions_range`
on `(user_id, started_at)`.

A session is filed under the date the user woke, which is what people mean by "how did I sleep
Tuesday night". Sessions are separated by a gap exceeding `SLEEP_SESSION_GAP_MINUTES`.

### Enums owned by this spec

`batch_status_enum`.

## Type Registry

HealthKit identifiers are long, versioned, and inconsistent in units. The registry maps them to
normalized keys and canonical units, and is the only place that knowledge lives.

| HealthKit identifier | `type` | Canonical unit | Daily aggregate |
| --- | --- | --- | --- |
| `HKQuantityTypeIdentifierStepCount` | `steps` | `count` | sum |
| `HKQuantityTypeIdentifierActiveEnergyBurned` | `active_energy` | `kcal` | sum |
| `HKQuantityTypeIdentifierBasalEnergyBurned` | `basal_energy` | `kcal` | sum |
| `HKQuantityTypeIdentifierHeartRate` | `heart_rate` | `bpm` | avg, min, max |
| `HKQuantityTypeIdentifierRestingHeartRate` | `resting_heart_rate` | `bpm` | avg |
| `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | `hrv_sdnn` | `ms` | avg |
| `HKQuantityTypeIdentifierBodyMass` | `body_mass` | `kg` | avg |
| `HKQuantityTypeIdentifierBodyFatPercentage` | `body_fat_pct` | `pct` | avg |
| `HKQuantityTypeIdentifierLeanBodyMass` | `lean_body_mass` | `kg` | avg |
| `HKQuantityTypeIdentifierVO2Max` | `vo2_max` | `ml/kg/min` | max |
| `HKQuantityTypeIdentifierRespiratoryRate` | `respiratory_rate` | `bpm` | avg |
| `HKQuantityTypeIdentifierOxygenSaturation` | `spo2` | `pct` | avg, min |
| `HKQuantityTypeIdentifierAppleExerciseTime` | `exercise_minutes` | `min` | sum |
| `HKQuantityTypeIdentifierDistanceWalkingRunning` | `distance_walk_run` | `m` | sum |
| `HKCategoryTypeIdentifierSleepAnalysis` | `sleep_analysis` | `state` | — (feeds `sleep_sessions`) |
| `HKCategoryTypeIdentifierMindfulSession` | `mindful_session` | `s` | sum |

Unmapped types are **not** an error. They are counted in `stats.unmapped` with their identifier and
occurrence count, and skipped. Apple adds types with every OS release, and an import that fails on an
unknown metric is an import that breaks annually. The counter is how new types get noticed and added.

Units are converted to canonical on normalization: pounds to kilograms, miles to metres, kJ to kcal.
The export's `unit` attribute is authoritative for what the source meant; it is never assumed.

## Deduplication

**ZIP records have no UUIDs**, so identity is derived from content:

```
dedupe_hash = sha256(
  type ‖ started_at(ms) ‖ ended_at(ms) ‖ value ‖ unit ‖ source_name ‖ source_device
)
```

stored as `bytea` under a unique index on `(user_id, dedupe_hash)`. Inserts use
`ON CONFLICT DO NOTHING`, so re-importing an overlapping export inserts only what is new. The
`stats.skipped_duplicate` count on a second import of the same file equals the first import's insert
count — that identity is the pipeline's integration test.

`source_device` is in the hash deliberately. The same heart-rate reading recorded by both a Watch and
a paired chest strap is two genuine observations, and collapsing them would silently drop data from
whichever device the user later relies on.

The native API path is different: HealthKit's `HKObject.uuid` **is** available on-device, so pushed
samples carry `external_uuid`, deduplicate on it, and still compute `dedupe_hash` so that a sample
arriving by both routes is stored once.

## Processing the Export

### Why this cannot run on serverless

A 2 GB stream, minutes of CPU, and hundreds of thousands of inserts exceed both the execution time
limit and the ephemeral disk of a typical serverless function. The ingest worker therefore runs as a
**long-lived container** (Fly.io or Railway) that Inngest invokes; the Next.js app only accepts the
upload and enqueues. This is the one component that does not deploy to Vercel, and pretending
otherwise would mean discovering it during Phase 3 with the schema already built around the wrong
assumption.

### Pipeline stages

1. **Stage.** The upload is streamed to `imports/<userId>/<batchId>/export.zip`. Nothing is parsed in
   the request. Status → `staging`.
2. **Locate.** The worker opens the ZIP central directory and locates
   `apple_health_export/export.xml`. Other entries — `export_cda.xml`, `workout-routes/`,
   `electrocardiograms/` — are recorded in `stats` and skipped in this version.
3. **Parse.** A SAX parser consumes the entry stream. `<Record>`, `<Workout>`, and
   `<ActivitySummary>` are handled; everything else is counted and ignored. Nothing accumulates in
   memory beyond the current batch buffer.
4. **Normalize.** Per record: map the type, convert the unit, parse the date with its offset, derive
   `local_date`, compute `dedupe_hash`. Unmapped or malformed records increment counters and are
   dropped.
5. **Insert.** Buffered to `INGEST_BATCH_ROWS` and inserted with `ON CONFLICT DO NOTHING`.
6. **Assemble.** Sleep samples in the batch's range are grouped into `sleep_sessions`; `<Workout>`
   elements are converted to `workouts` per `specs/training/FEATURE_SPEC.md`, deduplicated on
   `(user_id, source, external_id)`.
7. **Roll up.** `health_daily` is recomputed for every `(type, local_date)` the batch touched — not
   the whole history.
8. **Finish.** Status → `completed` or `partial`, with `stats` populated. The ZIP is retained so a
   pipeline fix can reprocess without asking the user to export again.

Each stage is an Inngest step, so a failure resumes from the last completed stage rather than
restarting a 40-minute parse.

### Imported workouts

`<Workout>` elements become `workouts` rows with `source = 'import'` and an `external_id` derived from
the same content-hash approach. They carry duration, energy, and distance, but **no set-level
detail** — HealthKit does not record it. An imported strength session is a container the user or the
agent can fill in later, and the UI distinguishes it from a logged one rather than implying the data
is there.

## The Native API Stub

Specified and routed now; returning `501 Not Implemented` until the iOS app exists.

```
POST /api/v1/ingest/samples
Authorization: Bearer <device token>
{
  "producer": "tricky_ios",
  "batch_id": "<client-generated uuid, idempotency key>",
  "samples": [
    { "uuid": "...", "type": "HKQuantityTypeIdentifierHeartRate",
      "value": 62, "unit": "count/min",
      "start": "2026-09-12T07:42:11+02:00", "end": "2026-09-12T07:42:11+02:00",
      "source_name": "Apple Watch", "source_device": "Watch7,1" }
  ]
}
```

Contract fixed now:

- `batch_id` is an idempotency key. Re-posting the same `batch_id` returns the original result.
- `uuid` is `HKObject.uuid`, and is required — it is the advantage this path has over the ZIP.
- Samples use HealthKit identifiers and HealthKit units; the same type registry normalizes them.
- ≤ `MAX_SAMPLES_PER_PUSH` per request; the client pages.
- Device tokens are per-device, revocable, and scoped to this endpoint alone.

Stubbing it rather than deferring it is what keeps the schema honest: `external_uuid`, `producer`, and
the `native_api` source value exist from the first migration, so the iOS app is additive rather than
a migration.

## User Roles & Permissions

Per `specs/ARCHITECTURE.md`. Imports and samples are strictly user-owned with no catalog tier. A
batch belonging to another user is 404.

## User Flows

### Flow 1: Import an export

1. The user exports from the iOS Health app (profile → Export All Health Data) and uploads the ZIP.
2. A batch is created, the file is staged, the job is enqueued, and the UI shows progress by stage.
3. On completion the user sees inserted, skipped-duplicate, unmapped, and malformed counts, plus the
   date range covered.
4. Charts populate from `health_daily`.

### Flow 2: Re-import

Identical. The dedupe index absorbs everything already present. A monthly re-export is the intended
sync mechanism until the iOS app exists, and the UI says so on the import screen rather than leaving
the user to wonder whether re-importing is safe.

### Flow 3: Delete an import

1. The user deletes a batch.
2. Samples with that `ingest_batch_id` are hard-deleted, affected `health_daily` rows and
   `sleep_sessions` are recomputed, and the storage object is removed.

Hard deletion is correct here: these are re-importable facts, not authored content, and a soft-delete
tombstone for two million rows costs more than it protects.

### Flow 4: Manual measurement

Bodyweight and body-fat entered by hand write `health_samples` with `source = 'manual'`,
`source_name = 'tricky.ai'`, and no batch. They participate in rollups identically, which is what
lets `specs/training/FEATURE_SPEC.md`'s bodyweight-volume substitution work before any import exists.

## API Surface

| Method | Path / Action | Purpose | Notable codes |
| --- | --- | --- | --- |
| `POST` | `/api/v1/imports` | Stage a ZIP, create a batch, enqueue | 201, 400 (not a ZIP), 413 |
| `GET` | `getImportStatus(batchId)` | Stage and counts | 404 |
| `DELETE` | `deleteImport(batchId)` | Flow 3 | 404 |
| `POST` | `/api/v1/ingest/samples` | Native push | **501 until implemented** |
| — | `queryMetrics(type, from, to, agg)` | Rollup read model, agent-facing | 400 on an unregistered type |
| — | `logMeasurement(type, value, at)` | Flow 4 | 400 |

## Invariants

1. No request handler parses an export. Parsing happens only in the durable worker.
2. Every sample has a `dedupe_hash`, and `(user_id, dedupe_hash)` is unique.
3. Re-importing a previously imported file inserts zero rows.
4. Samples are immutable: no update path exists, and correction is re-import.
5. `local_date` derives from the sample's own UTC offset where the producer supplies one.
6. Stored values are in the type registry's canonical unit; the source unit is converted, never
   assumed.
7. An unmapped HealthKit type is counted and skipped, never a failure.
8. `health_daily` and `sleep_sessions` are fully reproducible from `health_samples`.
9. Rollup recomputation is scoped to the `(type, local_date)` pairs a batch touched.
10. `source_name` and `source_device` are untrusted text and are fenced wherever they reach the model.

## Key Design Decisions

**Content-hash identity.** Forced by the export format, which omits UUIDs. The hash composition —
including `source_device` — is a deliberate choice to preserve genuinely independent observations
from different devices while collapsing true duplicates.

**A dedicated worker, not a serverless function.** Stated plainly because the alternative fails only
at full data volume, which is exactly when it matters and exactly when it is most expensive to
rediscover.

**Rollups as a table, not a view.** A materialized view would need full refreshes or complex
incremental logic. A table scoped to touched days keeps import cost proportional to what changed
rather than to history size.

**Samples are immutable and hard-deleted.** They are reproducible from a file the system still holds.
Immutability removes an entire class of concurrency problem from the highest-volume table.

**`partial` as a terminal status.** A single malformed record in two million must not discard the
import. Reporting what was skipped, with counts by reason, is more useful than an all-or-nothing
outcome.

**Sleep sessions assembled at ingest, not at query.** Stage stitching is expensive and stable;
computing it per chart render would dominate dashboard latency for data that never changes.

## Observability

- `ingest_batch_total{producer, status}`
- `ingest_duration_ms{stage}` — stage-level, so a slowdown localizes
- `ingest_samples_total{type, outcome=inserted|duplicate|unmapped|malformed}`
- `ingest_unmapped_type_total{identifier}` — the queue of types to add to the registry
- `rollup_recompute_duration_ms`, `rollup_rows_affected`
- `sleep_session_assembled_total`

Failures report at `warning` with `batchId`, stage, and counts; only worker crashes report at `error`.
A `partial` outcome logs the per-reason breakdown rather than one aggregate number.

## Implementation Notes

### Module responsibilities

| Unit | Responsibility |
| --- | --- |
| Upload handler | Stream to storage, create batch, enqueue; parses nothing |
| Ingest worker | Long-lived container running the staged pipeline |
| ZIP reader | Locate and stream one entry without full extraction |
| XML stream parser | SAX over `<Record>`, `<Workout>`, `<ActivitySummary>` |
| Type registry | Identifier → key, unit conversion, aggregate declaration |
| Normalizer | Registry application, offset-aware dates, `dedupe_hash` |
| Sample writer | Batched conflict-tolerant insert |
| Sleep assembler | Stage samples → sessions |
| Workout importer | `<Workout>` → `workouts` |
| Rollup engine | Scoped `health_daily` recomputation |
| Native ingest route | Stub, contract, device-token auth |

### Deployment note

The ingest worker is the only component outside Vercel. It needs ≥ 2 GB RAM, ephemeral disk at least
twice the largest expected export, and no request timeout. Inngest triggers it and tracks step
completion.

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `MAX_IMPORT_SIZE_BYTES` | 2 GB | Upload handler |
| `INGEST_BATCH_ROWS` | 5000 | Sample writer |
| `SLEEP_SESSION_GAP_MINUTES` | 45 | Sleep assembler |
| `MAX_SAMPLES_PER_PUSH` | 5000 | Native ingest route |
| `IMPORT_RETENTION_DAYS` | 180 | Staged ZIP retention |
| `ROLLUP_CHUNK_DAYS` | 90 | Rollup batching |

## Authors

- Claude (spec generation)
