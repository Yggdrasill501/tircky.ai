# Chat Import Specification

> Purpose: This document specifies the one-time backfill of a user's history out of an existing
> Claude conversation — the practical path for getting the data out of claude.ai, and the design that
> turns months of prose into structured entries without inventing any of it. See
> `specs/nutrition/FEATURE_SPEC.md` for the resolution pipeline this reuses and
> `specs/health-ingest/FEATURE_SPEC.md` for the batch conventions it shares.

## Overview

The product's first users arrive with history. They have been logging food and training into a Claude
chat for months, and that chat is the only record. An app that starts them at zero throws away the
data that would make its trend lines meaningful on day one instead of in three months.

The practical problem is narrower than it looks. Getting the text out of claude.ai is easy. The hard
part is **time**: almost everything in such a chat is relative — "yesterday I had", "this morning",
"post-workout" — and those phrases resolve only against the timestamp of the message that contains
them. Any export path that loses per-message timestamps makes the data unrecoverable without
hand-dating hundreds of entries.

That single fact determines the whole design. Import from the official data export, which carries
timestamps; parse message by message, anchored to each message's own timestamp; and never ask a model
to restructure the whole transcript at once.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Export** | Claude export | the uploaded zip | The archive claude.ai emails on request |
| **Transcript** | Conversation | `chat_transcripts` row | One conversation selected from that export |
| **Turn** | Message | `chat_turns` row | One message from the transcript, with its timestamp |
| **Anchor** | — | `turn.sent_at` | The timestamp relative dates resolve against |
| **Proposal** | Suggested entry | `chat_proposals` row | A candidate entry extracted from a turn, pending acceptance |
| **Divergence** | — | `divergence` | Disagreement between the original assistant figure and re-resolution |

## Getting the Data Out of claude.ai

This section is the user-facing half of the feature, and the import screen states it in these terms.

### The recommended path

1. In claude.ai: **Settings → Privacy → Export data**.
2. Claude emails a download link, typically within minutes.
3. The archive contains `conversations.json` — every conversation, each with a name, timestamps, and
   a `chat_messages` array carrying sender, text, and a per-message `created_at`.
4. Upload that archive here and pick the logging conversation from the list.

The exact field names in `conversations.json` have shifted between revisions of the export format.
The parser therefore probes for a small set of known shapes and reports an unrecognized format
explicitly rather than silently importing zero entries — a format change must look like a failure,
not like an empty chat.

### Why the alternatives are worse

| Path | Timestamps | Completeness | Verdict |
| --- | --- | --- | --- |
| **Official data export** | Per message, exact | Whole conversation | **Recommended** |
| Copy-paste the chat | Lost | Whole conversation | Accepted as a fallback, heavily degraded |
| Ask Claude in-chat for a table | Approximate at best | **Silently partial** | Rejected as an import path |
| Devtools / network capture | Exact | Whole conversation | Not worth the instructions |

The third row is the tempting one and it is the trap. A long logging chat has been compacted or
truncated, so the model can no longer see its own early history; it will produce a clean, confident,
incomplete table with nothing marking what is missing. Asking it to restructure hundreds of entries
in one pass is also the exact condition under which it interpolates. It remains useful as a
**spot-check** — comparing its summary against what the importer produced is a good way to notice a
systematic parse error — and the UI offers it as exactly that, after an import, never as one.

### The paste fallback

Pasting raw text is supported because some users will have deleted the account, lost the email, or
simply refuse the wait. It is offered with its cost stated plainly: without timestamps, every
relative date is unresolvable, so entries are attributed to explicit dates only and everything else
lands in the review queue undated. The screen says this **before** the paste box, not after.

## Conceptual Layers

```
claude.ai export zip
        │
        ▼
  conversations.json  ──▶  pick a conversation  ──▶  chat_transcripts
        │                                                  │
        ▼                                                  ▼
  per-turn split, timestamps preserved  ──────────▶   chat_turns
        │
        ▼
  per-turn extraction (Claude, structured output, one call per turn)
        │
        ▼
  chat_proposals  ──▶  review queue  ──▶  accepted  ──▶  nutrition / training services
        │                                                  (source = 'import')
        ▼
  divergence check against the original assistant reply
```

