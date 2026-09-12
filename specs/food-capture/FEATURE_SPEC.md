# Food Capture Specification

> Purpose: This document specifies capturing food with a camera — decoding barcodes, reading
> nutrition labels, and identifying meals from a photograph — and how each becomes entries through
> the resolution pipeline. See `specs/nutrition/FEATURE_SPEC.md`, whose foods, servings, and
> resolution rules this feature feeds rather than replaces.

## Overview

Typing a meal is fast. Photographing it is faster, and it is the only input available when the user
does not know what is in front of them — a packaged product in a foreign supermarket, a restaurant
plate, a label in a language they do not read.

Three capture modes, and they are not variations of one thing. They differ by an order of magnitude
in fidelity, and the design keeps them separate precisely so that difference stays visible:

| Mode | What it produces | Fidelity | Where the numbers come from |
| --- | --- | --- | --- |
| **Barcode** | An exact product | Highest | The product database |
| **Label photo** | A product's printed values | High | The label itself, read by vision |
| **Meal photo** | Items and portion estimates | Lowest | Vision for identity, database for macros, estimate for portion |

The through-line is the same principle as the text path: **vision identifies, the database
resolves.** A photograph is evidence about *what* was eaten, and — weakly — *how much*. It is never
the source of a macro figure. The one exception is a nutrition label, where the photograph contains
the actual printed numbers, and reading them is transcription rather than estimation.

Portion estimation from a photograph is the honest weak point of this feature, and the design treats
it as such rather than hiding it behind a confident number.

## Terminology

| Term | User-Facing | DB/Code | Definition |
| --- | --- | --- | --- |
| **Capture** | Photo / scan | `food_captures` row | One camera event and everything derived from it |
| **Mode** | — | `capture_kind_enum` | `barcode` \| `label` \| `meal_photo` |
| **Detection** | Detected item | `capture_items` row | One item vision proposed from a capture |
| **Commit** | Add to log | — | Turning accepted detections into a meal |
| **Reference object** | Size reference | — | A known-size object in frame that improves portion estimates |

## Conceptual Layers

```
Camera
  │
  ├─ barcode ──▶ decoded ON DEVICE ──▶ digits only ──▶ OFF / local ──▶ exact product
  │                                                                        │
  ├─ label ────▶ image ──▶ vision OCR ──▶ per-serving ──▶ per-100g ──▶ new food row
  │                                                                        │
  └─ meal ─────▶ image ──▶ vision ──▶ items + portions ──▶ resolution ──▶ proposals
                                                                           │
                                                                           ▼
                                                                   review ──▶ meal_items
                                                                   (source = 'manual')
```

Every mode terminates in the same place: the nutrition resolution pipeline, then `meal_items` with
snapshot macros. Capture is an input surface, not a parallel store.

## External Data Sources

The user asked which open APIs exist. The survey, and the choices:

| Source | Coverage | Cost | Auth | Verdict |
| --- | --- | --- | --- | --- |
| **Open Food Facts** | ~3M packaged products, global, strong in Europe; barcodes, nutriments, images | Free, open data (ODbL) | None; a descriptive `User-Agent` is required | **Primary for barcodes** |
| **USDA FoodData Central** | Generic and whole foods, US-centric, high quality | Free | API key | **Primary for generic foods** |
| Open Prices / Open Food Facts folksonomy | Prices, tags | Free | None | Not needed |
| Nutritionix | Large branded US set, natural language, barcode | Freemium, commercial terms | Key + app id | Rejected: licensing constrains caching, and caching is central here |
| Edamam | Recipes, nutrition analysis | Freemium | Key | Rejected: same reason |
| FatSecret | Broad branded | Freemium, OAuth | OAuth 1.0a | Rejected: attribution and caching terms |
| LogMeal / Foodvisor / Clarifai food models | Photo → dish recognition | Commercial | Key | Rejected: see below |

**Open Food Facts and USDA FDC are already the two sources in `specs/nutrition/FEATURE_SPEC.md`.**
This feature adds no new provider for product data — it adds new ways of reaching them. That matters
for the caching rule: both are open-data sources whose terms permit storing results as local `foods`
rows, which is what makes the second scan of a product instant and consistent.

