# Ascend — Adaptive focus timer duration from task estimated focus time

Status: **draft, under /autoplan review**
Branch: `staging` · Written 2026-08-23

---

## Goal

A task carries an estimated focus time. Selecting that task on the Focus screen
should load a *session plan* derived from the estimate — the right number of
focus blocks, at the right lengths, with breaks between them — instead of the
default/last-used duration.

One pure function produces that plan. Both the task-creation preview and the
Focus screen timer loader call it, so the number the user is promised at
creation time is the number they actually get when they sit down to work.

---

## Audit findings — three brief assumptions corrected

The brief asked for an audit before any code. Done, and it changes the shape of
the work in three places.

### A1 — There is no shared estimate helper to reuse

The brief expected "likely a shared estimate-utils helper" with possible second
copies to reconcile. There is neither. The entire existing calculation is one
inline expression:

```ts
// mobile/app/(tabs)/tasks.tsx:609
const estSessions = estimatedMinutes > 0 && sessionLengthMinutes > 0
  ? Math.max(1, Math.round(estimatedMinutes / sessionLengthMinutes))
  : 0;
```

It has exactly **one** consumer — the `≈ N sessions` preview at line 711.
Nothing else in the app derives a session count from an estimate.

Consequence: this is an extraction, not a reconciliation. There is no drift to
repair and no second implementation to hunt down. Lower risk than the brief
assumed.

Note the existing math also uses `Math.round`, so a 30-minute estimate at a
25-minute session length already renders as "1 session" — coincidentally
matching the new grace-zone rule, while a 40-minute estimate renders as
"2 sessions", also matching. The *counts* mostly agree today; what does not
exist anywhere is the **per-session length**, which is the actual new
information.

### A2 — Break scheduling already exists in `timerStore`

The brief asks to "add break-session scheduling around it." That already ships:

- `type TimerPhase = 'focus' | 'shortBreak' | 'longBreak'` (`timerStore.ts:12`)
- `getPhaseDuration(phase, settings)` (`timerStore.ts:111`)
- `complete()` already selects the next phase and applies the
  long-break-every-Nth rule (`timerStore.ts:208` and `:305`)

Consequence: the real change is **where a duration comes from** — a per-task
plan instead of `settings` — not the introduction of phase chaining. This is a
substitution at `getPhaseDuration`, not new machinery.

### A3 — The circular-import risk is already realised, and already handled

The brief flags cycle risk from wiring `taskStore` into `timerStore`.
`timerStore` already statically imports `useTaskStore` (`timerStore.ts:4`),
alongside `authStore` and `gamificationStore`, and reads through
`useTaskStore.getState()` at call time (e.g. `:245`). The cycle exists today
and is defused by deferring the read to call time rather than module-eval time.

Consequence: no new import risk, provided the new code follows the same
`.getState()`-at-call-time discipline and does not add a top-level read.

---

## The session-splitting algorithm

Naive "one session per 25 min, remainder becomes its own session" produces runt
sessions: 30 min → 25 + 5; 60 min → 25 + 25 + 10.

Rules:

1. Round the estimate to the nearest 5 minutes.
2. **Grace zone** — rounded estimate 25..35 inclusive: do NOT split. One
   continuous session equal to the estimate.
3. **Below 25** — one session equal to the estimate.
4. **Above the grace zone** — split evenly:
   - `numSessions = ceil(estimate / 25)`
   - `sessionLength = round(estimate / numSessions)` to nearest 5 min
   - short break (5 min) between sessions
   - after every 4th focus session, a long break (15–20 min) instead
5. **Minimum session floor** — never below ~15 min. If `sessionLength` would
   fall under the floor, decrement `numSessions` and re-divide, even if the
   sessions land somewhat above 25 as a result.

Worked examples the implementation must match:

| Estimate | Sessions | Breaks |
|---|---|---|
| 20 min | 1 × 20 | none |
| 30 min | 1 × 30 (grace zone) | none |
| 40 min | 2 × 20 | 1 short |
| 50 min | 2 × 25 | 1 short |
| 65 min | 3 × ~22 | 2 short |
| 100 min | 4 × 25 | 3 short, long break after session 4 |

Shape:

```ts
getSessionPlan(estimateMinutes: number): {
  sessions: number[];              // minutes per focus block
  breaks: ('short' | 'long')[];    // length === sessions.length - 1
}
```

One source of truth, called by both the creation preview and the Focus screen
loader.

---

## Focus screen behaviour

1. Selecting a task **with** an estimate loads its plan.
   - Single-session plan → set focus duration to that length.
   - Multi-session plan → set the timer to the FIRST session, and queue the
     remainder to auto-advance.
2. Selecting a task **without** an estimate changes nothing — today's
   default/last-used duration behaviour is preserved exactly.
3. Changing or clearing the selection **before** start updates the duration.
   Once a session has started, changing the selected task must NOT retroactively
   alter the running timer. This boundary is explicit scope.
4. Surface the breakdown when a multi-session task is selected
   ("Session 1 of 2 — 25 min, then a 5 min break"), reusing the existing
   creation-preview treatment rather than a new component style.
5. Decide whether the active index within a plan must survive backgrounding; if
   so, follow the existing user-scoped AsyncStorage key convention
   (`timer:{userId}:...`).

---

## Constraints (load-bearing — do not restructure)

- The timer is frontend-owned and timestamp-based (`startedAt`,
  `elapsedAtPause`, `totalMs`), with fire-and-forget REST. This was a
  deliberate pivot away from a server-tick model that failed over Expo tunnel.
- **Never modify tick logic.** This feature changes only which duration is
  loaded before a session starts, plus break scheduling around it.
- No new backend state.

---

## Open questions for review

- Where does `getSessionPlan` live? (`mobile/utils/` vs `mobile/lib/`)
- Does the plan queue live in `timerStore` state, or is it derived on demand
  from the selected task each time `complete()` fires?
- Does the long-break rule count sessions within the plan, or continue the
  existing global pomodoro count?
- What happens when a task's estimate is edited mid-plan?

---

# GSTACK REVIEW — Phase 1: CEO (strategy & scope)

Mode: SELECTIVE EXPANSION. Codex voice: `[codex-unavailable]` (binary not
installed). Claude CEO subagent: run independently.

## 0A — Premise challenge

Six premises this plan rests on. Only P4 and P6 are actually stated in the
brief; the rest are assumed silently.

| # | Premise | Stated? | Status |
|---|---|---|---|
| P1 | Users fill in `estimatedMinutes` often enough to matter | assumed | **UNVERIFIED — adoption risk** |
| P2 | Entered estimates are roughly accurate | assumed | **Likely false (planning fallacy)** |
| P3 | A task maps to one contiguous sitting | assumed | Questionable |
| P4 | Even splits beat 25-min-plus-remainder | stated | Reasonable |
| P5 | The user wants the app to choose the duration for them | assumed | **Load-bearing, untested** |
| P6 | Timer stays frontend-owned; tick logic untouched | stated | Correct, verified |

P1 is the commercial premise. The estimate field is **optional and defaults to
unset** — `tasks.tsx` renders it as `not set` until the user works a +/- stepper
in 5-minute increments. A feature that only activates on tasks carrying an
estimate is worth exactly as much as the fraction of tasks that carry one, and
nothing in the repo measures that fraction.

