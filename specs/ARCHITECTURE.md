# Architecture

> Purpose: This document defines the system shape, the technology choices, and the conventions that
> every feature spec in `specs/` builds on. Where another spec is silent on units, time, identity,
> auditing, or error semantics, the rule here applies. Conventions are stated once here and
> referenced, never restated.

## Overview

tricky.ai is a personal training, nutrition, and health log with a Claude agent as its primary input
surface. The motivating problem: logging food and training into a chat is effortless and produces
nothing durable — no trends, no personal records, no way to ask whether a bad week of sleep tracked a
stalled lift. The fix is to keep the chat and put a database under it.

Three input surfaces write to one store:

1. **Conversational** — the agent parses "chicken and rice, about 200g rice" or "squat 5x5 at 100"
   into structured rows, and every mutation it makes is auditable and reversible.
2. **Manual UI** — forms and a day view, for correcting the agent and for logging where typing prose
   is slower than tapping.
3. **Import** — Apple Health `export.zip`, streamed and deduplicated into a sample store, with the
   same pipeline reserved for a future first-party iOS app.

Reads fan out to a dashboard, and to an analysis sandbox for questions no endpoint anticipated.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Entry** | Log entry | any `source`-carrying row | A user-owned fact: a set, a meal item, a health sample |
| **Source** | — | `source` enum | How an entry came to exist: `manual`, `agent`, `import`, `native_api` |
| **Sample** | Health data point | `health_samples` row | One HealthKit-shaped measurement over an instant or interval |
| **Rollup** | — | `health_daily` row | A per-day aggregate of samples of one type |
| **Batch** | Import | `ingest_batches` row | One upload or push, and everything derived from it |
| **Action** | — | `agent_actions` row | One reversible mutation performed by the agent |
| **Job** | Analysis | `analysis_jobs` row | One sandboxed computation over a scoped data export |
| **Skill** | Skill | `skills` row | A bundle of agent-facing knowledge, rooted at `SKILL.md` |

## Conceptual Layers

```
Input                    Service layer            Store                   Read
-----                    -------------            -----                   ----
chat (agent tools) ──┐
manual UI          ──┼──▶  domain services  ──▶  Postgres (RLS)   ──▶  dashboard
export.zip upload  ──┤     (the only writer)     Storage (files)  ──▶  analysis sandbox
native app (stub)  ──┘                                                 ──▶  agent reads
```

The **service layer is the only writer**. Agent tools, route handlers, and ingest workers all call
the same functions — an agent-logged set and a hand-logged set take an identical path, differing only
in the `source` they pass. This is what keeps the two input surfaces from drifting apart, and it is
why Phase 2 (agent) depends on Phase 1 (manual core) rather than running beside it.

## Technology

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 15, App Router, React Server Components | Server Actions for mutations, route handlers for the agent stream and ingest |
| Language | TypeScript, `strict: true` | `noUncheckedIndexedAccess` on |
| Runtime | Node 22 LTS | Pinned in `.nvmrc` and `package.json#engines` |
| Database | Postgres 16 (Supabase) | Row-level security on every user table |
| Schema & queries | Drizzle ORM | Drizzle owns migrations; Supabase's data client is not used |
| Auth | Supabase Auth | Session → `user_id`, read server-side only |
| Object storage | Supabase Storage | One bucket, prefixed by kind |
| Background jobs | Inngest | Durable steps, retries, concurrency limits; survives Vercel's request timeout |
| UI | Tailwind + shadcn/ui | |
| Charts | Recharts | |
| LLM | `@anthropic-ai/sdk`, `claude-opus-5` | Adaptive thinking; tool runner; see `specs/agent/FEATURE_SPEC.md` |
| Sandbox | e2b | Analysis jobs only; see `specs/analysis-sandbox/FEATURE_SPEC.md` |

### Why background jobs are not optional

An Apple Health `export.zip` contains an `export.xml` that routinely runs 500 MB to 2 GB
uncompressed, holding hundreds of thousands of samples. This cannot be parsed inside a request: it
exceeds the serverless execution limit, and buffering it exceeds the memory limit. Ingest is
therefore a durable job that streams from object storage, and the upload endpoint's only
responsibility is to store the file and enqueue.

### Storage layout

```
<bucket>/
  imports/<userId>/<batchId>/export.zip     # raw uploads, retained for reprocessing
  artifacts/<userId>/<jobId>/<name>         # charts and files produced by analysis jobs
  skills/<userId|system>/<skillId>/         # skill bundles
```