**A dedicated food-vision API is not used.** Claude already handles all three vision jobs — label OCR,
dish identification, portion estimation — and using it means one model, one prompt discipline, one
untrusted-content policy, and structured output that drops straight into the existing schema. A
specialist recognizer would return dish labels this system would then have to map to food rows
anyway, which is the part that is actually hard.

## Barcode Decoding

**Barcodes are decoded on the device, and the image never leaves it.**

- Primary: the browser's native `BarcodeDetector` API where available.
- Fallback: a WebAssembly decoder (ZXing) for browsers without it.
- Manual entry of the digits is always offered — barcodes on crumpled or curved packaging defeat
  every decoder, and a twelve-digit fallback is faster than an argument with the camera.

Only the decoded digits reach the server. This is a privacy property worth stating: a barcode scan
produces no photograph, no upload, and no stored image, so the highest-frequency capture mode is also
the one with no image footprint at all.

Supported symbologies: EAN-13, EAN-8, UPC-A, UPC-E. Decoding runs continuously against the camera
preview until a stable read repeats across `BARCODE_CONFIRM_FRAMES` frames, which suppresses the
single-frame misreads that otherwise log the wrong product entirely.

### Lookup order

1. Local `foods` by `barcode` — instant, and the common case once the user's catalog fills.
2. Open Food Facts by barcode; on a hit, cached as a local `foods` row with its servings.
3. Miss → the user is offered the **label photo** mode, which is the natural next step and turns a
   dead end into a contribution to their own catalog.

## Label Reading

For products absent from Open Food Facts — regional items, store brands, anything recent.

1. The user photographs the nutrition panel.
2. A vision call returns the printed values with their stated basis: per 100 g, per serving, per
   container, or per piece.
3. **Conversion to per 100 g happens in code, not in the model.** The model reports what is printed
   and what basis it is printed on; the service does the arithmetic. A model asked to both read and
   convert will occasionally do the arithmetic silently and wrongly, and there is no way to tell from
   the output.
4. Where the panel is per-serving and states a serving size, a `food_servings` row is created from it
   — this is the highest-quality serving data the system can obtain, because it is the manufacturer's
   own.
5. The user confirms the parsed values against the photo, side by side, before the food is created.

The `label-reading` system skill in `specs/skills/FEATURE_SPEC.md` carries the domain knowledge for
this path: basis detection, the per-100 g conversion rules, and the regional panel conventions that
differ between EU and US labels.

Confirmation is not optional. A misread digit propagates into every future log of that product, and
the photograph is right there to check against.

## Meal Photo Recognition

The hardest mode, and the one specified most conservatively.

### What vision is asked for

A structured-output call returning items with **separate** identity and quantity confidence:

```
items: [{
  name, preparation?, brand?,
  identity_confidence,                    // "is this chicken thigh"
  portion: {
    estimate_g, low_g, high_g,            // a range, never a point
    basis: "reference_object" | "plate_relative" | "typical_serving" | "unknown",
    confidence
  },
  bbox?
}]
reference_object: string | null
plate_visible: boolean
```

Two confidences, because they fail independently and at very different rates. Recognizing rice is
easy; knowing whether it is 120 g or 260 g is not, and a single blended score hides that.

### Portion estimation, honestly

Portion is returned as a **range**, and the UI shows the range rather than the midpoint. `basis`
records how it was reached:

| `basis` | Meaning | Treatment |
| --- | --- | --- |
| `reference_object` | A known-size object in frame — a fork, a standard plate, a hand | Best available; narrowest range |
| `plate_relative` | Proportion of a plate of assumed size | Usable; wider range |
| `typical_serving` | A population-typical portion for the dish | **Effectively a guess**; widest range, always flagged |
| `unknown` | No basis | Queued for review with no number |

Where the range is wider than `PORTION_REVIEW_RATIO`, the item is flagged for review regardless of
identity confidence. The user is prompted — once, on first use — to include a reference object, and
the app suggests the one that is always present: a hand, or the utensil.