P2 matters because the plan hard-codes a consequence of the estimate. If people
under-estimate (they do), the app will confidently schedule 2 × 20 for work that
takes 90 minutes, then end the plan while the user is mid-flow.

P5 is the real product bet: today the duration is the user's choice and it
persists. This plan makes selecting a task silently overwrite it.

## 0B — What already exists (leverage map)

| Sub-problem | Already in the codebase | Verdict |
|---|---|---|
| Estimate → session count | `tasks.tsx:609`, one inline expression, one consumer | Extract, don't rebuild |
| Phase chaining focus→break | `TimerPhase`, `getPhaseDuration` (`timerStore.ts:111`) | **Exists — reuse** |
| Long break every Nth | `complete()` at `timerStore.ts:208`, `:305` | **Exists — reuse** |
| Estimate shown on Focus screen | `index.tsx:573-597` progress bar vs estimate | Existing UI pattern to match |
| Task selection on Focus screen | `selectTask` / `selectedTaskId` (`index.tsx:117-119`) | Hook point |
| Session persistence across kill | `timer:activeSession` + `reconstructSession()` | Extend, don't invent |

Net: roughly 60% of this feature already exists. The genuinely new parts are the
splitting rule and the per-plan duration override.

## 0C-bis — Implementation alternatives

| # | Approach | Effort (human / CC) | Risk | Verdict |
|---|---|---|---|---|
| A | Mutate `settings.workDuration` on task select | 0.5d / 10 min | **HIGH — corrupts a persisted global preference** | **Reject** |
| B | Add optional `activePlan` to timer state; `getPhaseDuration` prefers it, falls back to settings | 1.5d / 40 min | Low — additive, one call site | **Recommended** |
| C | Derive duration on demand from selected task inside `complete()` | 1d / 30 min | Medium — recomputes mid-plan, so editing the estimate mutates a running plan | Fallback |

**Critical finding (severity: critical).** The brief says "set the focus duration
to that session's length." The only existing mechanism for that is
`setWorkDuration` (`timerStore.ts:379`), which writes
`settings.workDuration` — the user's **persisted global default**. Taking the
brief literally means selecting a 40-minute task permanently changes the user's
25-minute default, and deselecting never restores it. Approach B exists to avoid
exactly this: the plan must be an *overlay* that `getPhaseDuration` consults,
never a write to `settings`.

## 0E — Temporal interrogation

- **Hour 1** — user picks a 50-min task, gets 2 × 25. Feels smart.
- **Hour 6** — user picks an un-estimated task; duration silently reverts to
  global default. Two different behaviours with no explanation on screen.
- **Day 2** — user finished session 1 of 3 yesterday, reopens the app. Does the
  plan resume at session 2, or restart at 1? Unspecified in the brief.
- **Week 2** — user edits the estimate of a task mid-plan. Unspecified.
- **Month 2** — user who never fills estimates has seen zero change. The feature
  is invisible to them.

## 0D/0F — Scope decisions

- IN: `getSessionPlan`, extraction of the creation preview onto it, Focus screen
  loading, plan overlay in `timerStore`, breakdown UI, unit tests for all six
  worked examples plus the floor rule.
- IN (blast radius, P2): the `settings`-corruption defect above. It is created
  by this feature; shipping around it is not an option.
- DEFERRED to TODOS.md: telemetry on estimate fill rate (answers P1, but is its
  own scope); re-planning when an estimate is edited mid-plan.
- NOT IN SCOPE: changing the timer tick model; any backend state.

## 0.5 — Dual voices

`[codex-unavailable]` — binary not installed. Single-voice review; the CEO
consensus table below therefore reads N/A in the Codex column rather than
CONFIRMED. Per gstack rules a single critical finding from one voice is flagged
regardless.

### CLAUDE SUBAGENT (CEO — strategic independence)

Three critical findings, all verified against the code before acceptance.

**C1 — Sessions are the app's unit of account, and variable length breaks it.**
VERIFIED:
- `backend/src/lib/goalProgress.ts:52` — `Math.min(counts.actualSessions / targetSessions, 1)`
- `mobile/app/(tabs)/tasks.tsx:945` — `focusHours = targetSessions * sessionLengthMinutes / 60`
- `mobile/app/(tabs)/tasks.tsx:980` — renders "Based on {sessionLengthMinutes}m session length"

Goal progress, and therefore XP, achievements and leaderboard standing, counts
*sessions*. That unit is only fungible because every session is currently
`settings.workDuration`. Make session length vary per task and 100 minutes of
work is worth 1 session or 4 depending on a number the user typed into an
optional field. In a product with a leaderboard, that is a scoring exploit
created by a feature whose stated goal was making the promise match reality.

**C2 — The plan splits the estimate; the user needs the remainder.**
`Task.totalTimeOnTask` already accumulates real time, and `index.tsx:573-598`
already draws a progress bar against the estimate. `getSessionPlan(estimate)`
takes one argument, so a 100-minute task with 80 minutes logged loads a fresh
4-session plan every time it is selected — and again tomorrow. The cheap
correction, `remaining = estimate - totalTimeOnTask`, yields the thing users
actually want: "~2 sessions left, done by 4:15pm."

**C3 — Credit is capped at planned duration.** VERIFIED:
`backend/src/lib/sessionCredit.ts` returns `Math.min(actual, plannedDurationSeconds)`,
and `timerStore.ts:272` sends `plannedDurationSeconds: settings.workDuration`.
Derived 20-minute blocks would credit a 25-minute effort as 20. Same work, less
credit, because of an optional field. Stopwatch mode stays uncapped.

Supporting findings: the 65 min → "3 × ~22" row contradicts the round-to-5 rule
and cannot be implemented as written; the 15-minute floor is unreachable given
`numSessions = ceil(est/25)`; a one-tap stepper move from 35 to 40 halves
session length; 480 min produces a ~10 hour "plan"; auto-advance contradicts the
plan's own "only changes which duration is loaded" constraint, since breaks
require an explicit tap today (`timerStore.ts:129-135`).

Competitive: Focus To-Do, Be Focused, PomoDone and Marinara all model the
estimate as an integer count of FIXED-length pomodoros. Motion and Sunsama map
duration to a projected finish time. Nobody ships variable-length pomodoros.

### CEO DUAL VOICES — CONSENSUS TABLE

```
  Dimension                             Claude   Codex   Consensus
  ------------------------------------- -------- ------- -----------
  1. Premises valid?                    NO       N/A     FLAGGED
  2. Right problem to solve?            NO       N/A     FLAGGED
  3. Scope calibration correct?         PARTIAL  N/A     FLAGGED
  4. Alternatives explored?             NO       N/A     FLAGGED
  5. Competitive risks covered?         NO       N/A     FLAGGED
  6. 6-month trajectory sound?          NO       N/A     FLAGGED
```

### CORRECTION to audit finding A1

A1 claimed the estimate math has "exactly one consumer" and concluded this was
"lower risk than the brief assumed." The narrow claim holds — the `estSessions`
expression at `tasks.tsx:609` does have one consumer. The conclusion was wrong.
`sessionLengthMinutes` is consumed in at least three further places, and session
COUNT is the unit goals and XP are denominated in. Risk is higher than the
brief assumed, not lower, in a place neither the brief nor the first audit
looked.

## Phase 1 status