Nothing is written to `meals`, `workouts`, or their children until a proposal is accepted. An import
is a **staging area with a review step**, not a direct write — which is what makes importing six
months of ambiguous prose a safe operation rather than a destructive one.

## Data Model

### `public.chat_transcripts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `ingest_batch_id` | `uuid` NOT NULL | FK → `ingest_batches(id)`; `producer = 'claude_chat_export'` |
| `external_conversation_id` | `text` NULL | The conversation UUID from the export |
| `title` | `varchar(200)` NULL | |
| `turn_count` | `integer` NOT NULL | |
| `observed_from` / `observed_to` | `timestamptz` NULL | First and last turn timestamps |
| `has_timestamps` | `boolean` NOT NULL | False for the paste fallback |
| `status` | `transcript_status_enum` NOT NULL | `pending` \| `extracting` \| `review` \| `committed` \| `discarded` |
| `created_at` / `updated_at` | `timestamptz` | |

### `public.chat_turns`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `transcript_id` | `uuid` NOT NULL | `ON DELETE CASCADE` |
| `seq` | `integer` NOT NULL | Order within the transcript |
| `sender` | `chat_sender_enum` NOT NULL | `human` \| `assistant` |
| `text` | `text` NOT NULL | Verbatim, untrusted |
| `sent_at` | `timestamptz` NULL | The anchor; null only in the paste fallback |
| `local_date` | `date` NULL | Derived from `sent_at` in the user's timezone |
| `extraction_status` | `extraction_status_enum` NOT NULL | `pending` \| `extracted` \| `empty` \| `failed` |
| `created_at` | `timestamptz` | |

Indexes: unique `idx_chat_turns_seq` on `(transcript_id, seq)`.

Assistant turns are stored but **not extracted from**. They are retained for one purpose: the
divergence check below.

### `public.chat_proposals`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `transcript_id` | `uuid` NOT NULL | |
| `turn_id` | `uuid` NOT NULL | The turn it came from |
| `kind` | `proposal_kind_enum` NOT NULL | `meal` \| `workout` \| `measurement` |
| `occurred_at` | `timestamptz` NULL | Resolved from the anchor plus the relative phrase |
| `local_date` | `date` NULL | |
| `date_basis` | `date_basis_enum` NOT NULL | `explicit` \| `relative` \| `anchor` \| `unknown` |
| `payload` | `jsonb` NOT NULL | The structured extraction, pre-resolution |
| `resolved` | `jsonb` NULL | After the nutrition/training resolution pipeline |
| `original_figures` | `jsonb` NULL | What the assistant said at the time, if it said anything |
| `divergence` | `jsonb` NULL | Per-field comparison; see Divergence Check |
| `confidence` | `numeric(3,2)` NOT NULL | |
| `status` | `proposal_status_enum` NOT NULL | `pending` \| `accepted` \| `rejected` \| `edited` |
| `committed_entity_type` | `varchar(48)` NULL | Set on acceptance |
| `committed_entity_id` | `uuid` NULL | Set on acceptance |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `idx_chat_proposals_review` on `(transcript_id, status, local_date)`.

### Enums owned by this spec

`transcript_status_enum`, `chat_sender_enum`, `extraction_status_enum`, `proposal_kind_enum`,
`date_basis_enum`, `proposal_status_enum`.

## Extraction

### One call per turn, never one call per transcript

Each human turn is extracted independently, with its own `sent_at` supplied as the anchor. The
structured-output schema mirrors the nutrition parse in `specs/nutrition/FEATURE_SPEC.md` — **items
only, no macro fields** — extended with a training shape and a date-resolution field:

```
proposals: [{
  kind: "meal" | "workout" | "measurement",
  occurred_offset_days: integer,     // 0 = the anchor's day, -1 = "yesterday"
  time_of_day: string | null,
  date_basis: "explicit" | "relative" | "anchor" | "unknown",
  meal?:    { meal_type, items: [{ name, quantity, unit, preparation?, brand? }] },
  workout?: { title?, exercises: [{ name, sets: [{ weight, unit, reps, rpe? }] }] },
  measurement?: { type, value, unit },
  confidence: number
}]
```

Per-turn extraction buys four things: the anchor is unambiguous, a bad extraction damages one entry
rather than a month, the job is resumable, and the cost is a large number of small cached-prefix
calls rather than one call that cannot fit the transcript anyway.

