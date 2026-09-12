# tricky.ai — Design Brief

> A starting point for design work. This is the product, the person using it, the screens, and — most
> usefully — the handful of design problems that are genuinely specific to this product rather than
> generic to fitness apps. Written to be handed to a design tool or a designer cold.
>
> Source of truth for behaviour is `specs/`; this document translates it into design terms and adds
> nothing that contradicts it.

---

## 1. What this is

A personal training, nutrition, and health log where the primary way you enter data is by **talking
to Claude or pointing a camera at something**, and the primary way you get value back is a dashboard
and an agent that can actually analyze your history.

The origin story matters because it explains every priority: the user has been logging food and
training into a Claude chat for months. That works — typing "chicken thigh, rice, some broccoli" is
effortless compared with tapping through MyFitnessPal — but it stores nothing. No trends, no personal
records, no way to ask whether a bad week of sleep tracked a stalled squat. This product keeps the
chat and puts a real database, real charts, and Apple Health data underneath it.

**One-line positioning:** the logging speed of a chat, with the memory of a database.

---

## 2. Who is using it

One person, initially the person who built it. Design for them specifically rather than for a
persona.

- Trains seriously — barbell work, tracks loads and RPE, cares about progressive overload. Not a
  beginner and does not need to be taught what a set is.
- Eats with intent — cutting or bulking deliberately, tracks protein, weighs some food and eyeballs
  the rest.
- Technical. Will notice if a number is wrong and will not forgive it silently.
- Already owns an Apple Watch and has years of HealthKit data.
- **Has abandoned at least one food tracker before, at around week three.** This is the single most
  important fact in this brief. Every design decision that adds a tap to logging is a decision to be
  abandoned in week three.

They are not looking for motivation, coaching tone, or encouragement. They are looking for a
faithful record and honest analysis.

---

## 3. The core loops

**Loop 1 — Log (many times daily, seconds).** Open, say or scan what you ate or lifted, see it land,
close. This is the loop the product lives or dies on. Everything else is secondary.

**Loop 2 — Check (daily, under a minute).** How much is left today. Did I hit protein. What did I
lift last time so I know what to lift now.

**Loop 3 — Review (weekly, a few minutes).** Volume, adherence, bodyweight trend, sleep. Is what I'm
doing working.

**Loop 4 — Ask (occasionally, minutes).** An open-ended question the dashboard was never built to
answer, which spins up a real analysis with a chart.

Design priority follows exactly that order. Loop 1 is where the design must be exceptional; Loop 4 is
where it can be interesting.

---

## 4. The design problems that are actually specific to this product

This is the section worth the most attention. Everything else is craft; these are the decisions that
make this product itself.

### 4.1 Chat that produces visible, correctable rows

This is not a chatbot with a database behind it, and it must not look like one. When the user says
"two eggs and toast", the chat produces **a structured card in the conversation** showing the
resolved items, quantities, and macros — editable in place, with one undo affordance for the whole
meal.

The signature interaction of the product is: say something → watch structured rows appear → tap one
to correct it. The correction has to be as cheap as the original utterance, because correcting is the
common case, not the exception. If correcting means opening a form on another screen, the user stops
trusting the agent and goes back to forms permanently.

Open question worth designing into: does the conversation sit alongside the day view, or is it the
day view? A strong answer here shapes everything.

### 4.2 Uncertainty is first-class, and must read as competence

Most food trackers show a confident number always. This one knows the difference between:

- a barcode scan — near-certain
- a database match on "chicken breast" — solid
- a photo portion estimate — **a range, 140–260 g**, genuinely uncertain
- an LLM fallback estimate — flagged, needs review
- a trend with 6 data points — **not shown at all**, with a note saying what's still needed

The hardest design problem in the product: make honesty feel like precision rather than like the app
is broken or hedging. A portion range must read as "we know exactly how much we know", not as a
failure to compute. An insufficiency note must read as rigour, not as an error state.

Do not solve this with warning colours or alert icons. Uncertainty is normal here, not exceptional.

### 4.3 Provenance without badge soup

