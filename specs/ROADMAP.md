# Roadmap & Integration Plan

> Purpose: This document sequences the specs in `specs/` into build phases, states what each phase
> integrates and what it deliberately does not, and gives each an exit criterion that can be checked
> rather than asserted. It is the only document here that describes *order*; every other spec
> describes a *system*.

## Sequencing principle

Each phase ends with something usable, not with a layer completed. A phase that delivers "the schema"
or "the API" cannot be evaluated — nobody can tell whether it works. A phase that delivers "you can
log a training day by hand" can be, in about two minutes, by logging a training day by hand.

The dependency structure is narrow. Phase 0 gates everything. Phases 1 and 3 are independent of each
other. Phase 2 depends on 1 because agent tools are wrappers over Phase 1's service functions
(`specs/agent/FEATURE_SPEC.md` § Binding rules), and building them against services that do not exist
means building them twice. Phase 4 depends on 3 for anything health-related.

```
0 ──┬── 1 ──┬── 2 ──┬── 2.5 ──┬── 4 ──── 5
    │       └──────────┘      │
    └── 3 ────────────────────┘
```

Phase 2.5 is numbered as a half-step because it adds no new subsystem — chat import and food capture
are both new *producers* feeding pipelines Phases 1 and 2 already built. Neither is on the critical
path to a working app, and both are what make it worth opening on day one.

---

## Phase 0 — Foundation

**Specs**: `specs/ARCHITECTURE.md`, `specs/identity/FEATURE_SPEC.md`

Nothing user-visible beyond signing in. The point is that every convention every later phase depends
on is in place and enforced by something other than memory.

**Steps**

1. Pin Node 22 LTS in `.nvmrc` and `package.json#engines`. The machine currently runs Node 18.20.8,
   which will not run the target toolchain — this is the first blocker and the cheapest to clear.
2. Scaffold Next.js 15 (App Router, TypeScript `strict`, `noUncheckedIndexedAccess`), Tailwind,
   shadcn/ui, ESLint, Prettier.
3. Provision Supabase; wire Drizzle to `DATABASE_URL`; establish the migration workflow.
4. Implement branded unit types (`Kilograms`, `Grams`, `Metres`, `Seconds`, `Kilocalories`) and
   bidirectional conversion. **Before any table exists** — retrofitting them means revisiting every
   signature written in the meantime.
5. Migration 1: `users`, `user_preferences`, `user_goals`, the shared enums, the `updated_at` trigger,
   and RLS policies on all three.
6. Session resolution, first-sign-in provisioning, and `SET LOCAL app.user_id` on connection
   checkout.
7. Settings and onboarding screens.
8. CI: typecheck, lint, migrations against a fresh database, and the RLS test below.

**Exit criteria**

- Sign in, land on onboarding, set units, and see them persist.
- `pnpm migrate` runs clean on an empty database, and `pnpm migrate:down` reverses it.
- A test creating two users proves user A's session cannot read user B's rows — through the service
  layer *and* directly against the database with A's RLS context.
- A test proves every table in `information_schema` that has a `user_id` column has an RLS policy.
  This one is worth writing now: it fails automatically on any future migration that forgets.

**Not in this phase**: any domain table, any agent code, any chart.

---

## Phase 1 — Manual logging core

**Specs**: `specs/training/FEATURE_SPEC.md`, `specs/nutrition/FEATURE_SPEC.md`

The first genuinely useful phase, and the foundation the agent wraps.

**Steps**

1. Migration 2 — training: `exercises`, `workouts`, `workout_exercises`, `workout_sets`,
   `personal_records`, and their enums.
2. Migration 3 — nutrition: `foods`, `food_nutrients`, `food_servings`, `meals`, `meal_items`,
   `nutrition_targets`, `recipe_components`.
3. Seed the system exercise catalog with stable hardcoded UUIDs via migration.
4. Training service: workout lifecycle, set validation against `exercises.metrics`, e1RM derivation,
   the PR engine including downward supersession.