## Data Conventions

These apply to every table in every spec.

**Identity.** UUIDv7 primary keys — time-ordered, so they index well and sort chronologically without
a second column. Generated in the application, not the database, so a service can build an object
graph before its first write.

**Time.** Every timestamp is `timestamptz`, stored in UTC. Where a day boundary carries meaning —
daily calorie totals, training volume per day, health rollups — the row *also* carries a
`local_date date` computed from the user's timezone at write time. A meal logged at 23:40 belongs to
that day as the user lived it, and a meal logged at 00:20 belongs to the next one; deriving this at
read time from UTC gets it wrong for anyone not on UTC, and gets it wrong retroactively for everyone
when they travel.

**Units.** The database stores one canonical unit per dimension:

| Dimension | Canonical | Never stored |
| --- | --- | --- |
| Mass (load, bodyweight) | kilograms, `numeric(8,3)` | lb |
| Mass (food) | grams, `numeric(10,3)` | oz |
| Distance | metres | km, miles |
| Duration | seconds | minutes |
| Energy | kilocalories | kJ |

Conversion happens at the presentation edge only, driven by `user_preferences`. Floating-point types
are not used for anything a user will see summed — `numeric` throughout.

`kcal` is not SI, but every food database and every nutrition label in use is denominated in it.
Storing kJ would mean converting on every read and introducing rounding drift into the one number
this product exists to track.

**Ownership.** Every user-owned table carries `user_id uuid NOT NULL` referencing `users(id)` with
`ON DELETE CASCADE`, and has RLS enabled with a policy keyed on the session user. Catalog tables
(`exercises`, `foods`, `skills`) use `user_id uuid NULL`, where `NULL` means system-provided and
readable by everyone but writable by no one through the API. This mirrors the system/custom tiering
in `specs/skills/FEATURE_SPEC.md` and is the only place a nullable `user_id` is permitted.

**Soft delete.** User-visible entities carry `deleted_at timestamptz`. Every normal query filters
`deleted_at IS NULL`. Derived and append-only tables (`health_daily`, `agent_actions`,
`personal_records`) are exempt — they are recomputed or immutable.

**Provenance.** Every entry table carries `source source_enum NOT NULL`
(`manual` | `agent` | `import` | `native_api`). This drives the UI's provenance badges, lets the
agent distinguish what it wrote from what the user did, and makes "delete everything that import
created" expressible.

**Audit columns.** `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT
NULL DEFAULT now()` on every table, `updated_at` maintained by trigger.

## Security Model

**The session is the only source of `user_id`.** It is read server-side from the auth cookie and
passed into the service layer. It never arrives from a request body, a query parameter, or an LLM
tool argument. RLS is the second line, not the first — a service-layer bug should fail closed at the
database rather than being caught only by the database.

**Cross-user access returns 404, never 403.** A user must not be able to probe for the existence of
another user's data. The single exception is system-catalog immutability (editing a system exercise
or skill), which returns 403 because the row is already known to exist. This rule is inherited from
the exemplar spec and holds across every route in every feature spec.

**Untrusted text reaches the model's context.** Three sources carry text this system did not author:

- Open Food Facts product names and ingredient strings are crowd-edited and world-writable.
- Apple Health exports carry `sourceName` and device strings supplied by arbitrary third-party apps.
- The user's own free-text notes, which may contain pasted content.

All three are data, never instructions. Tool results that embed them are fenced and labelled as
untrusted in the result envelope, and the system prompt states that content inside those fences is
never to be followed as a directive. See `specs/agent/FEATURE_SPEC.md` § Prompt Injection Surface.

**Secrets.** `ANTHROPIC_API_KEY`, `E2B_API_KEY`, and database credentials are server-only and never
reach a client bundle. The analysis sandbox receives a scoped data export, never a database
credential — see `specs/analysis-sandbox/FEATURE_SPEC.md`.

## API Surface

Two families, with different conventions:

**Server Actions** handle UI mutations. They are the default: colocated with the components that call
them, typed end to end, no hand-written fetch.