**HALTED at the User Challenge gate.** Design and Eng review are not run against
a mechanism that is likely to be replaced. Pending the user's decision on
fixed-length vs variable-length sessions.

---

## D2 RESOLVED — user reaffirmed even splits

Challenge raised, user decided: **keep the original spec.** 65 min really does
become 3 sessions, not "4 sessions + 15 min". The concern was surfaced with
verified evidence and overruled. That is the user's call and it is now settled;
this section exists so nobody re-litigates it later.

The fallout is therefore IN SCOPE, not optional. Shipping the splitter without
these is what turns a feature into a scoring exploit.

| # | Required fallout work | File | Why it is not optional |
|---|---|---|---|
| F1 | Weight goal progress by session LENGTH, not count | `backend/src/lib/goalProgress.ts:52` | Otherwise 100 min = 1 session or 4 depending on an optional field, and the leaderboard stops meaning anything |
| F2 | Live goal data migration | goals with `targetSessions` | Existing goals silently change meaning the moment F1 lands |
| F3 | Send plan length as `plannedDurationSeconds`, raise the cap | `mobile/stores/timerStore.ts:272`, `backend/src/lib/sessionCredit.ts` | `creditedSeconds` returns `min(actual, planned)`; 20-min blocks would credit a 25-min effort as 20 |
| F4 | Fix the now-false label | `mobile/app/(tabs)/tasks.tsx:980` | "Based on {sessionLengthMinutes}m session length" stops being true |
| F5 | Plan overlay, never a `settings` write | `mobile/stores/timerStore.ts:111,379` | `setWorkDuration` persists the user's global default; deriving into it corrupts a deliberate setting |

## Algorithm spec — contradiction resolved

The spec as written **cannot be implemented**. Rule 4 says round `sessionLength`
to the nearest 5; the worked-example table says 65 min → "3 × ~22". 22 is not a
multiple of 5, 3 × 20 loses 5 minutes, 3 × 25 invents 10.

Resolved by making the invariant explicit and deriving the table from it, rather
than hand-writing rows:

> **Invariant: `sum(sessions) === roundedEstimate`, and every session is a
> multiple of 5.**

Algorithm:
```
base      = floor(estimate / n / 5) * 5     // largest 5-min block that fits
leftover  = estimate - (base * n)           // always a multiple of 5
// distribute leftover in 5-min increments across the first sessions
```

Regenerated table — every row now sums exactly and every value is a multiple
of 5:

| Estimate | n | Sessions | Sum | Breaks |
|---|---|---|---|---|
| 20 | 1 | [20] | 20 ✓ | none |
| 30 | 1 | [30] | 30 ✓ | none (grace zone) |
| 40 | 2 | [20, 20] | 40 ✓ | 1 short |
| 50 | 2 | [25, 25] | 50 ✓ | 1 short |
| 65 | 3 | [25, 20, 20] | 65 ✓ | 2 short |
| 100 | 4 | [25, 25, 25, 25] | 100 ✓ | 3 short |

Only the 65 row changes from the brief, and only because "~22" was not
implementable under the brief's own rounding rule.

Three further spec defects, auto-decided (P5, explicit over clever):
- **15-min floor is unreachable.** With `n = ceil(est/25)`, `est/n` is bounded
  below by ~17 for any `est > 35`. Keep the guard as an assertion, not a branch.
- **Grace-zone cliff.** 35 → one 35-min block; 40 → two 20s. One stepper tap
  halves session length. Accepted as a known edge; surfaced in the UI copy so
  the user sees the plan change rather than being surprised by it.
- **No day cap.** Max estimate 480 min yields ~10 hours of "plan". Cap the
  rendered plan at a sitting and label the rest.

## Phase status

- Phase 1 (CEO): **COMPLETE.** 1 premise gate passed, 1 user challenge resolved.
- Phase 2 (Design): not started — UI scope confirmed.
- Phase 3 (Eng): not started — F1/F2 migration is the main risk to review.
- Phase 3.5 (DX): skipped, no developer-facing scope.

---

## D3 — Goal accounting clarified (user direction)

User direction: goal progress tracks **tasks** (how many linked, how many
completed). Sessions and time are **stats**, not the progress denominator. Goals
should report how long they took, how many sessions it took — *even when those
sessions were different lengths* — and how many tasks were involved.

Two verifications change the plan materially.

### V1 — Session length is ALREADY variable. C1 overstated the novelty.

`setWorkDuration` (`timerStore.ts:376-383`) accepts **1 to 480 minutes**, exposed
in the Timer Duration modal (`index.tsx:787-788`). Any user can set a 1-minute
focus session today and farm session counts against a session-denominated goal.

The CEO review framed variable session length as *introducing* a scoring
exploit. It does not introduce it — the exploit ships today, through a
deliberate settings control. The adaptive splitter makes non-uniform lengths
**more common**, not newly possible. That is a real but much smaller concern,
and it argues for exactly what the user asked for: stop treating session COUNT
as a proxy for effort, and track time alongside it.

### V2 — Goal progress already defaults to tasks.

`resolveProgressMode` (`goalProgress.ts:32-38`) returns `'tasks'` unless the goal
has `targetSessions > 0`. `computeProgress` then uses `completedTaskCount /
linkedTaskCount`. The session component only engages when a user explicitly sets
a session target.

So the user's stated preference is **already the shipped default**. No formula
change is required for the common case.

### Consequence: F1 and F2 are dropped

| # | Was | Now |
|---|---|---|
| F1 | Weight goal progress by session length | **DROPPED** — progress is task-denominated by default; weighting would change a formula that is already correct for the common case |
| F2 | Live goal data migration | **DROPPED** — no formula change means no migration. This was the highest-risk item in the plan |
| F3 | Credit cap at `sessionCredit.ts` | **STANDS** — a 20-min block still credits a 25-min effort as 20 |
| F4 | Fix the false "Based on {N}m session length" label | **STANDS** — and V1 means it is *already* misleading for anyone who changed their duration |
| F5 | Plan overlay, never a `settings` write | **STANDS** — and is now the single most important fix |

Goals that DO set `targetSessions` keep counting sessions. That is the user's
explicit opt-in, it already tolerates variable lengths because of V1, and the
new time stats give it the honest denominator it was missing.

### New scope — goal stats

`TaskGoalCounts` today carries `linkedTaskCount`, `completedTaskCount`,
`actualSessions`. It has **no time**. Add:

| Stat | Source | Cost |
|---|---|---|
| Total focus time | `_sum: { durationSeconds: true }` on the EXISTING `session.groupBy` in `loadGoalCounts` | ~free, same query |
| Sessions taken | `actualSessions` — already there | none |
| Tasks involved / completed | already there | none |
| Elapsed time to accomplish | `TaskGoal.createdAt` -> `completedAt` — both already stored | none |

`Session.durationSeconds` and `plannedDurationSeconds` both exist on the model,
so honest per-goal time needs no schema change and no new query — one `_sum`
added to a `groupBy` that already runs.

Stat line the goal detail should be able to render:

> **12 of 15 tasks · 34 sessions · 14h 20m focus · 9 days**

That reads correctly whether the sessions were 25 minutes each or a mix of 20s
and 30s, which is exactly the property the user asked for.

---

# GSTACK REVIEW — Phase 2: Design

UI scope: CONFIRMED (Focus screen breakdown, override control, creation preview).