5. Nutrition service: serving and density resolution to grams, the macro calculator, and the
   **snapshot write** — this is the invariant the whole feature rests on, and it is cheapest to get
   right before any data exists.
6. USDA FDC and Open Food Facts clients with per-100 g normalization, rate limiting, and caching as
   local `foods` rows. Seed a small whole-food catalog so week one resolves locally.
7. Resolution pipeline, minus the LLM steps: barcode, prior choice, exact, fuzzy, external. The
   pipeline is built with its final shape and two strategies stubbed.
8. UI: day view, workout logger, food search and meal logger, targets, exercise detail.

**Exit criteria**

- Log a complete training session by hand, including a superset and a bodyweight movement, and see
  correct volume and a PR.
- Log a full day of food by search and by barcode, and see totals against target.
- Edit a food's nutrients and confirm **yesterday's totals do not move**. This is the snapshot rule,
  and it is the single most important test in the phase.
- Delete the set holding a PR and confirm the record correctly reverts to the true best.
- Re-run the FDC/OFF clients offline and confirm logging still works from the local catalog.

**Not in this phase**: natural-language input, charts beyond the day view, health data.

---

## Phase 2 — The agent

**Specs**: `specs/agent/FEATURE_SPEC.md`, plus the LLM paths of `specs/nutrition/FEATURE_SPEC.md`

The phase that delivers the original motivation.

**Steps**

1. Migration 4: `conversations`, `messages`, `tool_calls`, `agent_actions`.
2. Turn runner: `toolRunner` with `stream: true`, `pause_turn` handling, abort, full-content-block
   persistence.
3. SSE transport and the chat UI, including streaming reasoning and inline tool progress.
4. Tool registry: read tools first, verified against the UI's numbers before any write tool exists.
5. Write tools with action recording and grouping.
6. Undo engine, including undo of undo.
7. The nutrition parse step — `messages.parse()` with `zodOutputFormat`, items only, no macro fields
   in the schema — wired into `log_meal`, plus the `llm_estimate` fallback strategy.
8. System prompt assembly with cache breakpoints; per-turn context via a mid-conversation system
   message.
9. Untrusted-content envelopes on every tool result carrying third-party text.

**Exit criteria**

- Log the same day as Phase 1 entirely by chat, and confirm the rows are indistinguishable from the
  hand-logged ones apart from `source`.
- "Scrap that" removes the whole meal; "undo that undo" restores it.
- `usage.cache_read_input_tokens` is non-zero from the second turn of every conversation. A run of
  zeroes means a silent invalidator, and catching it here is far cheaper than catching it on a bill.
- A conversation survives a client disconnect mid-turn: completed writes stand, history is consistent.
- A food item whose name contains an instruction-shaped string is reported, not obeyed.
- The agent's reported weekly volume equals the dashboard's, because both called the same function.

**Not in this phase**: analysis jobs, skills.

---

## Phase 2.5 — Capture and backfill

**Specs**: `specs/food-capture/FEATURE_SPEC.md`, `specs/chat-import/FEATURE_SPEC.md`

Two new producers over existing pipelines. Both depend on Phase 2's structured-output parse step and
action grouping, and neither introduces a subsystem — which is why this is a half-step.

**Steps — food capture**

1. Migration 4b: `food_captures`, `capture_items`; extend `resolution_enum`.
2. On-device barcode scanning: native `BarcodeDetector` with a WASM fallback, frame confirmation,
   manual digit entry, wired to the existing `lookupBarcode`. **This alone is most of the value** —
   packaged food is the bulk of logging, and a scan takes seconds.
3. Client-side image preprocessing: downscale, re-encode, EXIF strip.
4. Upload route, capture lifecycle, storage, image reaper.
5. Label reading: vision call, basis detection, per-100 g conversion **in code**, side-by-side
   confirmation, serving extraction.