**Route handlers** under `/api/v1/` exist where a non-browser client needs an endpoint or the
response is a stream:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/chat` | Streaming agent turn (SSE) |
| `POST` | `/api/v1/imports` | Accept an `export.zip`, create a batch, enqueue |
| `POST` | `/api/v1/ingest/samples` | Direct sample push — **stub, reserved for the iOS app** |
| `POST` | `/api/v1/inngest` | Inngest webhook |

Errors are `{ error: string, code?: string, validationErrors?: [{ field, message }] }`. Validation
failures carry per-field errors so a form can annotate the offending input.

## Invariants

1. Every write to a user-owned table passes through the service layer; no route handler, agent tool,
   or job writes to a table directly.
2. `user_id` on every write is derived from the session, never from request or model input.
3. Every user-owned table has RLS enabled and a policy keyed on the session user. A table without a
   policy is a migration defect, and CI fails on one.
4. Stored values are always in the canonical unit for their dimension. A value in a non-canonical
   unit never crosses the service-layer boundary.
5. Any row whose day boundary is user-visible carries `local_date`, written at insert time from the
   user's then-current timezone.
6. Cross-user access is reported as 404; system-catalog immutability as 403.
7. Money-like numbers — loads, macros, energy — are `numeric`, never `float`.

## Key Design Decisions

**One service layer, three input surfaces.** The alternative — letting agent tools write their own
SQL — is faster to build and guarantees divergence: validation that exists in one path and not the
other, an agent that can create states the UI cannot represent. Every tool in
`specs/agent/FEATURE_SPEC.md` is a thin wrapper over a function the UI also calls.

**`local_date` stored, not derived.** Denormalizing a date is a real cost: it can disagree with
`created_at` if a timezone changes. The alternative is worse — every daily aggregate becomes a query
that joins user preferences and applies a timezone shift, and historical days silently re-bucket when
the user travels. The stored value records what the user actually experienced.

**Drizzle for data, Supabase for platform.** Using Supabase's client for queries would put row access
logic in two places and make the schema hard to test outside Supabase. Drizzle owns schema,
migrations, and every query; Supabase provides Postgres, Auth, and Storage.

**RLS despite a single user.** For one user, RLS is nearly pointless today. It costs one policy per
table now and is otherwise a retrofit across every query later, at the exact moment the stakes of
getting it wrong become real.

## Observability

- `ingest_batch_total{source, status}`, `ingest_duration_ms`, `ingest_samples_total{type}`
- `agent_turn_total{outcome}`, `agent_turn_duration_ms`, `agent_tool_call_total{tool, status}`
- `agent_cache_read_tokens` / `agent_input_tokens` — the ratio is the prompt-cache health signal
- `analysis_job_total{status}`, `analysis_job_duration_ms`
- `food_resolution_total{method}` — the `llm_estimate` share is the nutrition-quality signal

Errors report to the tracker with `userId`, the owning feature, and the entity id. Ingest and
analysis failures are expected-but-notable and report at `warning`; service-layer failures report at
`error`.

## Implementation Notes

### Module responsibilities

This repo does not implement the system yet. The units below are the proposed decomposition, named by
responsibility rather than by path.

| Unit | Responsibility |
| --- | --- |
| Schema & migrations | Drizzle schema, one module per feature domain |
| Service layer | Domain operations; the only writer; enforces units and `local_date` |
| Unit conversion | Canonical ↔ display, driven by preferences |
| Auth & session | Session → `user_id`; RLS context binding |
| Agent runtime | Tool runner, streaming, message persistence |
| Tool registry | Zod-typed tool definitions wrapping service functions |
| Ingest pipeline | Streaming ZIP/XML parse, dedupe, rollup |
| Rollup engine | `health_samples` → `health_daily`; PR recomputation |
| Analysis runtime | Sandbox lifecycle, data export, artifact capture |
| Food resolution | Text → food rows; USDA and Open Food Facts clients, caching |

### Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Auth and Storage |
| `STORAGE_BUCKET` | Bucket holding imports, artifacts, and skills |
| `ANTHROPIC_API_KEY` | Agent and food parsing |
| `E2B_API_KEY` | Analysis sandbox |
| `USDA_FDC_API_KEY` | Food database |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Background jobs |

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `MAX_IMPORT_SIZE_BYTES` | 2 GB | Import upload |
| `INGEST_BATCH_ROWS` | 5000 | Sample insert batching |
| `AGENT_MAX_ITERATIONS` | 12 | Tool runner loop cap |
| `AGENT_MAX_TOKENS` | 16000 | Agent turn |
| `ANALYSIS_TIMEOUT_MS` | 120000 | Sandbox job |
| `FOOD_CACHE_TTL_DAYS` | 30 | External food lookup cache |

## Authors

- Claude (spec generation)
