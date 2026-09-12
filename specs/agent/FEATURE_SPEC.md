# Agent Specification

> Purpose: This document specifies the Claude agent that is the product's primary input surface — the
> conversation model, the tool surface and how it binds to the service layer, the streaming turn
> lifecycle, the audit-and-undo mechanism that makes agent writes trustworthy, and the prompt-caching
> and prompt-injection handling that make it affordable and safe. See `specs/ARCHITECTURE.md` for
> ownership and security conventions.

## Overview

The agent exists because the alternative — tapping through a food-logging form — is the reason most
logs get abandoned in week three. Typing "chicken thigh, rice, some broccoli, and a beer" is
frictionless, and that friction difference is the entire product thesis.

What makes it usable rather than merely impressive is that it is **constrained and reversible**. The
agent does not write SQL. It calls the same service functions the UI calls, with the same validation,
the same unit handling, and the same provenance. Every mutation records before-and-after state, and
`undo` is itself a tool — so the correct response to a mis-parse is "no, that was 200 grams" rather
than opening a form to repair the damage.

The model is `claude-opus-5` with adaptive thinking, driven by the SDK's tool runner in streaming
mode. Nutrition text parsing is a **separate, non-agentic structured-output call** specified in
`specs/nutrition/FEATURE_SPEC.md`; the agent calls the resulting service function rather than
re-deriving macros itself.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Conversation** | Chat | `conversations` row | An ongoing thread with the agent |
| **Message** | Message | `messages` row | One turn, storing full Anthropic content blocks |
| **Turn** | — | — | One user message and everything the agent does in response |
| **Tool call** | — | `tool_calls` row | One invocation of one tool, with input, output, and timing |
| **Action** | Change | `agent_actions` row | One reversible mutation, with before and after state |
| **Undo** | Undo | `undo` tool | Reversal of an action or an action group |
| **Action group** | — | `group_id` | Actions from one turn, undone together |

## Conceptual Layers

```
UI (SSE)          Agent runtime                 Tools                Service layer
--------          -------------                 -----                -------------
chat stream ◀──   toolRunner(stream: true)  ──▶ betaZodTool wrappers ──▶ training / nutrition /
     │                   │                            │                   health / insights
     │                   ▼                            ▼
     └── messages, tool_calls, agent_actions ◀────────┘
```

Tools are thin. A tool wrapper validates with Zod, binds `userId` from the session, calls one service
function, records an `agent_actions` row if it mutated anything, and returns a compact result. Any
tool containing business logic is a bug — that logic belongs in the service layer where the UI
reaches it too.

## Data Model

### `public.conversations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `title` | `varchar(200)` NULL | Generated from the first turn |
| `last_message_at` | `timestamptz` NULL | |
| `token_usage` | `jsonb` NOT NULL DEFAULT `'{}'` | Cumulative input, output, cache read/write |
| `compacted_at` | `timestamptz` NULL | Last server-side compaction |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

### `public.messages`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `conversation_id` | `uuid` NOT NULL | `ON DELETE CASCADE` |
| `seq` | `integer` NOT NULL | Monotonic within the conversation |
| `role` | `message_role_enum` NOT NULL | `user` \| `assistant` \| `system` |
| `content` | `jsonb` NOT NULL | **Full Anthropic content-block array, verbatim** |
| `model` | `varchar(64)` NULL | |
| `stop_reason` | `varchar(32)` NULL | |
| `usage` | `jsonb` NULL | Including `cache_read_input_tokens` |
| `created_at` | `timestamptz` | |

Indexes: unique `idx_messages_seq` on `(conversation_id, seq)`.

**`content` stores the complete block array, not extracted text.** Thinking blocks must be replayed
to the model unchanged on subsequent turns; flattening an assistant turn to its text discards them,
and also discards the `tool_use` blocks that the following `tool_result` blocks reference — producing
a history the API rejects. Rendering extracts text at read time; storage keeps everything.