6. Meal photo: vision call with split identity/portion confidence, portion ranges, detection
   highlighting, the portion slider.
7. Capture tool on the agent, with confirmation before commit.

**Steps — chat import**

8. Migration 4c: `chat_transcripts`, `chat_turns`, `chat_proposals`.
9. Export reader with format probing; conversation picker.
10. Per-turn extraction anchored to each turn's timestamp, bounded concurrency.
11. Date resolver and `date_basis`; proposals resolved through the nutrition pipeline.
12. Divergence check against the original assistant figures.
13. Review queue with per-day bulk bounds and per-day action groups.
14. Paste fallback, with its limitation stated before the paste box.

**Exit criteria**

- Scanning a packaged product logs it in under five seconds, and a second scan of the same product
  makes no network call.
- A product absent from Open Food Facts goes label photo → confirmed values → user food → resolves
  locally next time.
- A meal photo produces per-item portion **ranges**; no item shows a bare point estimate.
- A photo taken with location services enabled results in no stored GPS. Check the stored object.
- A real Claude export imports into a review queue where every proposal shows its source turn, its
  date basis, and any divergence.
- Importing the same conversation twice does not double the proposals.
- Accepting a day commits through the service layer and is undoable as one group.
- An export with an unrecognized shape fails loudly rather than importing zero entries.

**Not in this phase**: dish-level recipe inference from photos; multi-photo meals.

---

## Phase 3 — Health ingest

**Spec**: `specs/health-ingest/FEATURE_SPEC.md`

Independent of Phases 1–2 after Phase 0, and the phase with the most infrastructure in it.

**Steps**

1. Migration 5: `ingest_batches`, `health_samples`, `health_daily`, `sleep_sessions`.
2. The type registry: HealthKit identifier → key, unit, daily aggregate.
3. Upload route: stream to storage, create batch, enqueue. No parsing.
4. Inngest wiring.
5. **The ingest worker as a separate long-lived container** (Fly.io or Railway). This is the only
   component that does not deploy to Vercel, and the reason is in the spec: a 2 GB stream and minutes
   of CPU exceed serverless limits in both dimensions.
6. Streaming ZIP entry reader and SAX parser over `<Record>`, `<Workout>`, `<ActivitySummary>`.
7. Normalizer: registry application, offset-aware dates, `dedupe_hash`.
8. Batched conflict-tolerant insert; sleep assembly; workout import; scoped rollups.
9. Import UI with per-stage progress and the outcome breakdown.
10. `POST /api/v1/ingest/samples` returning 501, with its contract and device-token auth specified.
11. Manual measurement entry.

**Exit criteria**

- A real `export.zip` imports end to end, reporting inserted, duplicate, unmapped, and malformed
  counts with a covered date range.
- **Importing the same file twice inserts zero rows on the second run**, and the second run's
  duplicate count equals the first run's insert count. This identity is the pipeline's real test.
- An export containing an unknown HealthKit type imports successfully and counts it as unmapped.
- Deleting a batch removes its samples and correctly recomputes affected rollups and sleep sessions.
- Worker memory stays bounded across the largest available export — a memory curve that tracks file
  size means something is accumulating and the parse is not really streaming.

**Not in this phase**: the iOS app; workout routes; ECG.

---

## Phase 4 — Insights and analysis

**Specs**: `specs/insights/FEATURE_SPEC.md`, `specs/analysis-sandbox/FEATURE_SPEC.md`

**Steps**

1. Migration 6: `insight_snapshots`, `analysis_jobs`, `analysis_artifacts`.
2. Metric registry with windows and sufficiency rules; read models returning the uniform envelope.
3. Trend fitting: moving averages, linear fits, confidence.
4. Refactor Phase 2's read tools onto the read models, so agent and dashboard share one
   implementation rather than two that agree today.