## Step 0 — Design scope

**Initial design completeness of the plan: 4/10.** It names one copy string
("Session 1 of 2 — 25 min, then a 5 min break") and one instruction ("reuse
existing UI patterns rather than introducing a new component style"). Everything
else — placement, hierarchy, the override control, every non-happy state — is
left to the implementer.

### There is no design system to align to

`DESIGN.md`: absent. `docs/designs/`: absent. `mobile/components/` holds twelve
feature components (`FeedCard`, `LevelBadge`, `XPBar`, `LeaderboardRow`, …) and
**no primitives** — no `Button`, `Card`, `Sheet`, or `Chip`. Every screen styles
inline against theme tokens from `useTheme()`.

Consequence: "reuse the existing pattern" is not enforceable by import, only by
imitation. The plan must name the exact precedent to copy, or the breakdown UI
will drift into a fourth style.

### Patterns the breakdown must match (cited, not invented)

| Need | Existing precedent | Strength |
|---|---|---|
| Small-caps field label | `monoLabel` in `tasks.tsx` (`TIME`, `DUE DATE`, `SUBJECT`) | Strong — used throughout the create sheet |
| Segmented switch | `styles.segment` / `segmentItem`, `components/calendar/shared.tsx` | Strong — Day/Week/Month/Stats and the Circle tab both use it |
| Explanatory info box (icon + subtext on `Colors.raised`) | `FocusModeSheet.tsx:102-112` | **Weak — exactly one instance, written this same session.** Not yet a convention |
| Estimate progress vs actual | `index.tsx:573-598`, already on the Focus screen | Strong, and directly adjacent to this feature |
| Inline secondary metric | `≈ N sessions` beside the stepper, `tasks.tsx:711` | Strong — this is the creation-side half of the same idea |

The last row matters most: the creation preview and the Focus-screen breakdown
are two views of one fact. They should read as siblings, not as separate
inventions. The plan already requires them to share `getSessionPlan`; they
should share phrasing too.

### The hero problem

The Focus screen's hero is the countdown. Anything added for a multi-session
plan competes with it for the same vertical space, directly above the primary
action. The estimate progress bar at `index.tsx:573-598` already occupies that
region when a task is selected — so the breakdown is not landing on empty
canvas, and the plan does not acknowledge the neighbour it has to live beside.

## Passes 1-7 (primary review)

### Pass 1 — Information hierarchy · 3/10

The plan puts a breakdown line on the Focus screen without saying where. The
screen already has a hierarchy when a task is selected: task title, then
estimate progress bar (`index.tsx:573-598`), then the countdown, then Start.

Decision (structural, auto-fixed — P5 explicit over clever): the breakdown is
**secondary to the countdown and subordinate to the task title**, rendered as a
single line under the task title, in `Colors.subtext` at the same 11-12px the
estimate bar's label already uses. It must not gain a card, a border, or its own
background — those read as a competing hero.

> Deep work
> Session 1 of 2 · 25 min, then a 5 min break
> ▓▓▓▓▓░░░░░ 48%
>
> **25:00**
> [ Start ]

### Pass 2 — Missing states · 2/10 (the plan specifies ONE)

Structural gap, auto-fixed. Every row below is reachable in normal use and none
are described in the brief.

| State | Trigger | Required behaviour |
|---|---|---|
| No estimate (**majority case**) | Task has `estimatedMinutes == null` | No breakdown line at all. Duration untouched. Silence, not "no plan available" |
| Single-session plan | Grace zone or under 25 | Duration set; **no** "Session 1 of 1" — that reads as broken |
| Multi-session, not started | Plan loaded, `status === 'idle'` | Breakdown + override affordance |
| Mid-plan | Session 2 of 3 in progress | "Session 2 of 3" — index must come from state, not recomputation |
| Plan half-finished yesterday | App reopened, `timer:activeSession` rehydrated | **Unspecified in the brief.** Decision: a plan does not survive a day boundary; it re-derives from remaining estimate. Show "Session 1 of 2" fresh rather than resuming a stale index |
| Backgrounded mid-plan | OS suspends app | Index persists via the existing `timer:activeSession` snapshot — extend it, do not add a second key |
| Task deselected mid-setup | User clears selection before Start | Duration reverts to `settings.workDuration`. This is exactly why F5 (overlay, never a settings write) is load-bearing |
| Task swapped mid-setup | Different task chosen before Start | Plan recomputes |
| Task swapped **after** Start | Selection changes while running | Running timer unchanged. Brief already scopes this; the UI must not imply otherwise |
| Estimate edited mid-plan | User edits the task while a plan is active | Running session unchanged; plan re-derives on next selection |

### Pass 3 — Override affordance · 4/10

The premise gate (D1) settled that the plan is a suggestion, not a decree. The
plan file never says where that control lives.

Decision (structural, auto-fixed): **no modal, no two-button prompt.** A
"Use plan / Keep 25:00" dialog on every task selection is a tax on the most
common interaction on the screen. Instead the breakdown line carries a single
inline dismissal:

> Session 1 of 2 · 25 min, then a 5 min break · **Use 25:00 instead**

Tapping it drops the overlay and reverts to `settings.workDuration` for this
selection only. The existing Timer Duration modal (`index.tsx:770-870`) stays
the way to set a number by hand, and should show the overlay value with its
source attributed ("20 min — from *Write essay*") so the two never disagree
silently. That attribution is the fix for the "two sources of truth" risk.

### Pass 4 — Grace-zone cliff · 3/10

35 min → one 35-min block. 40 min → two 20-min blocks. One tap on the +5 stepper
halves session length. This is a consequence of the user's confirmed algorithm
(D2), so it is communicated, not removed.

Decision: the creation sheet's `≈ N sessions` preview (`tasks.tsx:711`) becomes
the honest version — it already sits beside the stepper, so the change is
visible *as the user taps*: `≈ 1 × 35 min` → `≈ 2 × 20 min`. Seeing it move at
the moment of the tap converts a surprise into an explanation. No warning copy,
no asterisk.

### Pass 5 — Specificity · 4/10

Underspecified and now decided above: placement (Pass 1), all ten states
(Pass 2), the override control (Pass 3), the cliff (Pass 4). Still open and
deferred as a taste call: exact copy wording, and whether breaks appear as
discrete items in the breakdown or only as "then a 5 min break".

### Pass 6 — Consistency · 5/10

The plan says "reuse existing UI patterns" without naming one. Named now in
Step 0. Binding decision: the Focus-screen breakdown and the creation preview
share `getSessionPlan` **and** their phrasing — `2 × 20 min` in both places, so
the promise at creation and the plan at execution are visibly the same fact.

Risk flagged: the info-box pattern in `FocusModeSheet.tsx` is a single instance
written this same session. Treating it as an established convention would be
cargo-culting my own recent code. Not used here.

### Pass 7 — Accessibility · 1/10 (absent from the plan)

Structural, auto-fixed:
- The inline override is a real control: minimum 44×44pt target, which a bare
  text link in a 12px line does not meet without padding.
- `accessibilityRole="button"` + label "Use your own 25 minute duration instead
  of the suggested plan" — the visible text alone is not self-describing.
- The breakdown line needs one `accessibilityLabel` on the container reading as
  a sentence, not four fragments a screen reader stitches badly.
- Contrast: `Colors.subtext` on `Colors.bg` must clear 4.5:1 in **both** themes;
  it is currently used for decorative meta, and this line is load-bearing.
- Dynamic Type: "Session 1 of 2 · 25 min, then a 5 min break" is long. It must
  wrap to two lines rather than truncate, or the break duration is lost first.

## Step 0.5 — Dual voices (design)

`[codex-unavailable]`. Single voice; Codex column reads N/A.

### CLAUDE SUBAGENT (design — independent review)

Three findings, the first two verified against the code before acceptance.

**D-C1 — The Focus screen ALREADY has a session-sequence indicator.** VERIFIED
at `index.tsx:414-438`: a row of blocks, filled `28×6` in `Colors.accent` with a
glow, empty `20×6` in `Colors.inactive`, commented "BREAK PROGRESS BLOCKS —
pomodoro cycle only", sitting directly above the control buttons.

With a 3-block plan loaded, that row still renders the *global* pomodoro cycle,
so the screen shows two disagreeing answers to "how many blocks am I doing" —
and the plan's proposed sentence lands *below* the start button, where it is
read after the user has already tapped.

Decision (structural, auto-fixed): when a plan is active the dots row **becomes
the plan row** — one segment per block, width proportional to block length,
same tokens and glow. No new component style, no extra vertical space, and it
sits above the control it informs. **This supersedes my Pass 1 decision**, which
put a text line under the task title without noticing the row existed.

**D-C2 — Hardcoding 25 regresses an existing personalization.** VERIFIED:
`tasks.tsx:1894` — `const sessionLengthMinutes = Math.round(settings.workDuration / 60)`.
The existing preview already divides by the user's own configured length. The
new algorithm hardcodes 25 in both the grace zone and `ceil(est / 25)`, so a
user who deliberately set 50-minute blocks selects a 50-minute task and is
handed 2 × 25 — the app overruling a setting they went and changed.

Decision (structural, auto-fixed): parameterize on `W = settings.workDuration`.
Grace zone becomes `[W, W + 10]`, `n = ceil(est / W)`. This is required by the
user's own direction ("users are able to change focus timer settings"), so it is
not a challenge to the brief — it is the brief applied consistently.

**D-C3 — The 15-minute floor IS reachable, from below.** My earlier note called
it unreachable. That is wrong: it only holds for `est > 35`. The estimate
stepper floors at 5 minutes, so `est < 25` yields a 5-minute focus block that
still counts as a full session. Correction accepted; the floor needs a real
branch on the low side, not an assertion.

### DESIGN LITMUS SCORECARD

```
  Dimension                     Primary  Subagent  Codex  Consensus
  ----------------------------- -------- --------- ------ ----------
  1. Information hierarchy       3/10     4/10      N/A    FLAGGED
  2. Missing states              2/10     3/10      N/A    FLAGGED
  3. Override affordance         4/10     2/10      N/A    FLAGGED
  4. Grace-zone cliff            3/10     3/10      N/A    FLAGGED
  5. Specificity                 4/10     2/10      N/A    FLAGGED
  6. Consistency                 5/10     4/10      N/A    FLAGGED
  7. Accessibility               1/10     0/10      N/A    FLAGGED
```

Both voices independently scored accessibility lowest and specificity near the
floor. Verdict: **an engineering plan wearing a design section** — the algorithm
is over-specified, the interface is one line of placeholder copy.

### Where the two voices disagreed

- **Override affordance.** Primary proposed an inline "Use 25:00 instead" link
  on the breakdown line. Subagent argues for silent application with the escape
  hatch on the existing duration button (`Colors.accent` dot when a plan is
  active) plus attribution inside the Duration modal. Subagent wins on evidence:
  it found that with F5's overlay in place, working the existing Focus stepper
  would silently do nothing — a control that appears to work and does not is
  worse than no control. Resolution: silent apply, escape hatch on the existing
  button, and touching the stepper drops the overlay for that task.

### Additional states the primary review missed

- **Estimate exhausted** (`totalTimeOnTask >= estimatedMinutes`): rail clamps to
  100%, remaining ≤ 0, plan undefined. Needs copy plus a `+30 min` affordance.
- **Tiny estimates**: see D-C3.
- **Stopwatch mode**: `mode === 'stopwatch'` makes a plan meaningless. Undefined.
- **Loading**: `selectedTask` is `tasks.find(...)`; before hydration it resolves
  null and the card reads "Select a task" — the plan UI will flash.

### Consistency: two estimate-progress bars already disagree

`tasks.tsx:388-393` (8px rail, `raised` track, `primary` fill, "X of Ym
estimated") versus `index.tsx:573-598` (6px rail, `inactive` track, `accent`
fill, bare %). The plan would add a third representation of the same concept.
Decision: reconcile the two that exist rather than add a third.

### Accessibility — concrete, not aspirational

- `StepperRow` buttons are 36×36 with no `hitSlop`; estimate stepper 42×42. Both
  under 44pt. Fix pattern already in the codebase: `hitSlop={8}` at
  `calendar.tsx:157`.
- `subtext` on `surface` is reported at ~3.5:1 dark / ~3.7:1 light, and the
  `CURRENT TASK` eyebrow composites to ~3.4:1 via `opacity: 0.5`. **These
  specific ratios are the subagent's measurement and are NOT independently
  verified** — treat as a strong lead to check, not as settled fact. If they
  hold, plan copy must use `Colors.text` at full opacity, 12px minimum.
- Segmented plan row must be `accessibilityRole="progressbar"` with
  `accessibilityValue={{min:0, max:n, now:index}}`, or it announces as N
  unlabeled views.

## D4 RESOLVED — plan from remaining

Decided: `getSessionPlan(remainingMinutes, sessionLengthMinutes)`.

`remaining = estimatedMinutes - round(totalTimeOnTask / 60)`, clamped at 0.

Both arguments changed from the brief, for reasons the brief did not have:
`remaining` (D4) so the plan agrees with the progress rail already on the card,
and `sessionLengthMinutes` (D-C2) so a user's configured block length is not
silently overruled.

### Scope this DELETES

| Dropped | Why it disappears |
|---|---|
| Persisted active plan index | The plan is derived on read, never stored |
| `timer:{userId}:planIndex` AsyncStorage key | Nothing to persist |
| "Resume at session 2, or restart at 1?" | Re-derives from remaining every time |
| "What happens when the estimate is edited mid-plan?" | Re-derives; no stale copy exists |
| Day-boundary resume semantics | Same |

Three of the plan's four original open questions are answered by this one
decision, and the fourth (where `getSessionPlan` lives) is a file-path choice.

### Newly required states

| State | Condition | Behaviour |
|---|---|---|
| Estimate exhausted | `remaining <= 0` | No plan. Rail clamps 100%. Offer `+30 min` rather than showing "0 blocks" |
| Tiny remainder | `0 < remaining < floor` | One block of `remaining`; do NOT pad up to the floor |
| No estimate | `estimatedMinutes == null` | No plan, duration untouched, provenance line reads "Your default" |

## Phase 2 — completion summary

| Item | Result |
|---|---|
| Design completeness at intake | 4/10 |
| Dimensions reviewed | 7 of 7 |
| Voices | Primary + Claude subagent. Codex `[codex-unavailable]` |
| Structural issues auto-fixed | 6 (hierarchy via the existing dots row, states matrix, override affordance, cliff communication, W-parameterization, a11y requirements) |
| Corrections to the primary review | 2 (Pass 1 superseded by D-C1; the "unreachable floor" claim was wrong) |
| Taste decisions deferred to the gate | 2 (exact copy wording; whether breaks render as discrete segments) |
| User decisions taken | 1 (D4) |
| Unverified claim carried forward | Contrast ratios — flagged as a lead to measure, not fact |

**PHASE 2 COMPLETE.** Codex: unavailable. Claude subagent: 3 critical/high
structural findings, 2 of which overrode the primary review. Consensus: 0/7
CONFIRMED (single voice), 7/7 FLAGGED. Passing to Phase 3 (Eng).

---

# GSTACK REVIEW — Phase 3: Eng

Codex: dropped at user request. Single-voice review throughout this phase.

## Step 0 — Scope challenge (grounded in the code)

| Sub-problem | Existing code | Verdict |
|---|---|---|
| Phase chaining focus -> break | `TimerPhase`, `complete()` `:208`/`:305` | Reuse unchanged |
| Where a phase's length comes from | `getPhaseDuration(phase, settings)` `:111` | **Single seam. One function to change** |
| Session count from an estimate | `tasks.tsx:609` | Replace with `getSessionPlan` |
| Configured block length | `tasks.tsx:1894` from `settings.workDuration` | Feed in as `W` |
| Sequence indicator | `index.tsx:414-438` | Becomes the plan row |
| Crash/background restore | `PersistedSession` + `reconstructSession` `:695` | **Defect — see A1** |
| Goal time stats | `loadGoalCounts` groupBy | Add one `_sum` |
| Credit cap | `sessionCredit.ts` | Must change (F3) |

Genuinely new code: one pure function, one optional state field, one render
change. Everything else is a seam that already exists.

## Section 1 — Architecture

```
  taskStore                          settings (persisted, user-owned)
  selectedTaskId                     workDuration = W
  tasks[].estimatedMinutes                 |
  tasks[].totalTimeOnTask                  |
        |                                  |
        +-------------> getSessionPlan(remaining, W)   [PURE]
                                 |
                                 v
                        activePlan (timer state, NOT persisted)
                        { sessions:[25,20,20], breaks:[...], index }
                                 |
                                 v
             getPhaseDuration(phase, settings, activePlan)  <-- the ONLY seam
                                 |
              +------------------+------------------+
              v                                     v
        start() / complete()                  reconstructSession()
        (tick logic untouched)                (rehydrate after kill)
```

Rule, inherited from the existing cycle discipline: `timerStore` reads
`useTaskStore.getState()` **at call time**, never at module scope. The static
import already exists (`timerStore.ts:4`), so no new cycle is introduced — but a
top-level read would convert a working cycle into a crash on load.

### A1 — CRITICAL: D4's "never persist" breaks restore

`reconstructSession` (`:695-716`) recomputes a running phase's length with
`getPhaseDuration(snap.currentPhase, settings)` — from **settings alone**.
`PersistedSession` carries `status`, `currentPhase`, `mode`, `startedAt`,
`elapsedAtPause`, `stopwatchElapsed`, `timeLeft`. It has no concept of a plan.

So with a 20-minute plan block running, a force-quit and relaunch reconstructs
it against `settings.workDuration` (25 min) and the timer **silently gains five
minutes**. The user is mid-session; the length changes under them.

D4 was right that the *plan* should be derived rather than stored. It does not
follow that the *currently running block's duration* can be derived — that value
is part of the running session's identity, exactly like `timeLeft`, which is
already persisted.

Fix (small, and NOT a reintroduction of the deleted plan index):

```ts
interface PersistedSession {
  ...
  phaseDurationSeconds: number | null;  // the running block's length
}
```

`reconstructSession` prefers `snap.phaseDurationSeconds` and falls back to
`getPhaseDuration(...)` when null, so every existing persisted snapshot keeps
working. One number, no index, no plan copy, no stale-plan class of bug.

Re-deriving instead was rejected: rehydration order between `taskStore` and
`timerStore` is not guaranteed, and a plan derived from a task list that has not
loaded yet yields a null plan and the same silent length change.

## Section 3 — Test diagram

`getSessionPlan` is pure, so its whole surface is unit-testable with no I/O.

| Codepath | Type | Exists? |
|---|---|---|
| Worked examples 20/30/40/50/65/100 | unit | **NO** |
| Invariant `sum(sessions) === roundedRemaining` | unit (property) | **NO** |
| Every session a multiple of 5 | unit (property) | **NO** |
| `W` = 50 -> 50-min task is 1 block, not 2x25 | unit | **NO** |
| `W` = 1 and `W` = 480 (modal bounds) | unit | **NO** |
| `remaining <= 0` -> no plan | unit | **NO** |
| `0 < remaining < 5` -> one short block, no padding | unit | **NO** |
| Floor reachable from below (est < W) | unit | **NO** |
| `getPhaseDuration` prefers plan over settings | unit | **NO** |
| `getPhaseDuration` falls back when plan null | unit | **NO** |
| Rehydrate mid-plan keeps block length (A1) | unit | **NO** |
| `creditedSeconds` with a plan shorter than W | unit | exists for the old shape; **needs new cases** |
| Session logged with plan length as `plannedDurationSeconds` | **integration, real Postgres** | **NO** |
| Goal `_sum` focus time, sessions of differing length | **integration, real Postgres** | **NO** |
| Goal stats exclude archived / other users' tasks | **integration, real Postgres** | **NO** |

Two backend routes change behaviour (session logging payload, goal counts), so
per the repo's Testing Standard both need integration tests against a real
database. Neither is optional and neither is a follow-up.

## Step 0.5 — Eng voice (single; Codex dropped at user request)

Three critical findings, all verified against the code.

### E1 — The credit bug is at `timerStore.ts:205`, and F3 proposed the wrong fix

VERIFIED, `timerStore.ts:205`:

```ts
const sessionDuration = Math.min(settings.workDuration, Math.max(0, elapsed));
```

This clamps **before anything is recorded**. `sessionDuration` then feeds
`globalTotalTime`, `incrementTaskSession`, `recordCompletedSession`, and
`actualElapsedSeconds`. The server never sees the lost time, so **no backend
change can recover it**.

F3 named `:272` and proposed raising the cap in `sessionCredit.ts`. That is
wrong twice over: it misses the line that destroys the data, and raising the cap
would weaken a deliberate forgery bound for zero benefit. `creditedSeconds` is
`min(actual, planned)` and is **correct as written** once the client sends the
right `planned`.

Why it always fires: with W-parameterization the grace zone is `[W, W+10]`, so a
block can exceed W by up to 10 minutes. A 35-minute grace block at W = 25
credits 25 — and since `remaining = estimate - totalTimeOnTask` reads the
under-credited value, **the plan never converges**. A 35-minute task reports 10
minutes remaining after the user finished it, and offers another block. The
feature's headline promise fails on its most common path.

Corrected F3: change `timerStore.ts:141`, `:205`, `:272`. Change nothing in
`sessionCredit.ts`. Forward-only; historical rows stay internally consistent.

### E2 — Audit finding A2 was FALSE: 14 write sites, not one seam

The original audit claimed this was "a substitution at `getPhaseDuration`, not
new machinery." In fact `settings.workDuration` is written straight into
`timeLeft` all over the store, bypassing `getPhaseDuration` entirely:
`timerStore.ts` lines 140, 141, 205, 272, 288, 326, 338, 380, 418, 457, 555, 742.

Worse, VERIFIED — there are two **verbatim duplicates** of the function outside
the store:

- `index.tsx:216-221` — `currentPhaseDuration`, drives the hero progress ring.
  A 20-minute plan starts the ring already 20 percent consumed.
- `useAnalytics.ts:55` — `elapsedSeconds = workDuration - timeLeft`. Live focus
  minutes jump +5 the instant Start is pressed.

Neither appears anywhere in the plan. **Prerequisite refactor, now in scope:**
collapse all three copies onto one exported function before threading the
overlay. This is the gap between the 0C-bis estimate ("one call site, ~40 min
CC") and reality.

### E3 — Freeze the overlay at `start()`; "derived on read" must not reach the running timer

D4 ("derived, never stored") is right for the *preview* and unsafe for the
*running timer*, because `getPhaseDuration` is called by `tick()` every second
(`:186`), by `pause()` (`:155`) and by `reconstructSession()` (`:708`). Deriving
there makes a running session's length a function of inputs that mutate
underneath it: `fetchTasks(true)` replaces the task array at arbitrary moments,
the user can edit the estimate or deselect the task mid-run, and a recurring
instance is archived at day rollover and vanishes from `GET /tasks`.

This supersedes my A1, which was directionally right (persist the running
block's length) but scoped too narrowly — it treated restore as the only
problem, when tick and pause have it too.

Shape:

- `planPreview` — **not state.** A `useMemo` in `index.tsx` over `selectedTask`
  and W. Drives the breakdown UI only.
- `plannedFocusSeconds: number | null` — the only new field in `TimerState`.
  Written by `start()` and by the break-to-focus branch of `complete()`; cleared
  by `reset()`, `setMode()`, `skip()`-to-idle, and the idle subscription. Added
  to `PersistedSession`, and passed into the duration call in
  `reconstructSession`.

`getPhaseDuration(phase, settings, plannedFocusSeconds)` returns
`plannedFocusSeconds ?? settings.workDuration` for focus. Tick logic untouched.

**This deletes machinery the plan budgeted for.** Because `remaining` shrinks by
the credited amount, re-deriving at each break-to-focus transition reproduces
the tail on its own: 65 gives [25,20,20]; after block 1, remaining 40 gives
[20,20]. **No plan queue, no sessions array in state, no active index.**

Also: "queue the remainder to auto-advance" cannot be built without changing the
state machine — `complete()` sets `status: 'break'` and `start()` is a required
tap. **Auto-advance is dropped**; each block is simply the next focus phase,
tapped as today.

## Failure modes registry

| # | Failure | Severity | Verified by | Fix |
|---|---|---|---|---|
| FM1 | W below 5 gives zero-length blocks, then a runaway `complete()` loop each POSTing to the server | critical | math: W=1, r=60 gives n=60, base=0 | `n = clamp(ceil(r/W), 1, floor(roundedR/5))`; assert every block >= 5 |
| FM2 | Block longer than MAX_SESSION_SECONDS makes the POST 400 and the **whole session is lost** | high | `MAX_SESSION_SECONDS = 21600` (6h); estimate stepper maxes at 480 min | Cap a block at 360 min and clamp client-side |
| FM3 | Credit clamp destroys overtime before recording; the plan never converges | critical | `timerStore.ts:205` | E1 |
| FM4 | Force-quit mid-plan restores the wrong block length; the OS alarm has already fired | critical | `PersistedSession` has no plan field | E3 |
| FM5 | Progress ring and live analytics disagree with the plan | high | `index.tsx:216-221`, `useAnalytics.ts:55` | E2 |
| FM6 | `breaks` in the return type is **uncomputable** from a two-argument signature, because the long-break rule is global (`:207-209`) | high | reasoning | Drop `breaks`; the UI reads break type from the store's own rule |
| FM7 | Goal focus time reads near-zero for any goal linked to a recurring habit | high | `goalProgress.ts:106` filters `isArchived: false` on the SESSION groupBy; spawn-recurring archives stale instances (`tasks/routes.ts:288-292`) | Drop `isArchived` from the *session* filter only |
| FM8 | Task swapped mid-run credits the time to the wrong task, poisoning its `remaining` | medium | `complete()` reads `selectedTaskId` at completion (`:245`) | Freeze `taskId` at `start()` beside `plannedFocusSeconds` |
| FM9 | Goal "elapsed days" can render negative or blank | medium | `PATCH /task-goals/:id` accepts a client `completedAt`, unvalidated | Clamp at 0; fall back to createdAt-to-now |

**FM7 is a pre-existing bug, not one this feature introduces.** Goals linked to
recurring habits already under-count `actualSessions` today. The new time stat
makes it loud rather than causing it.

## Sections 2 and 4 — code quality, performance

Code quality: the three duplicate duration implementations (E2) are the finding;
everything else in the seam is small. `TaskGoalCounts` is constructed as an
object literal in five places (`goalProgress.ts:164`, `taskgoals/routes.ts:112`,
`:136`, `:181`, and the `serializeGoal` parameter at `:66`), so adding a
required field is a five-file compile-time change — caught by the compiler,
which is good, but it is not "one line".

Performance: `getSessionPlan` is pure and O(n) in block count, n at most ~96.
`planPreview` as a `useMemo` recomputes only when the task or W changes. The
goal `_sum` rides the `groupBy` that already runs — no new query, no N+1.
Nothing here is a performance concern.

## ENG CONSENSUS

```
  Dimension                     Primary   Subagent   Consensus
  ----------------------------- --------- ---------- ---------------------------
  1. Architecture sound?        NO        NO         AGREED - overlay must freeze
  2. Test coverage sufficient?  NO        NO         AGREED - 15 of 16 uncovered
  3. Performance risks?         OK        OK         AGREED - none
  4. Security threats?          OK        NO         SUBAGENT - F3 weakened a bound
  5. Error paths handled?       NO        NO         AGREED - FM1 through FM9
  6. Deployment risk?           LOW       LOW        AGREED - forward-only
```

## Where `getSessionPlan` lives

`mobile/lib/sessionPlan.ts`. `mobile/lib/` already houses tested pure logic
(`achievementOrder`, `rank`, `recurringDisplay`, each shipping a `.test.ts`),
and `mobile/vitest.config.mts` requires zero react-native imports — which a pure
function satisfies and a store does not. That answers the last of the plan's
four original open questions.

## Honest testing limit

`timerStore.ts` imports AsyncStorage, `api`, and three other stores, so the
*riskiest* part of this change — freeze at start, persist, reconstruct — cannot
run under the current mobile vitest config. Two options: accept manual
verification and keep the store change as thin as possible, or stand up
jest-expo with AsyncStorage mocks, which is its own project.

Decision: accept manual verification, and let that constraint argue for the
scalar-not-queue design in E3. Stated here rather than left as an implied gap.

## PHASE 3 COMPLETE

Codex: dropped at user request. Claude subagent: 3 critical findings, all
verified. Two overturned earlier work in this document (A2 and F3), one
superseded my A1. Consensus: 4 of 6 AGREED negative, 1 subagent-only, 1 agreed
positive. Passing to Phase 4 (final gate).

---

# GSTACK REVIEW — Phase 4: Final gate

## Pre-gate verification — gaps found and filled

Three Phase 1 artifacts were skipped when the CEO phase halted early at the user
challenge. Produced here rather than ticked off.

### Error and Rescue Registry (CEO gap-fill)

What the user sees when it goes wrong, and how they get out. "Rescue" is the
part usually missing: an error the user cannot act on is a dead end.

| Error | User sees | Rescue |
|---|---|---|
| Estimate reached, plan empty | "Estimate reached — using your 25 min default" | `+30 min` chip on the task card, which raises the estimate in place |
| Block longer than the 6h server cap (FM2) | Nothing today — the POST 400s and the session vanishes | Clamp client-side BEFORE the timer starts, so the session can never be un-loggable. Never a post-hoc error |
| Plan disagrees with the running timer after a force-quit (FM4) | A block of the wrong length, silently | Prevented by the frozen scalar. There is no recovery UI because there must be no failure |
| Task deselected mid-run | Running timer continues unchanged | Nothing to rescue — the frozen scalar makes this a non-event. Documented so nobody "fixes" it |
| `W` set below 5 (FM1) | Runaway completion loop | Structural clamp inside `getSessionPlan`. Not a warning, a bound |
| Offline at block completion | Existing fire-and-forget queue handles it | Unchanged. The plan adds no new network dependency |
| Estimate edited mid-run | Running block unchanged; next block re-derives | This is the D4 property. No error state exists |

Design rule taken from this table: **every row is either prevented structurally
or recoverable in one tap.** No row is left as "show an error".

### Dream state delta (CEO gap-fill)

```
  CURRENT            You pick a task. The timer ignores it. You set a
                     duration by hand, or accept whatever you used last.
                     The estimate you typed shows a progress bar and
                     nothing else.

  THIS PLAN          You pick a task. The timer knows how much work is
                     left and sizes the block to it. The promise made at
                     creation time is the block you actually get.

  12-MONTH IDEAL     The day is the object. Ascend knows what you
                     committed to, what is left, and whether it fits the
                     hours you have — and tells you before you overcommit,
                     not after.
```

Delta: this plan is a step toward the ideal and does not reach it. It makes a
single task self-sizing; it does not make the day self-aware. The one piece it
deliberately leaves on the table is the projected finish time (offered as D4
option C, not taken), which is the bridge between the two.

### CEO completion summary (gap-fill)

| Item | Result |
|---|---|
| Mode | SELECTIVE EXPANSION |
| Premises named | 6, of which 4 were assumed silently |
| Premise gate | Passed — accepted with the plan made overridable |
| User challenges raised | 1 (session length) — **overruled by the user, as is their call** |
| Scope added by review | 5 fallout items, then 2 dropped by D3, then 1 prerequisite refactor added by E2 |
| Scope deleted by review | Plan queue, active index, persisted index, day-boundary resume, mid-plan-edit semantics, auto-advance, live goal migration |
| Net | The review removed more scope than it added |

## Cross-phase themes

Concerns that surfaced independently in two or more phases. These are the
high-confidence signals.

**Theme 1 — Provenance. Flagged in Phase 2 and Phase 3.** Design concluded the
screen must always say where the number came from ("Your default" vs "From this
task's plan"). Eng independently found that with the overlay live, the existing
duration stepper would silently do nothing. Two different routes to the same
defect: a number on screen whose origin the user cannot see, and a control that
appears to work and does not.

**Theme 2 — The estimate field is the bottleneck, not the algorithm. Flagged in
Phase 1 and Phase 2.** CEO named P1 (fill-rate unverified, field optional and
stepper-only). Design independently proposed turning the no-estimate case into a
`+ Add an estimate` call to action. Both concluded the splitting logic is
downstream of a field most tasks may not carry.

**Theme 3 — This codebase duplicates derived values instead of sharing them.
Flagged in Phase 2 and Phase 3.** Design found two different estimate-progress
bars for one concept (`tasks.tsx:388-393` vs `index.tsx:573-598`). Eng found
three copies of the phase-duration calculation (`timerStore.ts:111`,
`index.tsx:216-221`, `useAnalytics.ts:55`). Same disease, found twice by
reviewers who never spoke. This is the strongest structural signal in the whole
review, and it is why `getSessionPlan` must ship as one shared function rather
than a fourth copy.

## Implementation tasks

The per-phase JSONL task lists that the aggregator reads are not present — the
review phases ran inline rather than as separate skill invocations, so no
`tasks-<phase>-*.jsonl` files were written. List assembled from the findings
instead, ordered by dependency.

- [ ] **T1 (P1, human ~0.5d / CC ~15m) — prerequisite refactor.** Collapse the
  three phase-duration implementations onto one exported function.
  Files: `mobile/stores/timerStore.ts:111`, `mobile/app/(tabs)/index.tsx:216-221`,
  `mobile/store/hooks/useAnalytics.ts:55`. Blocks everything else (E2).
- [ ] **T2 (P1, human ~0.5d / CC ~20m) — `getSessionPlan`.** New pure module
  `mobile/lib/sessionPlan.ts`. Invariant `sum === roundedRemaining`, all blocks
  multiples of 5 and `>= 5`, front-loaded distribution, `null` below 5, clamp at
  360 min. Drop `breaks` from the return type (FM6).
- [ ] **T3 (P1, human ~0.5d / CC ~20m) — property + example tests** for T2.
  `mobile/lib/sessionPlan.test.ts`. The property test is what catches FM1.
- [ ] **T4 (P1, human ~1d / CC ~30m) — freeze the overlay.** Add
  `plannedFocusSeconds` to `TimerState` and `PersistedSession`; write at
  `start()` and the break-to-focus branch; clear at `reset()`/`setMode()`/
  `skip()`/idle-subscription; consume in `getPhaseDuration` and
  `reconstructSession` (E3, FM4).
- [ ] **T5 (P1, human ~0.5d / CC ~15m) — fix the credit clamp.**
  `timerStore.ts:141`, `:205`, `:272`. Do NOT touch `sessionCredit.ts` (E1, FM3).
- [ ] **T6 (P1, human ~1d / CC ~30m) — `POST /timer/complete` integration tests.**
  New file; none exists today. The planned-2100/actual-2100 case is the
  regression test for the whole feature.
- [ ] **T7 (P2, human ~1d / CC ~30m) — Focus screen UI.** Plan becomes the
  existing sequence row (`index.tsx:414-438`); provenance line; silent apply
  with the escape hatch on the existing duration button; a11y per Phase 2.
- [ ] **T8 (P2, human ~0.5d / CC ~15m) — creation preview.** `tasks.tsx:711`
  renders the shape (`2 x 20 min`), not a count. Fix the now-false
  `Based on {N}m session length` label at `:980` (F4).
- [ ] **T9 (P2, human ~0.5d / CC ~20m) — goal time stats.** `_sum` on the
  existing groupBy; widen `TaskGoalCounts` (5 construction sites); clamp elapsed
  days at 0 (FM9). Integration tests for differing session lengths.
- [ ] **T10 (P3) — deferred to TODOS.md.** FM7 pre-existing recurring-goal
  under-count; estimate fill-rate telemetry; reconcile the two progress bars;
  verify the Phase 2 contrast ratios; jest-expo for store tests.
