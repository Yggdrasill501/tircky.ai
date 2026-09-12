# Analysis Sandbox Specification

> Purpose: This document specifies the sandboxed analysis runtime — how an open-ended question
> becomes generated code running over a scoped export of the user's data, what the sandbox is and is
> not allowed to reach, and how results and artifacts return to the conversation. See
> `specs/agent/FEATURE_SPEC.md` for the `run_analysis` tool contract that enters this pipeline.

## Overview

`specs/insights/FEATURE_SPEC.md` answers questions someone anticipated. This feature answers the rest:
"did my squat stall when my sleep got worse", "what actually predicts a good session for me", "show
me protein against next-day resting heart rate". These cannot be precomputed because they are not
known in advance, and they cannot be answered from a tool result because they need the full series
rather than a summary.

The shape is deliberate. **The model writes code; the sandbox runs it; neither touches the database.**
A job receives a read-only export of exactly the rows its scope declares, written as files into an
isolated container with no network access and no credentials. Analysis code cannot read another
user's data because that data was never placed in the container, and it cannot write to the
application's store because it has no route to one.

Jobs are asynchronous by contract. A two-minute computation cannot happen inside a streaming turn, so
`run_analysis` returns a handle immediately and results arrive in the conversation when they are
ready.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Job** | Analysis | `analysis_jobs` row | One question, its code, its execution, its results |
| **Scope** | — | `scope` jsonb | Which datasets and date range are exported |
| **Export** | — | files in the sandbox | Read-only CSV/Parquet of the scoped rows |
| **Artifact** | Chart / file | `analysis_artifacts` row | A file the job produced |
| **Finding** | Result | `result` jsonb | The structured answer the job returned |
| **Sandbox** | — | e2b container | The isolated execution environment |

## Conceptual Layers

```
Agent                Planner              Sandbox                    Return
-----                -------              -------                    ------
run_analysis   ──▶  scope + code   ──▶  e2b container           ──▶  result + artifacts
(question)          (Claude call)        ├─ /data/*.csv  (RO)    ──▶  system message into
                                         ├─ python + pandas           the conversation
                                         └─ /out/*       (RW)
                                         no network, no secrets
```

## Data Model

### `public.analysis_jobs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `conversation_id` | `uuid` NULL | Where results are delivered |
| `tool_call_id` | `uuid` NULL | The `run_analysis` call that created it |
| `question` | `text` NOT NULL | The user's question, verbatim |
| `scope` | `jsonb` NOT NULL | Datasets, date range, row counts |
| `code` | `text` NULL | The generated program, retained verbatim |
| `status` | `job_status_enum` NOT NULL | `queued` \| `exporting` \| `running` \| `succeeded` \| `failed` \| `timeout` \| `cancelled` |
| `result` | `jsonb` NULL | Structured finding |
| `stdout` / `stderr` | `text` NULL | Truncated to `MAX_OUTPUT_BYTES` |
| `error` | `text` NULL | |
| `attempts` | `smallint` NOT NULL DEFAULT 0 | Self-correction rounds used |
| `sandbox_id` | `varchar(80)` NULL | Provider handle, for correlation |
| `rows_exported` | `integer` NULL | |
| `duration_ms` | `integer` NULL | |
| `started_at` / `finished_at` | `timestamptz` NULL | |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `idx_analysis_jobs_user` on `(user_id, created_at DESC)`,
`idx_analysis_jobs_active` on `(status) WHERE status IN ('queued','exporting','running')`.

`code` is retained verbatim and shown to the user on request. An analysis whose method cannot be
inspected is an assertion, not a finding — and the whole reason to run code rather than let the model
answer from a summary is that the method becomes checkable.

### `public.analysis_artifacts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `job_id` | `uuid` NOT NULL | `ON DELETE CASCADE` |
| `name` | `varchar(160)` NOT NULL | Filename inside `/out` |
| `content_type` | `varchar(80)` NOT NULL | Allowlisted; see below |
| `storage_path` | `varchar(1024)` NOT NULL | `artifacts/<userId>/<jobId>/<name>` |
| `bytes` | `integer` NOT NULL | |
| `created_at` | `timestamptz` | |

### Enums owned by this spec

`job_status_enum`.

## Scope and Export

A scope declares datasets and a date range. The exporter runs the same read models the dashboard
uses, so an analysis and a chart cannot disagree about what a week's volume is.

| Dataset | Source | Exported as |
| --- | --- | --- |
| `workouts` | `workouts` + `workout_exercises` + `workout_sets` | One denormalized row per set |
| `nutrition` | `meals` + `meal_items` | One row per item, with snapshot macros |
| `nutrition_daily` | Daily totals read model | One row per day |
| `health_daily` | `health_daily` | One row per day per type |
| `sleep` | `sleep_sessions` | One row per session |
| `body` | `health_samples` of body types | One row per measurement |
| `targets` | `nutrition_targets` + `user_goals` | Effective periods |