### `public.tool_calls`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `message_id` | `uuid` NOT NULL | The assistant message containing the `tool_use` block |
| `tool_use_id` | `varchar(64)` NOT NULL | Anthropic's block id |
| `tool_name` | `varchar(64)` NOT NULL | |
| `input` | `jsonb` NOT NULL | |
| `output` | `jsonb` NULL | |
| `status` | `tool_status_enum` NOT NULL | `ok` \| `error` \| `rejected` |
| `error` | `text` NULL | |
| `duration_ms` | `integer` NULL | |
| `created_at` | `timestamptz` | |

### `public.agent_actions`

The audit and undo log. Append-only.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `conversation_id` | `uuid` NULL | Null for non-agent writes that opt in |
| `tool_call_id` | `uuid` NULL | |
| `group_id` | `uuid` NOT NULL | All actions from one turn share this |
| `entity_type` | `varchar(48)` NOT NULL | `meal`, `meal_item`, `workout`, `workout_set`, … |
| `entity_id` | `uuid` NOT NULL | |
| `operation` | `action_op_enum` NOT NULL | `create` \| `update` \| `delete` |
| `before` | `jsonb` NULL | Null for `create` |
| `after` | `jsonb` NULL | Null for `delete` |
| `undone_at` | `timestamptz` NULL | |
| `undone_by_action_id` | `uuid` NULL | |
| `created_at` | `timestamptz` | |

Indexes: `idx_agent_actions_group` on `(group_id)`, `idx_agent_actions_user_recent` on
`(user_id, created_at DESC) WHERE undone_at IS NULL`.

### Enums owned by this spec

`message_role_enum`, `tool_status_enum`, `action_op_enum`.

## Tool Surface

All tools are defined with `betaZodTool` from `@anthropic-ai/sdk/helpers/beta/zod`, giving typed
input and a schema generated from the Zod definition rather than hand-written JSON Schema.

### Read tools

| Tool | Input | Returns |
| --- | --- | --- |
| `search_food` | `query`, `barcode?`, `limit?` | Candidate foods with per-100 g macros and servings |
| `get_daily_nutrition` | `date` | Totals, targets, remaining, per-item breakdown |
| `get_training_summary` | `from`, `to`, `exercise?`, `muscle?` | Volume, hard sets, e1RM trend, frequency, staleness |
| `get_recent_workouts` | `limit`, `exercise?` | Sessions with set detail |
| `query_metrics` | `type`, `from`, `to`, `agg` | Rollup series from `health_daily` |
| `get_sleep` | `from`, `to` | Sessions with stage breakdown |
| `list_recent_actions` | `limit` | Undoable actions from this conversation |

### Write tools

| Tool | Input | Effect |
| --- | --- | --- |
| `log_meal` | `raw_text` or `items[]`, `meal_type?`, `eaten_at?` | Full nutrition pipeline; one action group |
| `update_meal_item` | `item_id`, patch | Re-resolve one item; records `prior_choice` |
| `log_workout` | `started_at?`, `title?`, `exercises[]` with sets | Workout, exercises, sets; PR re-evaluation |
| `log_set` | `workout_id?`, `exercise`, set fields | Appends to the open or named workout |
| `update_set` | `set_id`, patch | Edit and re-derive |
| `log_measurement` | `type`, `value`, `at?` | Manual `health_samples` row |
| `set_nutrition_targets` | target fields, `effective_from?` | New target period |
| `undo` | `action_id?` or `group_id?` | Reverses; defaults to the last group in this conversation |

### Analysis tool

| Tool | Input | Effect |
| --- | --- | --- |
| `run_analysis` | `question`, `scope` | Enqueues a sandbox job; returns a job id immediately |

`run_analysis` is asynchronous by contract — see `specs/analysis-sandbox/FEATURE_SPEC.md`. The agent
is told in the system prompt that it returns a handle rather than an answer, and that results arrive
in the conversation when the job completes. A tool that blocks for two minutes inside a streaming
turn is a tool that times out.

### Binding rules

1. **`user_id` is never a tool parameter.** It is closed over from the session when the registry is
   constructed for the turn. There is no schema field for it, so the model cannot supply one.
2. **Every write tool calls exactly one service function.** No tool opens a transaction spanning
   several services; multi-entity operations are service-layer concerns.
3. **Every write tool records actions** under the turn's `group_id` before returning.
4. **Tool results are compact.** A read tool returns aggregates and at most `TOOL_RESULT_MAX_ROWS`
   rows, with a truncation marker. Returning three hundred sets fills the context with data the model
   will summarize badly; `run_analysis` exists for questions that genuinely need the full series.
