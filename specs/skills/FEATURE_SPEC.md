# Skills Specification

> Purpose: This document specifies how reusable expertise is packaged, stored, and delivered to the
> agent at run time. A skill is a folder of Markdown (and optional supporting files) rooted at a
> `SKILL.md`, stored in object storage, registered in Postgres, enabled on the user's agent
> configuration, and delivered to the agent either as injected context or as files staged into an
> analysis sandbox.
>
> **Revision note.** This document replaces a prototype written for a different system — a
> multi-tenant agent platform with teams, assignments, SOP-driven runs, and browser recording. The
> record of what changed and why is in § Revision History; it is kept because the prototype's
> reasoning is sound and the differences are instructive.

## Overview

Skills are pre-built capabilities that give the agent specialized knowledge. When a skill is enabled,
the agent gains expertise in an area — reading a nutrition label, applying a specific periodization
model, interpreting HRV trends — without that knowledge bloating the system prompt for every turn of
every conversation.

A skill has three representations, and the feature is mostly about keeping them in sync:

1. **Files in object storage** — the content: `SKILL.md` plus any references, scripts, or assets.
2. **A row in `public.skills`** — the registry entry carrying `name`, `description`, and a pointer
   (`storage_path`) to the files. `name` and `description` are always derived from the `SKILL.md`
   frontmatter, never entered independently.
3. **Context or files at run time** — either injected into the agent's context on demand, or written
   into an analysis sandbox at `/skills/<skill-id>/`.

There are two ownership tiers. **System skills** (`user_id IS NULL`) ship with the product, are
visible to everyone, and are read-only through the API — managed by a repo directory plus an upload
script plus a migration. **Custom skills** (`user_id = <user>`) are created by upload or in-app
authoring, and are fully editable and deletable by their owner.