Nothing here makes portion estimation from a photograph accurate. The design's contribution is that
it never presents an inaccurate estimate as a precise one.

### Multi-item counting

A plate typically holds several foods, and discrete items are counted where countable: three eggs,
two slices, one banana. `capture_items` is one row per identified food, each independently
resolvable, acceptable, editable, and rejectable. Rejecting the rice does not disturb the chicken.

### What the model is not asked for

Macros. There is no field for them in the schema, exactly as in the text path. Vision proposes
identity and mass; the food database supplies everything else.

## Data Model

### `public.food_captures`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | |
| `kind` | `capture_kind_enum` NOT NULL | `barcode` \| `label` \| `meal_photo` |
| `storage_path` | `varchar(1024)` NULL | `captures/<userId>/<captureId>/image.jpg`; **null for barcode** |
| `content_type` | `varchar(40)` NULL | |
| `bytes` | `integer` NULL | |
| `width` / `height` | `smallint` NULL | Post-downscale |
| `barcode` | `varchar(32)` NULL | Barcode mode only |
| `captured_at` | `timestamptz` NOT NULL | Client-supplied, server-validated |
| `local_date` | `date` NOT NULL | |
| `status` | `capture_status_enum` NOT NULL | `pending` \| `analyzing` \| `review` \| `committed` \| `failed` \| `discarded` |
| `vision_result` | `jsonb` NULL | The raw structured output, retained for debugging |
| `model` | `varchar(64)` NULL | |
| `usage` | `jsonb` NULL | Token accounting |
| `meal_id` | `uuid` NULL | Set on commit |
| `error` | `text` NULL | |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

Indexes: `idx_food_captures_user` on `(user_id, captured_at DESC)`,
`idx_food_captures_pending` on `(status) WHERE status IN ('pending','analyzing')`.

### `public.capture_items`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `capture_id` | `uuid` NOT NULL | `ON DELETE CASCADE` |
| `position` | `smallint` NOT NULL | |
| `detected_name` | `varchar(200)` NOT NULL | What vision called it |
| `preparation` | `varchar(80)` NULL | |
| `count` | `smallint` NULL | Discrete items, where countable |
| `identity_confidence` | `numeric(3,2)` NOT NULL | |
| `portion_estimate_g` | `numeric(9,3)` NULL | Range midpoint |
| `portion_low_g` / `portion_high_g` | `numeric(9,3)` NULL | |
| `portion_basis` | `portion_basis_enum` NOT NULL | |
| `portion_confidence` | `numeric(3,2)` NULL | |
| `bbox` | `jsonb` NULL | Normalized box, for highlighting on the image |
| `food_id` | `uuid` NULL | After resolution |
| `resolution_method` | `resolution_enum` NULL | Shared with `specs/nutrition/FEATURE_SPEC.md` |
| `status` | `capture_item_status_enum` NOT NULL | `proposed` \| `accepted` \| `edited` \| `rejected` |
| `meal_item_id` | `uuid` NULL | Set on commit |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: unique `idx_capture_items_position` on `(capture_id, position)`.

### Enums owned by this spec

`capture_kind_enum`, `capture_status_enum`, `portion_basis_enum`, `capture_item_status_enum`.

### Enums extended by this spec

`resolution_enum`, owned by `specs/nutrition/FEATURE_SPEC.md`, gains two values for this feature:
`vision_barcode` and `vision_estimate`.

## Image Handling

**Client side**, before anything is sent:

1. Downscale so the longest edge is `MAX_IMAGE_EDGE_PX`. A 12-megapixel original costs tokens and
   upload time and improves nothing — food identification saturates well below it.
2. Re-encode as JPEG at `IMAGE_QUALITY`.
3. **Strip EXIF**, GPS above all. A meal photo carrying the coordinates of the user's home is a
   privacy leak with no compensating benefit; the timestamp is sent as an explicit field instead.

**Server side:**