5. **Errors return as tool results**, never as thrown exceptions, with `is_error: true` so the model
   can correct course. A tool that throws ends the turn with nothing useful said.

## Turn Lifecycle

```typescript
const runner = client.beta.messages.toolRunner({
  model: "claude-opus-5",
  max_tokens: 64000,
  thinking: { type: "adaptive", display: "summarized" },
  output_config: { effort: "high" },
  system: [ /* cached blocks — see Prompt Caching */ ],
  tools: registryFor(session),
  messages: history,
  stream: true,
});

for await (const stream of runner) {
  const message = await stream.finalMessage();
  if (message.stop_reason === "pause_turn") {
    runner.pushMessages({ role: "assistant", content: message.content });
  }
}
const final = await runner.done();
```

Five things this shape gets right, each of which is a known failure if skipped:

**`stream: true` yields streams, not messages.** Checking `message.stop_reason` directly on the
iterated value never fires when streaming, because the iterated value is a stream. It must be
resolved with `finalMessage()` first.

**`pause_turn` must be handled explicitly.** The tool runner does not auto-resume a paused turn. It
ends the loop and returns the paused message as final — no error, no warning, a silently truncated
answer. Pushing the assistant turn back resumes it. Each resume consumes an iteration, so
`stop_reason` on the final message is checked again after the loop.

**`display: "summarized"` is opt-in.** On `claude-opus-5` the default is `"omitted"`, which streams
thinking blocks with empty text. Since the UI shows reasoning while tools run, the default would
render as a long silent pause.

**`max_tokens: 64000` because the turn streams.** Streaming removes the HTTP-timeout reason to keep
it low.

**Adaptive thinking is left on.** Disabling it on `claude-opus-5` occasionally produces a tool call
written into visible text instead of a `tool_use` block — the turn succeeds, the call never runs, and
nothing raises. Lowering `effort` is the cost lever; disabling thinking is not.

### Persistence

The user message is written before the API call, so an interrupted turn is still recoverable. Each
assistant message is written with its full content blocks, `stop_reason`, and `usage`. `tool_calls`
rows are written as results are produced, so a client reconnecting mid-turn can replay progress from
the database rather than losing it.

### Interruption

A client disconnect aborts the runner. Completed tool calls and their actions stand — they were real
writes — and the partial assistant message is persisted with `stop_reason: "aborted"`. The next turn
resumes from a consistent history.

### Long conversations

When a conversation approaches the context window, server-side compaction is enabled
(beta `compact-2026-01-12`). The critical rule: the full `response.content` — including compaction
blocks — is appended to history. Storing only text discards the compaction state and silently
resurrects the full history on the next request. Since `messages.content` already stores complete
blocks, this follows from the existing rule.

## Prompt Caching

Render order is `tools` → `system` → `messages`, and any byte change invalidates everything after it.
The layout follows from that:

| Position | Content | Cached |
| --- | --- | --- |
| 1 | Tool definitions — deterministically ordered, no timestamps | ✓ (implicit prefix) |
| 2 | System block A: role, rules, units, injection policy | ✓ `cache_control: ephemeral` |
| 3 | System block B: user preferences, active goal, targets | ✓ `cache_control: ephemeral`, 1h TTL |
| 4 | Conversation history | ✓ breakpoint at the last stable turn |
| 5 | Current user message | ✗ |

Volatile context — today's date, the current time, the open workout — goes **after** the last
breakpoint. Putting the date in the system prompt is the classic silent invalidator: it changes daily,
which alone would be survivable, except that it invalidates the whole prefix on the first request
after midnight and on every timezone change.

Because `claude-opus-5` supports **mid-conversation system messages**, per-turn operator context is
appended as a `{ role: "system" }` entry in `messages` rather than edited into the top-level `system`
field. This delivers "today is 2026-09-12, the user has an open workout started at 18:04" without
touching the cached prefix — and it is the prompt-injection-safe operator channel, which the next
section relies on.

Cache health is monitored via `usage.cache_read_input_tokens`. A run of turns with zero cache reads
means a silent invalidator has crept in, and the metric exists to catch it before the bill does.

