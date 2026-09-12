# tricky.ai

A personal training, nutrition, and health log with a Claude agent as its primary input surface.

Logging food and training into a chat is effortless and produces nothing durable. This puts a
database, a dashboard, and Apple Health data underneath the chat.

## Status

Specification stage. No application code yet — see [`specs/ROADMAP.md`](specs/ROADMAP.md) for the
build order.

## Specs

Start with [`specs/ARCHITECTURE.md`](specs/ARCHITECTURE.md); it carries the conventions every other
document references.

| Spec | Covers |
| --- | --- |
| [ARCHITECTURE](specs/ARCHITECTURE.md) | System shape, stack, data conventions, security model |
| [ROADMAP](specs/ROADMAP.md) | Build phases, dependency order, exit criteria |
| [identity](specs/identity/FEATURE_SPEC.md) | Auth, session contract, preferences, units, goals |
| [training](specs/training/FEATURE_SPEC.md) | Exercises, workouts, sets, PRs, volume |
| [nutrition](specs/nutrition/FEATURE_SPEC.md) | Foods, meals, the resolution pipeline, targets |
| [health-ingest](specs/health-ingest/FEATURE_SPEC.md) | Apple Health import, dedupe, rollups |
| [chat-import](specs/chat-import/FEATURE_SPEC.md) | Backfill history out of an existing Claude chat |
| [food-capture](specs/food-capture/FEATURE_SPEC.md) | Barcode scanning, label reading, meal photos |
| [agent](specs/agent/FEATURE_SPEC.md) | Conversations, tools, streaming, undo, caching |
| [insights](specs/insights/FEATURE_SPEC.md) | Derived metrics, sufficiency rules, dashboard |
| [analysis-sandbox](specs/analysis-sandbox/FEATURE_SPEC.md) | Sandboxed analysis jobs |
| [skills](specs/skills/FEATURE_SPEC.md) | Agent skill bundles and delivery |
| [DESIGN BRIEF](specs/DESIGN_BRIEF.md) | Product and UI brief, for a design tool |

## Stack

Next.js 15 · TypeScript · Supabase (Postgres, Auth, Storage) · Drizzle · Inngest ·
`claude-opus-5` · e2b