5. Dashboard surfaces: Today, Week, Trends, Exercise detail. Charts follow the project's
   data-visualization conventions, settled at this point rather than in the specs.
6. Nightly snapshot job.
7. Analysis: exporter, planner call, e2b driver, result parser, artifact collector, delivery, reaper.
8. `run_analysis` wired into the agent.

**Exit criteria**

- Every dashboard metric renders either a value with its sample size or a stated reason it cannot yet
  be computed. No metric renders a bare number.
- With two weeks of data, cross-domain cards state what is still needed rather than showing a
  correlation over eleven points.
- An open-ended question produces a job, a chart, and a finding whose caveats mention sample size.
- The job's generated code is inspectable from the UI.
- A deliberately broken program self-corrects within `MAX_ATTEMPTS` and records `attempts > 1`.
- A sandbox has no network: a job attempting an outbound request fails on the attempt.
- `sandbox_leaked_total` is zero after a forced worker crash mid-job — the reaper cleaned up.

---

## Phase 5 — Skills and programs

**Spec**: `specs/skills/FEATURE_SPEC.md`

**Steps**

1. Migration 7: `skills`.
2. Frontmatter validator, ZIP extractor with every safety check, storage layout.
3. CRUD routes with the corrected write ordering (storage → registry → verify).
4. `load_skill` / `load_skill_file` tools and description rendering into the cached prefix.
5. Sandbox staging for skills carrying `scripts/`.
6. The five initial system skills, their upload script, and their registration migration.
7. In-app editor with AI drafting.
8. Training programs — deferred from Phase 1 as the least load-bearing feature in the suite.

**Exit criteria**

- A skill uploads, validates, and appears in the agent's description index.
- The model loads a skill when the task matches its description, and `skill_load_total` shows it.
- Enabling a skill does not reduce `cache_read_input_tokens` — descriptions sit in the cached prefix,
  bodies arrive after the last breakpoint.
- Editing `SKILL.md` with a storage failure injected leaves the registry row unchanged.
- Deleting a skill leaves `body_snapshot` intact and the agent config's dangling ID resolving to
  `deleted` rather than erroring.
- A system skill refuses edit, delete, and download with the correct codes.

---

## Cross-phase concerns

**Migration discipline.** One migration per phase, reversible, with the RLS-coverage test running in
CI on every one. A migration adding a `user_id` column without a policy fails the build.

**The service layer is the only writer** from Phase 1 onward. When Phase 2 adds tools and Phase 3
adds a worker, both call the same functions. The first time something writes SQL directly is the
first time the two input surfaces start to diverge.

**Untrusted text** enters at Phase 1 (Open Food Facts) and Phase 3 (export metadata), but only
becomes dangerous at Phase 2 when it reaches a model. The envelope is built in Phase 2 and applied
retroactively to Phase 1's tool results.

**Cost.** The agent's prompt-cache ratio is a Phase 2 exit criterion because it is the difference
between a conversation costing cents and costing dollars, and it degrades silently.

---

## Deployment shape

| Component | Host | Phase |
| --- | --- | --- |
| Next.js app | Vercel | 0 |
| Postgres, Auth, Storage | Supabase | 0 |
| Background jobs | Inngest | 3 |
| Ingest worker | Fly.io / Railway container | 3 |
| Analysis sandboxes | e2b | 4 |

Capture and chat import add no vendor: barcode decoding runs on-device, vision is the Claude API
already in use, and product data comes from the same two open sources as the text path.

Four vendors at full build, two of them not needed until Phase 3. The ingest worker is the only
deliberate departure from an otherwise serverless deployment, and it is forced by the export file
size rather than chosen.

## Out of scope

Native iOS app (the ingest API stub reserves its contract) · Strava, Whoop, Oura (the `source` enum
and pipeline make them additive) · social features · billing · offline support · dish-level recipe
inference from photographs.

## Authors

- Claude (spec generation)