1. Validate the magic bytes; the declared content type is not trusted.
2. Store under `captures/<userId>/<captureId>/`.
3. Send to the vision call as a base64 `image` content block. Inline rather than the Files API: each
   photo is used once, and a second round trip to upload and reference it buys nothing. The Files API
   is used only on the retry path, where the same image is analyzed more than once.

**Retention.** Photos are deleted `CAPTURE_IMAGE_RETENTION_DAYS` after commit; the derived entries
persist. A food log does not need a photo archive to be useful, and holding images of everything a
person has eaten is a liability that should expire by default. The user can opt into keeping them.

## User Roles & Permissions

Per `specs/ARCHITECTURE.md`. Captures and their items are strictly user-owned. Vision output is
**untrusted text** — a photograph of a label that reads "ignore previous instructions" is exactly as
untrusted as a crowd-edited product name, and the detected name is fenced wherever it reaches the
agent.

## User Flows

### Flow 1: Scan a barcode

1. Camera opens in scan mode; decoding runs on device.
2. A stable read resolves: local → Open Food Facts.
3. Hit: the product appears with its servings; the user picks a quantity and commits. Total elapsed
   time is a few seconds, and this is the mode that should carry most packaged logging.
4. Miss: the user is offered label capture.

### Flow 2: Photograph a label

1. Guided capture, with a frame overlay for the panel.
2. Vision returns printed values and their basis; the service converts to per 100 g.
3. Side-by-side confirmation against the photo.
4. A `user` food is created with the barcode if one was scanned, so the next scan resolves locally —
   the user's own catalog grows from the gaps in the open one.

### Flow 3: Photograph a meal

1. The user photographs the plate; capture status → `analyzing`.
2. Vision returns items with identity and portion confidences.
3. Each item resolves through the nutrition pipeline.
4. The review screen shows the photo with detections highlighted; each item carries its portion
   **range** and an obvious control to correct it.
5. Accepting commits the accepted items as one meal, `source = 'manual'`, with snapshot macros.
6. Any correction records a `prior_choice` mapping, so both the resolver and future captures improve.

### Flow 4: Correcting a portion

The single most common correction, and it is a first-class control rather than an edit form: a slider
across the estimated range, with the serving options for the resolved food as snap points. Changing
it recomputes macros live from the food's per-100 g values.

### Flow 5: Capture from the agent

The user sends a photo in chat. The agent calls a capture tool, which runs the same pipeline and
returns detections; the agent reports them and asks about anything flagged. Commit still requires
confirmation — a photo is the least certain input in the system, and it is the one place where the
agent's usual log-first-review-later posture inverts.

## API Surface

| Method | Path / Action | Purpose | Notable codes |
| --- | --- | --- | --- |
| — | `lookupBarcode(code)` | Local → OFF; shared with `specs/nutrition/FEATURE_SPEC.md` | 404 |
| `POST` | `/api/v1/captures` | Upload an image, create a capture, enqueue analysis | 201, 400, 413 |
| — | `getCapture(id)` | Status, detections, resolutions | 404 |
| — | `updateCaptureItem(id, patch)` | Correct food, portion, or count | 404 |
| — | `commitCapture(id, itemIds)` | Create the meal from accepted items | 400 if none accepted |
| — | `discardCapture(id)` | Drop it and its image | 404 |
| — | `reanalyzeCapture(id, hint?)` | Re-run vision with a user hint | 429 at the retry cap |

## Invariants

1. Barcode images never leave the device; only decoded digits are transmitted.
2. Vision is never asked for macros; no capture schema contains a macro field.
3. Label values are converted to per 100 g in code, never by the model.
4. Portion estimates are stored and displayed as ranges with a recorded basis.
5. A `typical_serving` or `unknown` basis is always flagged for review.
6. Every capture item resolves through the nutrition resolution pipeline; macros come from
   `food_nutrients` and are snapshotted per that spec's snapshot rule.
7. Committed entries are indistinguishable from hand-logged ones apart from `resolution_method`.
8. EXIF is stripped client-side before upload, and GPS is never stored.
9. Content type is validated from magic bytes server-side.
10. Capture images expire after `CAPTURE_IMAGE_RETENTION_DAYS` unless the user opts to retain them.
11. Detected names are untrusted text and are fenced wherever they reach the agent.
12. A capture commits nothing without explicit acceptance.