Every entry knows where it came from: typed by hand, said to the agent, scanned, photographed,
imported from Apple Health, or backfilled from an old Claude chat. The user needs to be able to tell
at a glance — especially when a number looks wrong.

But six source types times every row is visual noise. Needs a restrained system: probably one small
mark that is *absent* for the default case and present only when it is informative.

### 4.4 The review queue is one pattern used by three features

Low-confidence food resolutions, photo detections awaiting acceptance, and chat-import proposals are
three different origins for the same interaction: *here is what we think, confirm or correct it.*
Design it once, properly, with bulk actions, and reuse it. Three bespoke review UIs would be a
mistake.

The chat-import case is the demanding one: potentially hundreds of proposals across months, grouped
by day, each showing the original sentence the user typed, the resolved entry, and a flag where the
new resolution disagrees with what Claude said at the time.

### 4.5 The early state is the product for the first month

Bodyweight trends need ~10 measurements over 14 days. Cross-domain signals need 20 paired
observations. On day one, most of the dashboard genuinely cannot render.

Most products design the full state and bolt on empty states. **Invert that here.** The first-month
experience — where the day view works fully, the week view partially, and trends show what they are
still waiting for — is the experience for a meaningful fraction of the product's life. It should feel
deliberate and even anticipatory, not skeletal.

An empty trend card should say what it is waiting for and how close it is. "Bodyweight trend — 6 of
10 measurements, 9 more days" is a better card than a grey box.

### 4.6 Two devices, two jobs

- **Phone**: logging and capture. In a kitchen, a supermarket, a restaurant, a gym. One hand.
  Possibly sweaty. Possibly bad light. Between sets, under time pressure. Large targets, high
  contrast, no precision gestures, no small hit areas.
- **Desktop**: reviewing an import, reading trends, asking analytical questions, correcting a batch.
  Dense, multi-column, keyboard-friendly.

Genuinely dual, not "responsive as an afterthought". The gym context in particular is a real
constraint: a set logger that requires precise tapping fails in the only place it is used.

### 4.7 Speed is a visible design goal

Barcode scan → logged should be under five seconds. Say a meal → rows on screen should feel
immediate, with streaming as the mechanism that makes it feel that way.

Design the optimistic and streaming states properly, not as spinners. The user should see the meal
being resolved item by item, because that is both faster-feeling and more honest than a blocking
spinner followed by a finished result.

---

## 5. Screen inventory

### Priority 1 — the logging path

**Day view (home).** The default screen. Today's food against target with remaining macros; today's
training; last night's sleep; bodyweight. Every entry inline-editable. A review queue strip if
anything needs attention. Must work fully on day one with zero history.

**Chat.** The conversation, with structured entry cards inline. Streaming text, visible tool activity
("searching foods…", "logging 4 sets"), reasoning summaries while it works. Inline undo per logged
group. The most important screen in the product.

**Capture.** Camera-first. Three modes that must be visually distinct because their accuracy differs
by an order of magnitude:
- *Scan* — live barcode detection, near-instant resolve, the highest-volume path.
- *Label* — framing guide for a nutrition panel, then side-by-side confirmation of the parsed values
  against the photo.
- *Meal* — photo, then detections highlighted on the image, each with a portion **range** and a
  slider to correct it.

**Workout logger.** Live session: exercises, sets, previous session's numbers prefilled, rest
context. Gym constraints apply hardest here. Big targets, one-handed, glanceable.

### Priority 2 — the value path

**Week.** Volume by muscle group, hard sets, frequency, calorie and protein adherence, sleep average.
Current week explicitly marked in progress.

**Trends.** Bodyweight against goal rate, e1RM per lift, resting HR, HRV, sleep duration and
consistency. Fitted lines visually distinct from raw points. Insufficiency stated where it applies.

**Exercise detail.** Every set ever, e1RM progression, PR timeline, frequency, staleness.

**Review queue.** The shared pattern from §4.4.

### Priority 3 — setup and depth

**Onboarding.** Four skippable steps: units, timezone and week start, goal, nutrition targets.
Complete after step one.