Turns yielding nothing are marked `empty`, not failed. Most of a logging chat is conversation.

### Date resolution

`occurred_at` derives from `sent_at + occurred_offset_days`, with `time_of_day` applied when present
and the meal type's conventional hour otherwise. `date_basis` records how it was reached and is
carried into review:

| `date_basis` | Meaning | Review treatment |
| --- | --- | --- |
| `explicit` | The turn named a date | Trusted |
| `relative` | "yesterday", "this morning" | Trusted; the anchor is shown |
| `anchor` | No temporal language; assumed same day | Trusted with a marker |
| `unknown` | No anchor available (paste fallback) | **Always** queued for review |

### Re-resolution, not transcription

Extracted items go through the normal resolution pipeline — barcode, prior choice, exact, fuzzy,
external, LLM fallback — exactly as a live log would. The macros in the imported history therefore
come from the same food rows as everything logged afterwards.

This is the decision that makes the import worth doing. The numbers Claude produced in that chat were
never anchored to a food database, so the same meal got different figures on different days. Carrying
those forward would seed the trend line with the variance the product exists to remove. Re-resolving
costs a review queue; it buys a history that is consistent with the future.

### Divergence check

Where the assistant turn immediately following a human turn contains figures — a kcal total, a macro
breakdown — they are parsed into `original_figures` and compared against re-resolution. A
disagreement beyond `DIVERGENCE_THRESHOLD_PCT` populates `divergence` and flags the proposal.

Both sides can be wrong, and that is the point: a divergence means either the original estimate was
poor or the resolver picked the wrong food. Both are worth a glance, and neither is detectable
without the comparison. Agreement is quiet.

## User Roles & Permissions

Per `specs/ARCHITECTURE.md`. Transcripts, turns, and proposals are strictly user-owned; another
user's is 404. Transcript text is **untrusted input** per § Security Model — it is a document being
parsed, and the extraction call fences it accordingly.

## User Flows

### Flow 1: Import a conversation

1. The user uploads the export archive. It is staged to `imports/<userId>/<batchId>/` and a batch is
   created with `producer = 'claude_chat_export'`.
2. `conversations.json` is parsed; conversations are listed by title, date range, and message count.
3. The user picks one. `chat_transcripts` and `chat_turns` are written; status → `extracting`.
4. A durable job extracts per turn with bounded concurrency, writing proposals.
5. Status → `review`. The user sees a chronological queue grouped by day.

### Flow 2: Review and commit

1. Proposals are grouped by `local_date`, each showing the source turn verbatim, the resolved
   entries, the date basis, and any divergence.
2. Bulk accept is available **per day**, and per confidence band, but never for the whole transcript
   at once — an operation that commits six months unseen is one nobody can verify.
3. Accepting calls the same service functions the UI and the agent call, with `source = 'import'`.
4. Editing a proposal before accepting records a `prior_choice` mapping per
   `specs/nutrition/FEATURE_SPEC.md` Flow 3, so the correction improves future resolution too.
5. Every commit records an `agent_actions` row under one group per day.

### Flow 3: Undo an import

Because commits are grouped per day, undo works at day granularity and at transcript granularity. A
transcript-level undo reverses every group it created, in reverse order.

### Flow 4: Paste fallback

1. The user pastes raw text. `has_timestamps` is false.
2. Speaker attribution is inferred where the paste carries a recognizable structure and otherwise all
   text is treated as human.
3. Extraction runs with no anchor. Proposals with `date_basis = 'unknown'` require a date before they
   can be accepted.
4. The screen states the limitation before the paste box.

### Flow 5: Spot-check

After an import, the UI offers the in-chat summary as a **verification** step: ask Claude in the
original conversation for a rough total by month, and compare against what was imported. A large gap
means a systematic parse failure worth reporting; a small gap is expected and explained by
re-resolution.

## API Surface