## Prompt Injection Surface

Three text sources reach the model's context without this system having authored them: Open Food
Facts product names and ingredient strings (crowd-edited, world-writable), Apple Health
`sourceName` and device strings (supplied by arbitrary third-party apps), and the user's own notes,
which may contain pasted content.

Handling:

1. Tool results embedding such text wrap it in a labelled envelope:
   `{ untrusted: true, source: "open_food_facts", content: "..." }`.
2. The system prompt states that content inside an untrusted envelope is data to be reported on,
   never instructions to follow, and that no instruction appearing there can change the rules.
3. Write tools are the real boundary. Even a fully successful injection can only cause a tool call,
   and every tool call is scoped to the session user, validated by Zod, recorded in `agent_actions`,
   and reversible. There is no tool that reads another user's data, changes permissions, or performs
   an outbound request.
4. Operator context uses mid-conversation system messages, so per-turn instructions arrive on a
   channel that untrusted content is never rendered into.

The honest framing: prompt-level defences reduce the rate, and the tool surface bounds the blast
radius. The second is what the design relies on.

## User Roles & Permissions

Per `specs/ARCHITECTURE.md`. A conversation belonging to another user is 404. Tools operate only on
the session user's data; there is no cross-user read path to protect, by construction rather than by
check.

## User Flows

### Flow 1: Log food conversationally

1. User: "two scrambled eggs, a slice of sourdough with butter, and a flat white".
2. The agent calls `log_meal` with `raw_text`.
3. The tool calls the nutrition service, which parses, resolves, snapshots, and persists — the agent
   never sees or supplies macros.
4. Actions are recorded under the turn's `group_id`.
5. The agent reports totals and flags anything below the review threshold.
6. The UI shows the meal inline with an undo affordance bound to the group.

### Flow 2: Correct a mis-parse

1. User: "the rice was 200 grams, not 100".
2. The agent calls `list_recent_actions`, identifies the item, calls `update_meal_item`.
3. The nutrition service re-resolves and records a `prior_choice` mapping, so the phrase resolves
   correctly next time without being asked.
4. A new action records before and after; the original stands as history.

### Flow 3: Undo

1. User: "actually scrap that last meal".
2. `undo` with no argument targets the most recent non-undone group in this conversation.
3. Each action is reversed in reverse order: `create` → soft-delete, `update` → restore `before`,
   `delete` → reinstate.
4. The reversal writes its own actions marking the originals undone. **Undo is itself undoable.**
5. Derived state — PRs, rollups, daily totals — is recomputed as a consequence of the service calls.

### Flow 4: Ask a question

1. User: "how's my protein been this week?"
2. `get_daily_nutrition` across the range, or `get_training_summary` for training questions.
3. The agent answers from tool results, in the user's display units.

### Flow 5: Ask an open-ended question

1. User: "did my squat stall when my sleep got worse?"
2. No read tool answers this, and the agent calls `run_analysis` with the question and a scope.
3. It returns a job id; the agent says the analysis is running.
4. On completion a system message carrying results and artifacts is appended, and the agent responds
   with the finding and a chart.

## API Surface

| Method | Path | Purpose | Notable codes |
| --- | --- | --- | --- |
| `POST` | `/api/v1/chat` | Stream a turn (SSE) | 200, 401, 404, 429 |
| — | `createConversation()` | New thread | — |
| — | `listConversations(cursor)` | History | — |
| — | `getConversation(id)` | Messages, rendered from blocks | 404 |
| — | `deleteConversation(id)` | Soft delete; actions and their effects persist | 404 |

SSE event types: `message_start`, `thinking_delta`, `text_delta`, `tool_start`, `tool_result`,
`action`, `message_stop`, `error`. `action` events drive the inline undo affordances, so the UI shows
what changed as it changes rather than after the turn ends.

Deleting a conversation does not undo its actions. The food was still eaten.

## Invariants

1. `messages.content` stores complete Anthropic content blocks, never extracted text.
2. `user_id` is bound from the session at registry construction and appears in no tool schema.
3. Every write tool records one `agent_actions` row per mutated entity, under the turn's `group_id`,
   before returning.