## Key Design Decisions

**Three modes, kept separate.** Collapsing them into one "scan food" affordance would hide a
tenfold difference in accuracy behind one button. A barcode result is near-certain; a meal photo
portion is a guess with a range. The user should be able to tell which they are looking at without
reading a confidence number.

**On-device barcode decoding.** Faster, works offline, and produces no image to store or protect.

**Conversion in code, not in the model.** The model reads; the service computes. Arithmetic done
silently inside a language model is arithmetic nobody can audit.

**Ranges, not point estimates.** A point estimate is a claim of precision this method does not have.
The range is both more honest and more useful — it tells the user when to bother correcting.

**Split identity and portion confidence.** They fail at different rates for different reasons, and a
single number would let high identity confidence mask a portion guess.

**No specialist food-vision API.** Claude covers all three jobs, returns structured output that fits
the existing schema, and keeps the untrusted-content policy uniform. A specialist recognizer returns
labels that still need mapping to food rows — the hard part, unsolved.

**Images expire by default.** The entries are the product; the photographs are a means. Retaining
them indefinitely accumulates risk that the feature does not need.

**Agent capture requires confirmation.** Elsewhere the agent logs first and offers undo, because text
is usually unambiguous. A photograph is not, and the posture inverts.

## Observability

- `capture_total{kind, status}`
- `barcode_scan_total{outcome=local_hit|off_hit|miss|manual_entry}` — the miss rate drives how often
  users fall through to label capture
- `barcode_decode_duration_ms`, `barcode_decoder{native|wasm}`
- `capture_vision_duration_ms`, `capture_vision_tokens`
- `capture_item_total{portion_basis}` — the `typical_serving` share is the portion-quality signal
- `capture_item_corrected_total{field=food|portion|count}` — portion corrections are expected to
  dominate; if food corrections rise, identification is degrading
- `capture_commit_rate` — captures analyzed versus committed; a low rate means the results are not
  worth the user's time
- `capture_image_expired_total`

## Implementation Notes

### Module responsibilities

| Unit | Responsibility |
| --- | --- |
| Barcode scanner | Native `BarcodeDetector` with WASM fallback, frame confirmation |
| Image preprocessor | Downscale, re-encode, EXIF strip — client side |
| Capture service | Lifecycle, storage, status transitions |
| Vision client | Per-mode structured-output calls, fencing, retries |
| Label parser | Basis detection, per-100 g conversion, serving extraction |
| Portion estimator | Range handling, basis classification, review thresholds |
| Capture resolver | Detections → nutrition resolution pipeline |
| Commit service | Accepted items → meal through the nutrition service |
| Image reaper | Retention expiry |

### Model configuration

| Setting | Value | Rationale |
| --- | --- | --- |
| `model` | `claude-opus-5` | Vision with structured output |
| Image block | base64 inline | Single use; Files API only on the retry path |
| `output_config.effort` | `medium` for barcode-miss and label, `high` for meal photos | Meal photos are the hard case |
| Structured output | `messages.parse()` with `zodOutputFormat` | Same discipline as the text parse |

### Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| `MAX_IMAGE_EDGE_PX` | 1280 | Image preprocessor |
| `IMAGE_QUALITY` | 0.8 | Image preprocessor |
| `MAX_CAPTURE_BYTES` | 6 MB | Upload route |
| `BARCODE_CONFIRM_FRAMES` | 3 | Barcode scanner |
| `PORTION_REVIEW_RATIO` | 2.0 | High/low ratio triggering review |
| `IDENTITY_REVIEW_THRESHOLD` | 0.70 | Review flag |
| `MAX_ITEMS_PER_CAPTURE` | 15 | Vision schema bound |
| `CAPTURE_IMAGE_RETENTION_DAYS` | 30 | Image reaper |
| `CAPTURE_REANALYZE_MAX` | 3 | Retry cap |

## Authors

- Claude (spec generation)