Export rules:

1. **Only the requesting user's rows.** The query is scoped by session `user_id`; there is no code
   path that exports another user's data, because the exporter takes the user id from the job row,
   which took it from the session.
2. **Canonical units**, with a `units.json` manifest naming them. Analysis code never guesses whether
   a column is kilograms or pounds.
3. **`local_date` is the join key** across datasets. Every export carries it, so joining nutrition to
   sleep is a merge on a column rather than a timezone computation the model has to get right.
4. **Free-text columns are excluded by default** — notes, `raw_text`, `source_name`. They are
   untrusted per `specs/ARCHITECTURE.md`, they are rarely what the question needs, and excluding them
   removes the only channel by which injected text could reach generated code.
5. **Row limits.** An export exceeding `MAX_EXPORT_ROWS` narrows its date range and records the
   narrowing in `scope`, so the result reports what it actually covered.

Exports are written as CSV with a Parquet variant for the large ones, plus `schema.json` describing
every column, its unit, and its null semantics.

## Execution

### Container

An e2b sandbox, created per job and destroyed after:

- Python with `pandas`, `numpy`, `scipy`, `statsmodels`, `matplotlib`. No package installation at
  runtime — the image is fixed, so a job cannot pull code from the internet.
- `/data` — the export, mounted read-only.
- `/out` — the only writable path; artifacts are collected from here.
- **No network.** Egress is disabled at the sandbox level.
- **No credentials.** No database URL, no API key, no storage token enters the container.
- CPU, memory, and wall-clock limits per the tuning table.

The security claim rests on the export boundary, not on the generated code behaving. Code that tried
to read another user's data would find no such data, no credential to fetch it, and no network to
fetch it over.

### Lifecycle

1. **Queue.** `run_analysis` writes a `queued` job and returns its id. The turn continues.
2. **Plan.** A Claude call receives the question, the available datasets, and `schema.json`, and
   returns a scope plus a Python program via structured output. The program reads from `/data`,
   writes artifacts to `/out`, and prints one JSON object to stdout as its result.
3. **Export.** Scoped data is written into the sandbox. Status → `exporting`.
4. **Run.** The program executes under the limits. Status → `running`.
5. **Self-correct.** On a non-zero exit, stderr and the program are returned to the model for up to
   `MAX_ATTEMPTS` revisions. A syntax error or a wrong column name should not cost the user their
   question.
6. **Collect.** stdout is parsed as the result; `/out` files are validated against the content-type
   allowlist and uploaded to storage.
7. **Deliver.** A system message carrying the finding and artifact references is appended to the
   conversation, and the agent responds. If the conversation has moved on, the result is still
   appended and surfaced as a notification.
8. **Destroy.** The sandbox is torn down regardless of outcome.

### Result contract

The program prints exactly one JSON object:

```json
{
  "summary": "one or two sentences stating the finding",
  "metrics": { "slope_kg_per_week": -0.31, "r_squared": 0.62, "n": 28 },
  "caveats": ["28 paired days; three weeks had incomplete nutrition logging"],
  "artifacts": ["bodyweight_trend.png"]
}
```

`caveats` is required and must be non-empty when `n` is below the relevant sufficiency threshold from
`specs/insights/FEATURE_SPEC.md`. The planner prompt carries those thresholds, and the sufficiency
discipline the dashboard enforces structurally is enforced here by contract — a sandbox can compute a
correlation over six points, so the requirement to say so travels with the result.

Unparseable stdout is a failure, not a partial success. A job that ran but produced no structured
result has nothing to report.

### Artifact allowlist

`image/png`, `image/svg+xml`, `text/csv`, `application/json`, `text/markdown`. Anything else is
dropped and counted. Artifacts are served from storage with a short-lived signed URL, never inlined.

## User Roles & Permissions

Per `specs/ARCHITECTURE.md`. A job belonging to another user is 404. Concurrency is capped per user
by `MAX_CONCURRENT_JOBS`; further requests queue rather than failing, and the agent is told the job
is queued.

## User Flows

### Flow 1: An open-ended question

1. "Did my squat stall when my sleep got worse?"
2. The agent calls `run_analysis`; a job is queued; the agent says so and the turn ends.
3. The planner scopes `workouts` (squat only), `sleep`, and `health_daily` over twelve months, and
   writes a program joining e1RM per session to the prior night's sleep.
4. It runs, produces a chart and a JSON result.
5. Results are appended; the agent reports the finding with its caveats and the chart.

### Flow 2: The code fails

1. The program raises on a null column.
2. stderr and the program return to the model; a guarded revision runs.
3. Success on attempt two is invisible to the user apart from a slightly longer wait; `attempts` is
   recorded. Exhausting `MAX_ATTEMPTS` fails the job with the last error, and the agent says the
   analysis failed rather than inventing an answer.