Skills follow the [Agent Skills specification](https://agentskills.io/specification) for frontmatter,
which keeps custom skills portable in and out of the product.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Skill** | Skill | `skills` row | A named bundle of agent-facing knowledge, rooted at `SKILL.md` |
| **System skill** | Default skill | `skills.user_id IS NULL` | Product-provided, global, read-only |
| **Custom skill** | My skills | `skills.user_id = <user>` | User-owned, editable, deletable |
| **SKILL.md** | Skill file | `<storage_path>SKILL.md` | Required root file: YAML frontmatter + Markdown body |
| **Frontmatter** | Skill header | `SkillFrontmatter` | `name` + `description` (required), plus optional spec fields |
| **Supporting file** | Files | `<storage_path><relative>` | Any additional file (`references/`, `scripts/`) |
| **Enablement** | Skills section | `agent_config.skills[]` | Array of skill UUIDs on the user's agent configuration |
| **Disclosure** | — | — | The mechanism by which a skill's body reaches the model |

## Conceptual Layers

```
Authoring          Registry              Storage                Runtime
---------          --------              -------                -------
upload ZIP     ──┐
upload SKILL.md ─┤
in-app editor  ──┼──▶ public.skills ◀──▶ <bucket>/skills/  ──▶ context injection (agent turn)
AI generation  ──┤    (id, name,          SKILL.md          ──▶ /skills/<id>/ (analysis sandbox)
repo + script  ──┘     description,       references/…
(system skills)        storage_path)      scripts/…
```

The registry row is the only thing the agent configuration references (by UUID). Everything else is
resolved from it at run time.

## How a Skill Reaches the Model

The prototype materialized skills to `/workspace/.claude/skills/<id>/` and relied on the agent
runtime discovering them from disk. **That does not apply here.** This product's agent is the
Messages API driven by the SDK tool runner (`specs/agent/FEATURE_SPEC.md`), which has no filesystem
and discovers nothing. Skills therefore reach the model by two explicit routes:

### Route 1 — Progressive disclosure into the agent's context

1. Enabled skills contribute **name and description only** to a cached system block — typically under
   50 tokens each. This is the index the model matches against.
2. A built-in `load_skill(skill_id)` tool returns the full `SKILL.md` body as a tool result. The model
   calls it when the description matches the task at hand.
3. A skill referencing supporting files can request them through `load_skill_file(skill_id, path)`,
   subject to the same path rules as every other file route.

Descriptions are cached with the rest of the stable system prefix; bodies arrive as tool results
after the last cache breakpoint, so loading a skill mid-conversation does not invalidate the prefix
(`specs/agent/FEATURE_SPEC.md` § Prompt Caching).

This is why the frontmatter `description` must say **what** the skill does and **when** to use it.
It is the entire basis on which the model decides to load the body; a description that only names the
topic leaves the model guessing.

### Route 2 — Staged into an analysis sandbox

When an analysis job runs (`specs/analysis-sandbox/FEATURE_SPEC.md`), skills whose bundles contain
`scripts/` are written to `/skills/<skill-id>/` in the container before execution, and the planner is
told they are there. This is where a skill can carry executable helpers rather than prose.

Staging is **best-effort**: a failure to stage skills is logged and the job proceeds without them. A
storage hiccup should degrade an analysis, not fail it.

## Data Model

### `public.skills`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Also the storage prefix segment and sandbox directory name |
| `user_id` | `uuid` NULL | `NULL` = system skill. FK → `users(id)` `ON DELETE CASCADE` |
| `name` | `varchar(64)` NOT NULL | Mirrors `SKILL.md` frontmatter `name` (spec-normalized) |
| `description` | `varchar(1024)` NOT NULL | Mirrors frontmatter `description` |
| `storage_path` | `varchar(1024)` NOT NULL | Prefix with trailing slash: `skills/<userId>/<skillId>/` or `skills/system/<skillId>/` |
| `body_snapshot` | `text` NULL | The `SKILL.md` body as of the last write; see Flow 6 |
| `enabled_by_default` | `boolean` NOT NULL DEFAULT false | System skills only |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

Indexes: `idx_skills_user`, `idx_skills_name`.

There is **no join table** between skills and the agent configuration. Enablement lives in
`user_preferences.agent_config` (`specs/identity/FEATURE_SPEC.md`) as `skills: string[]` (UUIDs),
which means a deleted skill leaves a dangling ID in an old config — handled by resolution, not by a
constraint (see Invariants).

### Storage layout

```
<bucket>/skills/system/<skillId>/       # system
<bucket>/skills/<userId>/<skillId>/     # custom
    SKILL.md                            # required, at prefix root
    references/*.md                     # optional
    scripts/*.py                        # optional; staged into analysis sandboxes
```

One bucket, prefixed by kind, per `specs/ARCHITECTURE.md` § Storage layout. The prototype's split
into two buckets carried operational cost — two sets of credentials, policies, and lifecycle rules —
that a single-tenant product does not repay.

## SKILL.md Contract

Frontmatter is YAML between `---` delimiters. Per the Agent Skills spec:

```yaml
---
name: label-reading
description: Reads nutrition information from a photographed or transcribed food label and converts it to per-100g values. Use when the user provides label text or numbers that are per-serving or per-container.
---
```

**Required fields**

| Field | Rules |
| --- | --- |
| `name` | 1–64 chars; `[a-z0-9-]` only; no leading/trailing hyphen; no consecutive hyphens; unique per owner (excluding soft-deleted) |
| `description` | 1–1024 chars; must say **what** the skill does and **when** to use it — this is what the model matches against at disclosure time |

**Optional fields** (accepted, stored in the file, not surfaced in the registry): `license`,
`compatibility` (≤ 500 chars), `metadata`, `allowed-tools`.

**Normalization vs. validation.** Uploaded and AI-generated content is *validated* — a name violating
the rules is rejected with a per-field error list. Names arriving from flows where the user typed free
text are *normalized* first: lowercased, spaces and underscores → hyphens, invalid characters
dropped, consecutive hyphens collapsed, leading/trailing hyphens trimmed, truncated to 64 chars.

## User Roles & Permissions

Skills are user-scoped; there is no per-skill ACL. A user may list, view, create, edit, and delete
their own custom skills, and may read but never mutate system skills.

| Action | System skill | Own custom skill | Another user's skill |
| --- | --- | --- | --- |
| List | Yes | Yes | No |
| View files / file content | Yes | Yes | No (404) |
| Download ZIP | No (403) | Yes | No (404) |
| Edit file | No (403) | Yes | No (404) |
| Delete | No (404 — not the caller's) | Yes | No (404) |
| Enable on the agent | Yes | Yes | No |

### Key Principle

> Cross-user access is always reported as **404, not 403** — a user must not be able to probe for the
> existence of another user's skills. Only system-skill immutability uses 403, because system skills
> are already known to exist.

This rule is inherited from the prototype unchanged and generalized across the product in
`specs/ARCHITECTURE.md` § Security Model.

## User Flows

### Flow 1: Upload a skill

**Entry point**: Settings → **Skills** → **Upload a skill**.

1. The user selects a `SKILL.md` file or a `.zip`. Anything else is rejected client- and server-side.
2. For a ZIP, the archive is extracted and validated in memory (see *ZIP Handling*).
3. `SKILL.md` frontmatter is validated, and the name is checked for collision against the user's
   non-deleted skills.
4. A `skillId` is generated. Every extracted file is uploaded to `skills/<userId>/<skillId>/<relative>`
   in parallel; a single failure fails the whole upload.
5. Once every object is written, the `skills` row is inserted with `name`, `description`, and
   `body_snapshot` taken from the frontmatter and body.
6. `201` with `{ id, name, description }`.

**Failure handling**: any error after the first byte is written triggers best-effort deletion of the
whole `skills/<userId>/<skillId>/` prefix, so a failed upload never leaves orphaned objects. Cleanup
failures are logged, never surfaced — they must not mask the original error.

### Flow 2: Author a skill in-app (with optional AI draft)

1. The user opens the skill editor and describes the skill in natural language (≤ 2000 chars).
2. The draft endpoint sends the description to Claude with a skill-authoring system prompt. The model
   returns raw `SKILL.md` content — frontmatter plus a body with an H1, a "When to Use" section, and
   a numbered "Workflow" section.
3. Any preamble before the first `---` is stripped server-side; the response is content only, never
   wrapped in JSON or code fences.
4. The draft loads into the editor. Saving runs the normal upload path (validation + storage +
   registry insert).
5. Editing an existing skill takes the same endpoint with `existingContent` set, switching to an
   edit-oriented prompt that preserves untouched sections.

Generation is a drafting aid only: nothing is persisted by the draft endpoint, and generated content
passes the same validation as a hand-written file.

### Flow 3: View and edit skill files

1. `GET /api/v1/skills/:skillId/files` lists the bundle (name, path, size, content type, updated).
2. `GET /api/v1/skills/:skillId/files/*` returns the content of one **text** file. Binary files are
   refused — the viewer is a code/Markdown viewer, not a downloader.
3. `PUT /api/v1/skills/:skillId/files/*` writes new content. System skills are refused with 403.
4. When the edited path is exactly `SKILL.md`, the sequence is:
   **validate → write storage → update the registry row → verify**.

Step 4's ordering is a correction to the prototype, which updated the row *before* writing the file
and so could leave the registry describing content that was never persisted — a direct violation of
its own Invariant 2. Writing storage first means the failure mode is a row briefly lagging the file,
which the verify step closes, rather than a row permanently describing a file that does not exist.
The registry update and the verify run in one transaction; a storage write that fails never reaches
the row at all.

Path handling on every file route: reject any path containing `..` or starting with `/`, then resolve
against the skill prefix.

### Flow 4: Enable skills on the agent

1. The Skills settings screen lists the user's skills plus all system skills.
2. Selection writes UUIDs into `agent_config.skills`.
3. Skills may also be referenced by **name** — from a seed configuration or an import. Those resolve
   to UUIDs before the config is saved. Values already in UUID form pass through untouched; names are
   looked up; unresolved names are dropped with a warning rather than failing the save.
4. Name lookups return system and user rows together, ordered `user_id ASC NULLS LAST`, so a user
   skill shadowing a system skill of the same name wins — the same shadowing rule as exercises
   (`specs/training/FEATURE_SPEC.md`) and foods (`specs/nutrition/FEATURE_SPEC.md`).

### Flow 5: Skills at run time

**In an agent turn** (Route 1): enabled skill IDs are read from `agent_config`, resolved to rows, and
their names and descriptions are rendered into the cached system block. Bodies load on demand via
`load_skill`. An unresolvable ID is skipped silently — a dangling reference must never fail a turn.

**In an analysis job** (Route 2): enabled skills with `scripts/` are listed, downloaded, and written
to `/skills/<skill-id>/<relative>` in the container. Any path normalizing outside that root is
dropped. Files are written in batches.

**Resilience.** Both routes are best-effort. Listing, per-file download, and batch writes each retry
up to 3 times with exponential backoff (500 ms base) on transient conditions — HTTP 408/429/5xx from
storage, or `ECONNRESET`/`ETIMEDOUT`/`ENOTFOUND`/socket-hangup/timeout for network and sandbox
writes. Every stage carries a timeout. Partial success is a legitimate outcome and is recorded as
such.

### Flow 6: Delete a skill

1. Only a skill whose `user_id` matches the caller can be deleted; a system skill is reported as not
   found.
2. `body_snapshot` is already on the row from the last write, so the skill's text survives deletion.
3. All objects under the prefix are deleted from storage, then the row is soft-deleted
   (`deleted_at = now()`).
4. Configs still referencing the ID keep the dangling UUID. Resolution reports such IDs as
   `active` / `deleted` / `not_found` rather than failing.

`body_snapshot` is the second correction to the prototype, which retained the row "for audit" while
hard-deleting every object — leaving a row that could neither be inspected nor restored. Keeping the
body on the row makes the retained row actually mean something, and makes restore a possibility
rather than a promise the schema cannot keep. Supporting files are not retained; deletion of those is
terminal, and the UI says so before the confirmation.

### Flow 7: Download a skill

`GET /api/v1/skills/:skillId/download` streams a ZIP built from all objects under the prefix, with
`Content-Disposition` using the skill name sanitized to `[A-Za-z0-9_-]`. **System skills cannot be
downloaded** (403) — product skill content is not redistributed.

## API Surface

All routes require authentication and derive the user from the session
(`specs/identity/FEATURE_SPEC.md` § Session Contract).

| Method | Path | Purpose | Notable codes |
| --- | --- | --- | --- |
| `GET` | `/api/v1/skills` | User skills + system skills, system first, then by name | 200 |
| `POST` | `/api/v1/skills` | Create from `SKILL.md` or `.zip` (multipart) | 201, 400 (+ field errors) |
| `POST` | `/api/v1/skills/draft` | AI-draft or AI-edit `SKILL.md` content (no persistence) | 200, 400 |
| `DELETE` | `/api/v1/skills/:skillId` | Delete files, soft-delete row | 200, 404 |
| `GET` | `/api/v1/skills/:skillId/download` | ZIP of the bundle (custom only) | 200, 403, 404 |
| `GET` | `/api/v1/skills/:skillId/files` | List bundle files | 200, 404 |
| `GET` | `/api/v1/skills/:skillId/files/*` | Read one text file | 200, 400, 404 |
| `PUT` | `/api/v1/skills/:skillId/files/*` | Write one text file; revalidates on `SKILL.md` | 200, 400, 403, 404 |

Validation failures on create and file-update return both a human-readable `error` and a structured
`validationErrors: [{ field, message }]` so the editor can annotate the offending frontmatter field.

## ZIP Handling

Extraction is done fully in memory, with the archive treated as untrusted input.

**Limits**: ≤ 100 files, ≤ 100 MB total decompressed size (checked from headers before extraction, as
zip-bomb protection).

These limits apply to **skill archives only**. Health data imports use an entirely separate,
streaming pipeline with a 2 GB ceiling — see `specs/health-ingest/FEATURE_SPEC.md`. The two are
called out together because a 100 MB in-memory extractor is correct for skills and catastrophically
wrong for a 2 GB Apple Health export, and the code for one must never be reused for the other.

**Artifacts**: directory entries, `__MACOSX/` entries, and `.DS_Store` files are filtered out before
any check runs, so they never count toward limits and never reach storage.

**macOS single-directory tolerance**: compressing a folder on macOS produces `my-skill/SKILL.md`
rather than `SKILL.md`. When no root-level `SKILL.md` exists and the archive contains exactly one
top-level directory and no root-level files, that prefix is stripped from every path and the contents
are treated as the root.

**Rejection cases**, each with a distinct code so the UI can explain the fix:

| Code | Condition |
| --- | --- |
| `INVALID_ZIP` | Not a readable archive |
| `MISSING_SKILL_MD` | No `SKILL.md` at root or in the single top-level directory |
| `SKILL_MD_NOT_IN_ROOT` | `SKILL.md` exists but nested deeper |
| `TOO_MANY_FILES` | More than 100 files |
| `ZIP_TOO_LARGE` | Decompressed size over 100 MB |
| `PATH_TRAVERSAL` | Any entry containing `..` or an absolute path |
| `AMBIGUOUS_STRUCTURE` | Root-level files *and* subdirectories, or multiple top-level dirs |

## System Skills

System skills live in the repo under `system-skills/<skill-name>/`, are uploaded to the system prefix
by a script, and are registered by a migration. The three must agree on one hardcoded UUID per skill
— that UUID is both the storage prefix segment and the primary key. This is the same pattern used for
system exercises and seed foods, for the same reason: the id must be stable across environments so
user data referencing it survives a reseed.

```
system-skills/<skill-name>/
├── SKILL.md          # required
├── references/*.md   # optional supporting docs
└── scripts/*         # optional helper scripts
```

Adding one:

1. Create the directory with a valid `SKILL.md`.
2. Generate a UUID; add a migration inserting into `public.skills` with `user_id = NULL`,
   `storage_path = 'skills/system/<uuid>/'`, and `ON CONFLICT DO NOTHING`. The `down` migration
   deletes the row by ID.
3. Add the UUID and an upload call to the upload script.

The upload script is the only writer for system-skill content; no API path mutates a system skill.

### Initial system skills

Sketched here to make the feature concrete; each is specified by its own `SKILL.md`:

| Skill | Purpose |
| --- | --- |
| `label-reading` | Converting per-serving or per-container label values to per-100 g |
| `portion-estimation` | Mapping household measures to grams when no serving is registered |
| `progressive-overload` | Reading an e1RM series and proposing the next session's loads |
| `deload-detection` | Recognizing accumulated fatigue from volume, RPE, HRV, and sleep together |
| `hrv-interpretation` | Reading HRV in context, including what it does not support |

## Invariants

1. Every skill bundle has exactly one `SKILL.md` at the root of its storage prefix.
2. `skills.name` and `skills.description` always equal the current `SKILL.md` frontmatter values.
   Every write path that can change the frontmatter writes storage first, then updates the row in a
   transaction that verifies the write.
3. `name` is unique per owner among non-deleted skills. System-skill names are not part of that
   uniqueness domain, so a user may shadow a system skill.
4. `storage_path` always ends with `/` and is always the full prefix.
5. `user_id IS NULL` ⇒ immutable through the API: no edit, no delete, no download.
6. Cross-user access is reported as 404; system-skill immutability as 403.
7. Deletion is soft at the registry level and hard at the storage level; `body_snapshot` preserves the
   skill's text so the retained row remains meaningful.
8. A failed create leaves no objects behind; the prefix is swept before the error is returned.
9. Skill IDs in an agent config are not referentially enforced; every consumer tolerates IDs that are
   deleted or absent.
10. Skill delivery never fails an agent turn or an analysis job — the worst outcome is running with
    fewer skills than configured.
11. No file may resolve outside its skill root, at any stage: ZIP extraction, storage read/write
    routes, and sandbox staging each enforce this independently.
12. Skill descriptions occupy the cached system prefix; skill bodies arrive after the last cache
    breakpoint and therefore never invalidate it.

## Key Design Decisions

**Enablement in config JSON, not a join table.** Keeping `skills` as an array inside the agent
configuration means the enabled set travels with the rest of the configuration. The cost is no
referential integrity, paid for with defensive resolution at every read.

**Skill ID as the directory name.** Using the UUID rather than the name avoids collisions between a
user skill and a system skill of the same name, and removes any need to sanitize a user-controlled
string into a path.

**Name and description derived, never entered.** A single source of truth — the frontmatter — means
the registry can never drift from the file the agent actually reads, and makes uploaded, generated,
and hand-edited skills behave identically.

**Progressive disclosure instead of filesystem materialization.** The prototype's model assumed a
harness that reads a skills directory. The Messages API has no such harness, and injecting every
enabled skill's full body into every turn would be both expensive and counterproductive. Descriptions
in the cached prefix plus an on-demand `load_skill` tool gives the same selection behaviour at a
fraction of the tokens.

**Storage before registry.** Corrects the prototype's ordering. The invariant that the row matches the
file is only enforceable if the file is written first.

**`body_snapshot` on the row.** Makes soft deletion mean something. A retained row whose content is
gone is a tombstone dressed up as an audit record.

**Best-effort delivery.** Skills are enrichment, not a precondition. A storage outage should reduce
the agent's expertise, not prevent it from logging a meal.

**Text-only file editing.** The in-app editor reads and writes text files only. Binary assets can be
shipped via ZIP and read by scripts, but are deliberately not editable in the browser.

## Observability

- `skill_delivery_total{route=context|sandbox, status=success|partial_failure|failed}`
- `skill_delivery_duration_ms` — histogram across the whole per-run delivery
- `skill_load_total{skill_id}` — which skills the model actually chooses to load; a skill that is
  never loaded has a description problem, not a content problem
- `skill_download_failed_total{reason=invalid_skill_id|skill_not_found|file_download|all_files_failed}`
- `skill_upload_batch_failed_total{reason=timeout|error}`
- `skill_reference_unresolved_total` — dangling IDs in configs

Errors report to the tracker with `skillId`, the run identifier, and aggregate stats (`totalSkills`,
`totalFiles`, `failedDownloads`, `failedBatches`), at `warning` severity for expected-but-notable
conditions (missing skill, malformed ID) and `error` for genuine failures.

## Implementation Notes

### Module responsibilities

| Unit | Responsibility |
| --- | --- |
| Skills HTTP module | All routes in *API Surface* |
| Frontmatter validator | Field validation, name normalization |
| Archive extractor | ZIP extraction and every safety check in *ZIP Handling* |
| Skills repository | Registry queries; every read filters `deleted_at IS NULL` |
| Context disclosure | Description block rendering, `load_skill` / `load_skill_file` tools |
| Sandbox stager | Storage → `/skills/<skill-id>/`, retries |
| Name resolver | Skill name → UUID, user rows before system rows |
| Reference resolver | Stale skill IDs → `active` / `deleted` / `not_found` |
| `system-skills/` | System skill content, one directory per skill |
| System skill upload script | Syncs `system-skills/` to the system prefix |

### Configuration

Inherits `STORAGE_BUCKET` and `ANTHROPIC_API_KEY` from `specs/ARCHITECTURE.md` § Configuration. The
prototype's `SYSTEM_SKILLS_BUCKET` and `TEAM_SKILLS_BUCKET` are replaced by prefixes in the single
bucket.

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `MAX_FILES_IN_ZIP` | 100 | ZIP extraction |
| `MAX_DECOMPRESSED_SIZE_BYTES` | 100 MB | ZIP extraction |
| `MAX_NAME_LENGTH` | 64 | Frontmatter validation |
| `MAX_DESCRIPTION_LENGTH` | 1024 | Frontmatter validation |
| `MAX_SKILL_BODY_TOKENS` | 8000 | `load_skill` result cap |
| `BATCH_SIZE` | 50 | Sandbox file writes |
| `STORAGE_LIST_TIMEOUT_MS` | 15000 | Delivery |
| `STORAGE_DOWNLOAD_TIMEOUT_MS` | 10000 | Delivery |
| `BATCH_UPLOAD_TIMEOUT_MS` | 10000 | Sandbox staging |
| `RETRY_MAX_ATTEMPTS` | 3 | All retried operations |
| `RETRY_BASE_DELAY_MS` | 500 | Exponential backoff base |
| `MAX_SKILL_IDS` | 50 | Reference resolution |

## Revision History

Changes from the prototype, with reasons:

| # | Change | Reason |
| --- | --- | --- |
| 1 | File write now precedes the registry update on `SKILL.md` edits (Flow 3) | The prototype updated the row first, which could leave the registry describing content that was never persisted — violating its own Invariant 2 |
| 2 | `body_snapshot` added; soft delete now retains the skill's text (Flow 6) | The prototype kept the row "for audit" while hard-deleting every object, leaving a row that could be neither inspected nor restored |
| 3 | Filesystem materialization replaced by progressive disclosure (Route 1) | `/workspace/.claude/skills/` is read by a filesystem-based harness. This product's agent is the Messages API, which discovers nothing from disk |
| 4 | `team_id` → `user_id`; assignments → agent config; runs → analysis jobs | No teams, assignments, or SOP runs exist in this product |
| 5 | Browser recording flow and `recording_session` removed | No browser automation exists in this product |
| 6 | Two buckets → one bucket with prefixes | Two credential sets and two lifecycle policies for a single-tenant product is cost without return |
| 7 | ZIP limits scoped explicitly to skill archives | 100 MB in-memory extraction is right for skills and catastrophically wrong for a 2 GB health export; the two pipelines must not share code |
| 8 | Cache-interaction invariant added (12) | Skill delivery sits inside the agent's cached prefix; getting it wrong silently doubles cost |

Retained unchanged: the 404-not-403 cross-tenant rule, derived-not-entered metadata, the
normalization-vs-validation split, ZIP safety handling, best-effort delivery with retries, and the
system-skill repo/script/migration pattern.

## Authors

- Claude (spec generation)