4. Every `agent_actions` row with `undone_at IS NULL` is reversible from its `before`/`after` state.
5. Tool errors return as `tool_result` with `is_error: true`; no tool throws into the runner.
6. Every tool result containing third-party text marks it with an untrusted envelope.
7. `stop_reason` is inspected on every runner iteration and again on the final message.
8. No volatile value appears before the last cache breakpoint.
9. Tool results are bounded by `TOOL_RESULT_MAX_ROWS`, with truncation signalled explicitly.
10. Agent writes and UI writes call the same service functions; no tool contains business logic.

## Key Design Decisions

**Thin tools over a general query tool.** A `run_sql` tool would be more flexible and would place the
schema, the validation, and the unit conventions under the model's control, with no audit trail and
no undo. Named tools over the service layer mean an agent write and a UI write are the same write.

**Undo as a first-class tool.** This is what makes conversational logging usable. Correction is the
common case, not the exception, and it has to be as cheap as the original utterance — otherwise the
user stops trusting the agent and goes back to forms.

**Parsing lives in the nutrition service, not in the agent.** The agent sees no macro fields anywhere
in its tool surface, so it cannot estimate them even accidentally. The constraint is structural
rather than a prompt instruction.

**Actions grouped per turn.** "Scrap that" means the meal, not the last item of it. Grouping matches
the unit of intent.

**Async analysis.** A tool that runs for two minutes inside a streaming turn breaks the turn. Handing
back a job id keeps the conversation responsive and lets the analysis take the time it needs.

**Full content blocks stored.** Required for thinking replay and compaction, and it also makes the
conversation reconstructable exactly as the model saw it, which is the only way to debug a bad turn.

## Observability

- `agent_turn_total{outcome=completed|aborted|error|paused}`
- `agent_turn_duration_ms`, `agent_turn_iterations` — iterations at the cap means a loop
- `agent_tool_call_total{tool, status}`, `agent_tool_duration_ms{tool}`
- `agent_cache_read_tokens` / `agent_input_tokens` — the cache-health ratio; a sustained drop is the
  silent-invalidator alarm
- `agent_output_tokens`, `agent_cost_estimate_usd`
- `agent_action_total{entity_type, operation}` and `agent_undo_total{scope}` — a high undo rate
  localizes which tool parses badly
- `agent_pause_turn_total` — should be near zero without server tools; a rise means a resume bug

Errors report with `conversationId`, `messageId`, tool name, and `stop_reason`.

## Implementation Notes

### Module responsibilities

| Unit | Responsibility |
| --- | --- |
| Conversation service | Threads, message persistence, sequencing |
| Turn runner | Tool runner setup, streaming, `pause_turn`, abort |
| Tool registry | Session-bound `betaZodTool` definitions |
| Tool wrappers | Validation, service call, action recording, envelope |
| System prompt builder | Cached blocks plus the per-turn mid-conversation system message |
| Action recorder | `agent_actions` writes and grouping |
| Undo engine | Reverse-order reversal, including undo of undo |
| SSE transport | Event framing, reconnect replay |

### Model configuration

| Setting | Value | Rationale |
| --- | --- | --- |
| `model` | `claude-opus-5` | |
| `max_tokens` | 64000 | Streaming; no timeout pressure |
| `thinking` | `{ type: "adaptive", display: "summarized" }` | Reasoning is shown while tools run |
| `output_config.effort` | `high` | `low` for title generation |
| `max_iterations` | 12 | Loop cap |

Title generation is a separate non-streaming call at `effort: "low"` with `max_tokens: 64`. Structured
extraction in the nutrition path uses `messages.parse()` with `zodOutputFormat` — see
`specs/nutrition/FEATURE_SPEC.md`.

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `AGENT_MAX_ITERATIONS` | 12 | Turn runner |
| `AGENT_MAX_TOKENS` | 64000 | Turn runner |
| `TOOL_RESULT_MAX_ROWS` | 50 | Tool wrappers |
| `TOOL_TIMEOUT_MS` | 15000 | Tool wrappers |
| `UNDO_WINDOW_HOURS` | 168 | Undo engine |
| `CONVERSATION_COMPACT_TOKENS` | 150000 | Compaction trigger |

## Authors

- Claude (spec generation)