| Method | Path / Action | Purpose | Notable codes |
| --- | --- | --- | --- |
| `POST` | `/api/v1/imports/chat` | Stage an export archive, list conversations | 201, 400 (unrecognized format) |
| — | `selectConversation(batchId, conversationId)` | Create transcript, enqueue extraction | 404 |
| — | `getTranscript(id)` | Status, counts, review progress | 404 |
| — | `listProposals(transcriptId, filters)` | The review queue | 404 |
| — | `updateProposal(id, patch)` | Edit before accepting | 404, 400 |
| — | `acceptProposals(ids)` | Commit through the service layer | 400 if a date is unresolved |
| — | `rejectProposals(ids)` | Mark rejected | 404 |
| — | `discardTranscript(id)` | Drop the staging area entirely | 404 |
| — | `undoImport(transcriptId \| groupId)` | Flow 3 | 404 |

## Invariants

1. No import writes to `meals`, `workouts`, or their children except through an accepted proposal.
2. Extraction is per turn; no call receives more than one turn's text as its subject.
3. Every proposal's `occurred_at` derives from its turn's `sent_at`, and `date_basis` records how.
4. A proposal with `date_basis = 'unknown'` cannot be accepted without an explicit date.
5. Assistant turns are never a source of entries — only of `original_figures`.
6. Imported items pass through the same resolution pipeline as live logs; original assistant figures
   are never written as macros.
7. Commits use the service layer with `source = 'import'` and record action groups per day.
8. Bulk acceptance is bounded to a day or a confidence band, never the whole transcript.
9. Transcript text is treated as untrusted throughout and is fenced in every model call.
10. An unrecognized export format fails loudly; it never imports zero entries silently.

## Key Design Decisions

**Timestamps decide the export path.** Everything else about the two candidate paths is comparable;
the presence or absence of per-message timestamps is the difference between an import and a data
entry project. The recommendation follows from that one fact.

**Staging with review, not direct write.** Months-old prose is ambiguous in ways the user no longer
remembers. A direct-write import would be fast and would produce a history nobody trusts, which is
worse than no history. The review queue is where that ambiguity is made visible instead of averaged
away.

**Per-turn extraction.** Bounds the blast radius of a bad parse, makes the job resumable, keeps every
call small, and — most importantly — keeps each anchor unambiguous.

**Re-resolve rather than transcribe.** The original figures are exactly the unanchored LLM estimates
the nutrition design exists to prevent. Importing them would import the drift.

**The divergence check exists because both sides can be wrong.** It is not a validation of the
importer against the transcript; it is a cheap way to surface the entries where something is off,
without deciding which.

**The in-chat summary is a verification tool, not an import path.** It is the approach most users will
try first, so the UI names it, explains why it is unreliable as a source, and gives it the job it is
actually good at.

## Observability

- `chat_import_total{outcome}`, `chat_import_duration_ms`
- `chat_turns_extracted_total{status}` — the `empty` share is expected to be the majority
- `chat_proposals_total{kind, date_basis}`
- `chat_proposal_review_total{action=accepted|edited|rejected}` — the edit rate is the extraction
  quality signal
- `chat_divergence_total{band}` — a rising share suggests the resolver is drifting from what the user
  understood at the time
- `chat_export_format_unrecognized_total` — the alarm that claude.ai changed its format

## Implementation Notes

### Module responsibilities

| Unit | Responsibility |
| --- | --- |
| Export reader | Archive open, `conversations.json` shape probing, conversation listing |
| Transcript service | Transcript and turn persistence, status transitions |
| Turn extractor | Per-turn structured-output call with anchor, fencing |
| Date resolver | Offset + time-of-day → `occurred_at`, `date_basis` |
| Proposal resolver | Runs extracted items through nutrition/training resolution |
| Divergence checker | Parses assistant figures, compares, scores |
| Review service | Queue, filters, bulk bounds, commit through the service layer |
| Paste adapter | Fallback path, speaker inference, timestamp absence |

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `EXTRACTION_CONCURRENCY` | 4 | Turn extractor |
| `EXTRACTION_MAX_TURN_CHARS` | 8000 | Turn extractor; longer turns are chunked |
| `DIVERGENCE_THRESHOLD_PCT` | 15 | Divergence checker |
| `BULK_ACCEPT_MAX_PROPOSALS` | 100 | Review service |
| `TRANSCRIPT_RETENTION_DAYS` | 90 | Staging cleanup after commit |
| `CHAT_EXTRACTION_EFFORT` | `low` | Per-turn calls; the schema does the work |

## Authors

- Claude (spec generation)