### Flow 3: Inspecting the method

The user asks how a number was reached. The job's `code`, scope, and row counts are shown. This is
the difference between a finding and an assertion.

### Flow 4: Cancelling

A queued or running job can be cancelled; the sandbox is destroyed and status → `cancelled`.

## API Surface

| Action | Purpose | Notable codes |
| --- | --- | --- |
| `createAnalysisJob(question, scope?)` | Queue a job (the `run_analysis` tool's implementation) | 429 at the concurrency cap |
| `getAnalysisJob(id)` | Status, result, artifacts, code | 404 |
| `listAnalysisJobs(cursor)` | History | — |
| `cancelAnalysisJob(id)` | Flow 4 | 404, 409 if terminal |
| `getArtifactUrl(artifactId)` | Short-lived signed URL | 404 |

## Invariants

1. No database credential, API key, or storage token ever enters a sandbox.
2. Sandboxes have no network egress.
3. An export contains only rows owned by the job's user.
4. Free-text columns are excluded from exports unless the scope explicitly requests them.
5. Exported values are in canonical units, described by `units.json` and `schema.json`.
6. `/data` is read-only; only `/out` is writable; only allowlisted content types are collected.
7. Every sandbox is destroyed on job completion, failure, timeout, or cancellation.
8. `code` is retained verbatim for every job that reached the run stage.
9. A result is delivered only when stdout parses to the result contract.
10. `caveats` is non-empty when the analysis falls below the applicable sufficiency threshold.
11. Analysis is strictly read-only: no path writes application data from a job.

## Key Design Decisions

**Export, don't connect.** Giving the sandbox a read-only database role would be simpler and would
make every security property depend on that role's grants being right forever. Exporting files means
the boundary is the export query, which is one function, reviewed once, scoped by session user.

**No network in the container.** It removes exfiltration as a category and removes runtime package
installation as a supply-chain surface. The cost — no external data in an analysis — is not something
this product needs.

**Async by contract, not by convenience.** A synchronous version would work in testing and fail on
the questions worth asking, which are exactly the slow ones.

**Self-correction, bounded.** Most failures are trivial: a null, a dtype, a column name. Two
revisions recover nearly all of them. Unbounded retries turn a failed analysis into an expensive
failed analysis.

**Code retained and shown.** The point of running code instead of asking the model is that the method
can be checked. Discarding it forfeits that.

**Sufficiency thresholds travel into the planner.** The dashboard enforces sufficiency structurally
because it owns rendering. A sandbox has no such structure, so the requirement moves into the result
contract, where an empty `caveats` on a small sample is a contract violation rather than a style
issue.

## Observability

- `analysis_job_total{status}`
- `analysis_job_duration_ms{stage=plan|export|run|collect}`
- `analysis_attempts` — a rising mean means the planner prompt or the schema manifest is degrading
- `analysis_rows_exported`, `analysis_export_truncated_total`
- `analysis_artifact_total{content_type}`, `analysis_artifact_rejected_total`
- `sandbox_create_duration_ms`, `sandbox_leaked_total` — the second must stay at zero; a non-zero
  value is a paying container nobody is using

Failures report at `warning` with `jobId`, stage, and the truncated stderr; leaked sandboxes report at
`error`.

## Implementation Notes

### Module responsibilities

| Unit | Responsibility |
| --- | --- |
| Job service | Lifecycle, status transitions, concurrency cap |
| Planner | Claude call producing scope and program via structured output |
| Exporter | Scoped queries → CSV/Parquet + `schema.json` + `units.json` |
| Sandbox driver | e2b create, upload, execute, collect, destroy |
| Result parser | stdout → result contract, validation |
| Artifact collector | Allowlist, upload, signed URLs |
| Delivery | System message into the conversation, notification fallback |
| Reaper | Periodic sweep for orphaned sandboxes |

The reaper exists because a crashed worker between create and destroy leaves a container running and
billing. It sweeps sandboxes whose job row is terminal or absent.

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `ANALYSIS_TIMEOUT_MS` | 120000 | Sandbox driver |
| `MAX_ATTEMPTS` | 3 | Self-correction |
| `MAX_EXPORT_ROWS` | 500000 | Exporter |
| `MAX_OUTPUT_BYTES` | 65536 | stdout/stderr retention |
| `MAX_ARTIFACT_BYTES` | 10485760 | Artifact collector |
| `MAX_ARTIFACTS_PER_JOB` | 10 | Artifact collector |
| `MAX_CONCURRENT_JOBS` | 2 | Job service, per user |
| `SANDBOX_MEMORY_MB` | 2048 | Sandbox driver |
| `ARTIFACT_URL_TTL_SECONDS` | 900 | Signed URLs |
| `REAPER_INTERVAL_MS` | 300000 | Reaper |

## Authors

- Claude (spec generation)