**Import — Apple Health.** Upload a large zip, watch staged progress, see an outcome breakdown
(inserted / duplicate / unmapped / malformed) with the date range covered.

**Import — Claude chat.** Upload the export, pick the conversation, then the review queue at scale.

**Analysis.** A question, a running job, then a finding with a chart, its caveats, and an inspectable
view of the code that produced it.

**Settings.** Units, goals, targets, skills, account.

---

## 6. Component inventory

- **Entry row** — food item or set. Inline-editable, provenance mark, confidence indicator where
  relevant. The most-used component in the product; design it first.
- **Macro meter** — consumed vs target for kcal, protein, carbs, fat. Appears everywhere. Must
  represent "over target" without moralizing.
- **Portion range control** — a slider across an estimated range with the food's registered servings
  as snap points. Specific to this product and has no obvious precedent.
- **Structured entry card (in chat)** — the bridge between conversation and database.
- **Stat tile** — a value, its window, and its sample size. Sample size is not optional.
- **Insufficiency card** — what a metric is waiting for and how close it is.
- **Trend chart** — raw points as faint context, fitted line as the figure, partial periods marked.
- **Proposal card** — original text, resolved entry, date basis, divergence flag, accept/edit/reject.
- **Provenance mark** — the restrained system from §4.3.
- **Scan overlay** — live camera with detection feedback.
- **Detection overlay** — photo with bounding boxes and per-item confidence.

---

## 7. Visual direction

**Calm and dense.** This is an instrument, not a game. Someone opens it eight times a day; anything
loud becomes exhausting by week two.

**Data-forward.** Numbers are the content. Typography does most of the work — a tabular-figure
typeface that makes columns of weights and macros scan cleanly is worth more here than any
illustration.

**Quietly precise.** The feeling to aim for is a well-kept notebook or a good measuring instrument.
Restrained palette, generous spacing in the reading views, tight and glanceable in the logging views.

**Dark mode is not optional.** This gets used in a gym at 6am and in a kitchen at 11pm.

Useful reference points, none to be copied: Oura's restraint in presenting uncertain physiological
data; Cronometer's information density without its visual dating; Things' handling of a dense list
that never feels cramped.

---

## 8. Anti-patterns — explicitly out

- **Gamification.** No streaks that punish a missed day, no rings to close, no confetti. A missed day
  is missing data, not a moral failure, and the product's credibility depends on saying so.
- **Moralizing about food.** No red/green good-food-bad-food coding. A number over target is
  information, not a scolding.
- **False precision.** Never a point estimate where the underlying method produces a range. Never
  "2,147 kcal" from a photo of a plate.
- **Zero-filling unlogged days.** A day with no entries is a **gap** in the chart, never a bar at
  zero. Treating it as a fast invents a deficit the user never ran.
- **Blocking modals during logging.** Ambiguity gets flagged for later, never raised as a dialog. A
  logger that interrupts is a logger the user routes around by not logging.
- **Spinners where streaming is possible.** Show the work.
- **Coaching voice.** No "Great job!". Report, don't cheer.
- **Hiding the sample size.** An average without its denominator is a claim without evidence.

---

## 9. Constraints

- Next.js web app, responsive, mobile-first for the logging path. Not a native app — camera via the
  browser, which affects how the scan UI can behave.
- Single user for now; no social, sharing, or multiplayer surfaces.
- Charts are Recharts; keep chart forms within what it does well.
- All values render in the user's chosen units (kg/lb, km/mi, kcal/kJ) — no hardcoded unit strings
  anywhere in the design.
- Offline is not supported in v1, but the logging path should degrade gracefully on a bad connection
  rather than losing input.

---

## 10. Where to start

1. **Entry row + macro meter.** Everything else composes from these.
2. **Day view.** With full data, with one week of data, and empty. All three, deliberately.
3. **Chat with structured entry cards.** The signature interaction.
4. **Capture — scan mode.** The highest-volume path and the one where speed is most visible.
5. **Portion range control.** The component with no precedent, and the one that determines whether
   §4.2 succeeds.

If only two screens get designed, make them the **day view** and the **chat**. That pair is the
product.
