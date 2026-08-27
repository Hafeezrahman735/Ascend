# Goal Stats Modal — tapping a goal shows what you've done

Status: **draft, under /autoplan review**
Branch: `staging` · Base commit: `45d24c2` · Opened: 2026-08-26

---

## The ask (verbatim)

> when clicking on goals in the task tab make it also open a modal and display
> stat like: how many task completed / task for this goal, the total focus time
> and sessions and any other AI stats that will be helpful for the user to feel
> accomplished by completeing their goal. it should encourage for users to use
> the app. similar to clicking on task to show statistics of the task.

Two requirements, one explicit and one not:

1. **Explicit:** a per-goal stats modal, mirroring `TaskStatsModal`.
2. **Implicit, and the harder one:** the stats must *encourage*. A grid of six
   numbers is not encouragement. This is a motivation feature wearing an
   analytics costume, and the review has to treat it as such.

---

## Phase 0 intake — what already exists

Read before planning anything. Most of this feature is already built and
un-rendered.

### The backend already computes every number the user asked for

`backend/src/lib/goalProgress.ts:14-33` defines `TaskGoalCounts` and
`TaskGoalProgress`. `loadGoalCounts()` (`:82`) resolves them in **two grouped
queries regardless of goal count**, and `serializeGoal()`
(`backend/src/modules/taskgoals/routes.ts:53-94`) already puts all of it on the
wire from `GET /task-goals`:

| Field | Asked for? | On the wire? | Typed in mobile? | Rendered? |
|---|---|---|---|---|
| `completedTaskCount` / `linkedTaskCount` | yes | ✅ | ✅ | ✅ `goalSubMetrics()` |
| `actualSessions` | yes | ✅ | ✅ | ✅ `goalSubMetrics()` |
| `totalFocusSeconds` | yes | ✅ | ❌ **dropped** | ❌ |
| `elapsedDays` | no | ✅ | ❌ **dropped** | ❌ |
| `taskProgress` / `sessionProgress` / `overallProgress` | no | ✅ | ✅ | ✅ progress bar |

**`mobile/types/index.ts:312-338` omits `totalFocusSeconds` and `elapsedDays`.**
The server sends them, the client drops them on the floor. "Total focus time" —
one of the three things the user explicitly asked for — is already computed,
already tested, and one type field away from being displayable.

`backend/src/modules/taskgoals/stats.integration.test.ts` covers
`totalFocusSeconds` across four cases (mixed session lengths, zero, archived
tasks still counting, cross-user isolation) and `elapsedDays` across two. It
passes today.

**Consequence for scope: this feature needs no new backend route to satisfy the
three explicit stats.** Any plan that starts with "add `GET /task-goals/:id`"
is adding a route to serve data that already ships.

### Tapping a goal already does three different things

Goals render at three sites in `mobile/app/(tabs)/tasks.tsx`, each with
different tap behaviour:

| Site | Component | Line | Tapping it today |
|---|---|---|---|
| Zone 1 hero card | `GoalProgressCard` | `:1787` | `setActiveView('goal-detail')` — navigates |
| `goal-detail` list | `GoalCard` | `:2232` | opens `GoalFormModal` to **edit** |
| Zone 2 compact row | `GoalZoneRow` | `:2545` | **nothing** — plain `View` |

This is the central design problem, and the user's phrasing ("make it *also*
open a modal") does not resolve it. Site 2 already owns the tap for editing.
Adding stats there is a behaviour change, not an addition.

`TaskStatsModal` shows the resolution the codebase already chose for tasks:
**tap opens stats; edit is a secondary link in the modal footer**
(`tasks.tsx:412` — "Edit task details"). Goals should almost certainly match.

### `goal-detail` is misnamed

`ActiveView = ... | 'goal-detail' | ...` (`tasks.tsx:1887`) is not a detail view.
It is a full-screen **list** of every goal plus "This Week" and weekly
completion rate. There is no per-goal detail surface anywhere in the app today.

### The reference implementation

`TaskStatsModal` (`tasks.tsx:278-420`):
- renders in `BottomSheet` at `SCREEN_H * 0.66`
- fetches `GET /tasks/:id` on open for `analytics`, shows `—` until it lands
- has an explicit `analyticsError` state with a plain-language fallback
- 6 `StatBox` cells in a 2-col grid, two `big` and highlighted
- conditional blocks for notes, streak, lifetime focus, time progress
- footer: primary action (Load into Timer) + secondary text link (Edit)

Anything built for goals should reuse this shape, and ideally the `StatBox` and
`BottomSheet` primitives rather than re-deriving them.

### Things that do NOT exist

- No `GET /task-goals/:id` route. (The `stats.integration.test.ts` `describe`
  blocks are *named* `GET /task-goals/:id` but every test calls
  `GET /task-goals`. Misleading name; worth fixing while nearby.)
- No per-goal session history, so no per-goal chart data without new work.
- No per-goal date-bucketed time series (`TaskAnalytics.timePerDayLast7` is
  per-task only).
- `app/(tabs)/goals.tsx` is the **Profile screen**, not a goals screen. Goals
  live only in the Tasks tab. No competing surface to keep in sync.

---

## Proposed scope

### In

1. **Type the two dropped fields.** Add `totalFocusSeconds` and `elapsedDays`
   to `TaskGoal` in `mobile/types/index.ts`. Unblocks "total focus time" with
   no backend change.
2. **`GoalStatsModal`**, mirroring `TaskStatsModal`'s structure and reusing
   `BottomSheet` + `StatBox`.
3. **Make all three goal sites open it**, and move editing to a footer link,
   matching how tasks already behave.
4. **Encouragement layer** — the "AI stats" part. Derived, honest, and
   specified below rather than left to the implementer.
5. **Tests** for whatever new logic is introduced, per `CLAUDE.md`.

### Out (stated so they are decisions, not oversights)

- **No LLM call.** "AI stats" is read as *derived insight*, not *model
  inference*. A network round-trip to an LLM to tell someone they focused for
  3 hours is latency and cost for something arithmetic already answers. If the
  user wants genuine generated prose, that is a separate feature with its own
  privacy and cost surface.
- **No per-goal charts.** No time-series data exists per goal; adding it means
  a new query shape and a new route. Deferred unless review disagrees.
- **No goal-completion celebration flow.** Adjacent and tempting, but the ask
  is a stats modal. `RewardModal` and `UnlockOverlay` already exist for
  celebration and should be reused if this is ever built.

---

## Open questions for the review

- **Q1.** Does the encouragement layer earn its place, or is it decoration over
  numbers that already speak? What makes a stat *encouraging* rather than
  merely true?
- **Q2.** Site 2 currently opens the edit form. Changing it to open stats is a
  behaviour change for an existing affordance. Right call, or does it need a
  separate affordance?
- **Q3.** What does this modal show for a goal with **zero** linked tasks and
  zero sessions? That is the state where encouragement matters most and where
  a stat grid is most humiliating. The empty state may be the whole feature.
- **Q4.** Is `totalFocusSeconds` per-goal actually meaningful given the
  archived-instance caveat in `goalProgress.ts:107-117`? Recurring habits
  archive daily and every instance inherits `taskGoalId`.
- **Q5.** Should `elapsedDays` be shown at all? "You've been at this 47 days"
  is encouraging at 80% progress and demoralising at 5%.

---

<!-- Review sections appended below by /autoplan -->

# Phase 1 — CEO Review (strategy & scope)

Mode: **SELECTIVE EXPANSION**. Voices: `[subagent-only]` — Codex is not
installed on this machine, so every Codex voice in this run degrades.

## 0A — Premise challenge

Four premises sit under the ask. Only one is safe.

**P1. "Users want goal stats."** — Plausible but imprecise. Users want to feel
they are getting somewhere. Stats are one delivery vehicle for that, and not
obviously the best one. **Accepted, with the correction that stats are the
means and not the end.**

**P2. "Showing numbers makes a user feel accomplished."** — **This is the
load-bearing premise and it is false as stated.** Numbers only feel good when
they are favourable. A goal sitting at 8% with two sessions logged and 40 days
elapsed produces a stat grid that reads as an indictment. The feature as
literally specified will *demotivate* every user whose goals are going badly —
exactly the population that most needs encouragement and most needs a reason to
open the app. **Challenged. This drives the whole design.**

**P3. "It should work like the task stats modal."** — True for *interaction*,
suspect for *content*. A task is a chore; a goal is an identity claim ("become
someone who ships the thesis"). Symmetry of gesture is right. Symmetry of tone
is not. **Accepted for structure, rejected for content.**

**P4. "AI stats will help."** — Undefined, and undefined slots get filled with
whatever the implementer feels like on the day. Resolved below into *derived
insight* rather than *model inference*. **Accepted only once made concrete.**

## 0B — Existing code leverage map

| Sub-problem | Existing code | Reuse verdict |
|---|---|---|
| Tasks completed / linked | `goalProgress.ts:93-105` | Ships already |
| Sessions count | `goalProgress.ts:117-146` | Ships already |
| Total focus time | `goalProgress.ts:24`, `routes.ts:83` | **Ships already, client drops it** |
| Goal age | `routes.ts:87-89` | **Ships already, client drops it** |
| Modal chrome | `BottomSheet` (`tasks.tsx:214`) | Reuse verbatim |
| Stat cell | `StatBox` (`tasks.tsx:334-339`) | Reuse verbatim |
| Duration formatting | `formatSeconds`, `formatDuration` | Reuse verbatim |
| Deadline phrasing | `formatDeadlineLabel`, `daysUntilLocalDate` | Reuse verbatim |
| Celebration | `RewardModal`, `UnlockOverlay` | Available, out of scope |

**Nothing in the explicit ask requires a new backend route.** The build is
almost entirely a rendering job over data that already crosses the wire.

## 0C — Dream state

```
CURRENT          Goal = a bar plus "3/12 tasks, 4/10 sessions".
                 Tap does three different things depending on where you tap.
                 No history, no pace, no sense of trajectory.
                     |
THIS PLAN        Tap anywhere = the same modal. Totals become visible,
                 including the two fields the client currently throws away.
                 One honest line of interpretation.
                     |
12-MONTH IDEAL   A goal is a narrative with an ending. The app knows you are
                 60% through "Ship the thesis", 41 hours in over 6 weeks, and
                 that your current pace lands you 9 days late — and it offers
                 to schedule the sessions that close the gap. Finishing
                 produces a moment worth screenshotting into the Circle feed.
```

**Delta:** this plan builds the *display* layer and neither the *projection*
nor the *celebration* layer. Of those two, projection is nearly free here —
`elapsedDays` plus `overallProgress` yields a naive pace forecast with no new
data — and celebration is not.

## 0E — Temporal interrogation

| Horizon | What happens | Verdict |
|---|---|---|
| Hour 1 | Taps a goal, sees six numbers. Mild interest. | Fine |
| Day 1 | Taps again. Identical numbers. | Interest drops |
| Week 1 | Numbers moved, but nothing shows that they moved | **Problem** |
| Month 1 | Goal done: modal says nothing special. Goal stalled: modal quantifies the stall | **Problem** |

**This is the sharpest strategic finding. Totals are a one-time read; deltas
and forecasts are a repeat read.** A modal built purely on cumulative totals
gets opened twice per goal and then never again — which fails the user's actual
stated requirement ("encourage users to use the app") while appearing to
satisfy the literal one. That is the six-month regret.

## 0C-bis — Implementation alternatives

| # | Approach | Files | Effort (human / CC) | Completeness | Verdict |
|---|---|---|---|---|---|
| A | Type 2 fields + stat grid modal | ~4 | ~0.5d / ~20m | 6/10 | Satisfies the letter, fails "encourage" |
| B | A + derived encouragement (pace, momentum), client-side only | ~6 | ~1.5d / ~45m | 8/10 | **Recommended** |
| C | B + per-goal time-series route and charts | ~9 | ~3d / ~2h | 9/10 | New route and test for a chart nobody asked for |
| D | Reframe as goal-completion celebration | ~8 | ~3d / ~2h | 7/10 | Answers the *why* but not the *what* |

**Decision: B.** P1 (completeness) says do the whole thing; P2 (boil lakes)
scopes "the whole thing" to the blast radius, and per-goal time-series sits
outside it — new query shape, new route, new test file, for a visualisation
nobody asked for. B honours the real requirement using only data that ships.

## 0D — Scope decisions

| Item | Decision | Principle | Rationale |
|---|---|---|---|
| Type `totalFocusSeconds` + `elapsedDays` | **In** | P2 | 2 lines, in blast radius, unblocks an explicit requirement |
| `GoalStatsModal` reusing `BottomSheet`/`StatBox` | **In** | P4 | Reuse, do not re-derive |
| Unify tap behaviour across all 3 sites | **In** | P1 | Otherwise half of them stay dead |
| Derived encouragement line | **In** | P1 | The actual requirement |
| LLM-generated commentary | **Out** | P3, P5 | Latency, cost and privacy to say what arithmetic already says |
| Per-goal charts / time series | **Out** | P2 | Outside blast radius; new route |
| Goal-completion celebration | **Out** | P2 | Adjacent feature; `RewardModal` exists when it is built |
| Fix the habit/goal count asymmetry (F1) | **See gate** | — | Pre-existing defect this feature makes visible |

## Section 2 — Error & Rescue Registry

| # | Failure | User sees | Rescue | Status |
|---|---|---|---|---|
| E1 | Goal has 0 tasks, 0 sessions | A grid of zeros | Dedicated empty state, never a zeroed grid | **Must build** |
| E2 | Goal stalled (low % and high elapsedDays) | "8%, 47 days" | Suppress elapsed framing below a progress floor | **Must build** |
| E3 | Goal data stale in the store | Numbers behind reality | Refetch on open, as `TaskStatsModal` does | Must decide |
| E4 | Habit-linked goal | Contradictory counts | Pre-existing; see F1 | **Open** |

## Failure Modes Registry

| # | Mode | Severity | Fix | Status |
|---|---|---|---|---|
| **F1** | **Habit-linked goal reports oscillating progress.** `loadGoalCounts` filters `isArchived: false` for task counts (`goalProgress.ts:95`) but deliberately does not for sessions (`:117-123`). A goal linked to a recurring habit counts only today's live instance in `linkedTaskCount` while counting every session ever in `actualSessions` and `totalFocusSeconds`. It renders as "0/1 tasks, 47 sessions, 23h focus", and `taskProgress` swings between 0 and 1 daily. | **High** | Out of scope here; must be surfaced | **Pre-existing — GATE** |
| F2 | Encouragement line reads as sarcasm on a failing goal | High | Progress floor before any pace claim | Must build |
| F3 | Modal opened from `GoalCard` steals the existing edit gesture | Medium | Footer edit link, matching `TaskStatsModal:412` | Must build |
| F4 | `elapsedDays` demoralises | Medium | Render only above a progress floor | Must build |

**F1 is the important one.** This feature does not cause it, but this feature
is what makes it legible: today a habit-linked goal shows a slightly wrong
progress bar; after this change it shows a self-contradicting stat grid.

## What is NOT in scope

- LLM inference of any kind
- Per-goal time-series data or charts
- Goal-completion celebration flow
- Fixing F1 (surfaced, not fixed — see gate)
- Any change to `computeProgress`'s 50/50 weighting

## Step 0.5 — Dual voices

**CODEX SAYS (CEO — strategy challenge):** `[codex-unavailable]` — the `codex`
binary is not installed on this machine. This phase ran `[subagent-only]`.

### CLAUDE SUBAGENT (CEO — strategic independence)

Nine findings. The three that change the plan:

1. **CRITICAL — the moment of accomplishment already fires and is not
   celebrated.** `goalProgress.ts:196-227` auto-completes a goal, awards
   `GOAL_COMPLETION_XP`, emits `FEED_CREATE` and emits `TASK_GOAL_COMPLETED`
   carrying `completedTaskCount`, `linkedTaskCount`, `actualSessions`,
   `targetSessions`, `progressMode`. On mobile this surfaces only as a
   `RecentActivity` row (`RecentActivity.tsx:22,44`) rendered with `limit={4}`
   — the same visual weight as "Focused 25m", and pushed out of the list by the
   very sessions that completed the goal. `RewardModal.tsx` is dead code, zero
   call sites. Building the report card while skipping the graduation is the
   defining error of the plan.
2. **HIGH — "no per-goal time series" is factually wrong.** `tasks.tsx` already
   holds full session history in state, and the records carry `taskId`.
3. **HIGH — `totalFocusSeconds` will contradict the card it sits on** for
   habit-linked goals. (Independently found here as F1.)

Also: stats are a *pull* surface reaching only the already-engaged; no
instrumentation or kill criterion is planned; `elapsedDays` should be typed but
rendered only on completed goals; a six-cell grid differentiates against
nothing (Forest sells an artifact, Streaks a chain, Habitica loss aversion,
Todoist Karma a trend, Sunsama a ritual — none a grid); keep long-press→edit as
an escape hatch since `GoalCard` is currently the only edit affordance.

### Verification of the subagent's load-bearing claims

Both were checked against the code rather than accepted.

| Claim | Verdict | Detail |
|---|---|---|
| `RewardModal` is dead code | **CONFIRMED** | Zero call sites outside its own definition |
| Goal completion is unhandled on mobile | **CORRECTED — narrower** | It *is* handled, twice: a push notification (`index.ts:188`, `notifications/handler.ts:171`) and a `RecentActivity` row. What is missing is an in-app moment at the transition, not all handling |
| Per-goal time series needs no backend work | **CONFIRMED** | `SessionRecord` (`store/sync.ts:6-13`) carries `taskId`, `completedAt`, `durationSeconds`, `type`; `Task` carries `taskGoalId`. The join is client-side |
| Consuming `TASK_GOAL_COMPLETED` on mobile needs "only a client subscriber" | **WRONG** | `index.ts:188-190` wires it to `handleAllNotifications` **only** — unlike `SESSION_COMPLETED` (`:182`) and `FRIEND_SESSION_STARTED` (`:199`), it never reaches `handleSocialBroadcast(io, ...)`. There is no socket transport for it. The reframe needs a backend wiring change plus a client socket handler, plus an integration test per `CLAUDE.md` |

### New finding, from verifying claim #2 — F5

A client-side per-goal chart joins sessions to goals **through the client's
`tasks` array**, which excludes archived tasks. The server's `totalFocusSeconds`
deliberately **includes** archived-instance sessions (`goalProgress.ts:107-116`).
So a sparkline built this way would **undercount**, and its total would not
equal the "Total focus" stat printed on the same card. Two numbers, same
surface, different universes — the same class of defect as F1 and produced by
the fix for it. Any chart must either reuse the server total or be labelled as
a different measure.

## CEO consensus table

```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                             Claude  Codex  Consensus
  ─────────────────────────────────────────────────────────────
  1. Premises valid?                     NO      N/A   FLAGGED
  2. Right problem to solve?             NO      N/A   FLAGGED
  3. Scope calibration correct?          NO      N/A   FLAGGED
  4. Alternatives explored enough?       NO      N/A   FLAGGED
  5. Competitive/market risks covered?   NO      N/A   FLAGGED
  6. 6-month trajectory sound?           NO      N/A   FLAGGED
═══════════════════════════════════════════════════════════════
Codex unavailable, so nothing can be CONFIRMED by agreement.
Every dimension is a single-voice finding and flagged regardless.
```

**Both voices independently reached the same conclusion on the load-bearing
premise (P2) and on the six-month regret**, having started from different
prompts — the primary review flagged "totals are a one-time read, deltas are a
repeat read", the subagent flagged "we spent the goal-motivation budget on a
screen users had to go find". Same defect, different words. That is the
strongest signal in this phase, and it is not weakened by Codex's absence.

## Dream state delta — revised

The plan builds the display layer. The subagent's finding shows the
**celebration layer is not a future phase — it is already 80% built on the
server and thrown away on the client.** `TASK_GOAL_COMPLETED` carries exactly
the numbers this modal wants to show, fires at exactly the moment they mean
most, and has no consumer.

## Phase 1 gate — decisions

Two questions went to the user; neither was auto-decided.

| # | Question | Decision | Consequence |
|---|---|---|---|
| D1 | Feature shape, given both voices challenged the stated direction | **Modal first, then celebration** | The user's literal ask ships first. The stats panel is extracted as a component and reused as the body of a goal-completion overlay. Same end state as the subagent's inversion, better build order: the panel is iterable in isolation instead of only visible by finishing a goal. Rejected the inversion partly because its stated cost ("only a client subscriber") was verified false — `TASK_GOAL_COMPLETED` has no socket transport |
| D2 | Pre-existing habit-linked goal defect (F1) | **Label the stat, record the fix** | The modal is honest about what it counts. The progress-semantics fix is separate work — it changes what a goal's progress *means* for every habit-linked goal, which is a bigger decision than this feature |

---

# Phase 2 — Design Review

Voices: `[subagent-only]`. Design completeness of the plan as written: **3/10** —
it names a modal and reuses two primitives, and specifies no content, no
hierarchy, and none of the six states this screen can be in.

## Pass 1 — Information hierarchy (2/10 as planned)

The plan inherits `TaskStatsModal`'s hierarchy: title, then a six-cell grid.
**That hierarchy is wrong for a goal.**

A task's first question is "how much have I done on this?" — a grid answers it.
A goal's first question is **"am I going to finish this?"**, and its second is
"was the effort worth it?" A grid answers neither; it makes the reader do the
arithmetic that produces the feeling.

Corrected order:

```
1  Title + tag                      what is this
2  Progress + what remains          am I going to finish
3  EFFORT LINE  (the lead)          "14h 20m across 34 sessions"
4  Stat grid                        supporting detail, not the headline
5  Footer: primary CTA + edit link  what do I do now
```

Item 3 is the accomplishment. It is a sentence, not a cell, because
"14h 20m across 34 sessions" is a story and `[14h 20m]` in a box is a
measurement.

## Pass 2 — Missing states (1/10 as planned)

The plan specifies **none** of these. Six exist:

| State | Reachable when | Specified? | Matters |
|---|---|---|---|
| Loading | — | n/a | **Not needed.** Unlike `TaskStatsModal`, which fetches `GET /tasks/:id`, every goal number is already in the store from `GET /task-goals`. No fetch, no spinner, no error state. A real simplification the plan missed |
| **Empty** | 0 tasks, 0 sessions | ❌ | **Highest.** The most likely goal to tap is the one you just made, and a grid of zeros is the worst possible first impression |
| Healthy | progress > 0 | ❌ | The happy path |
| **Near-done** | progress ≥ 75% | ❌ | The highest-leverage nudge in the feature |
| **Stalled / overdue** | low progress, deadline passed | ❌ | Where naive design does active harm |
| Completed | `isCompleted` | ❌ | Should read as a trophy, not a report |

## Pass 3 — Emotional arc, three users

**A — 90% done.** "11 of 12 tasks · 23h 10m across 51 sessions · one task left."
Works. The modal should close with a CTA on the remaining task. This user is
one tap from a win and the screen should know it.

**B — 40% done.** "5 of 12 · 9h 40m across 21 sessions." Works *if* the effort
line leads. If the grid leads, this user reads "40%" and feels behind.

**C — 5%, deadline passed 12 days ago.** Naive design shows
`1/20 tasks · 40m · 5% · 47 days elapsed · OVERDUE`. Every one of those is true
and the combined message is *you have failed at this*. This user is the whole
reason the feature exists and the literal spec drives them away.

What C should see: the 40 minutes that **did** happen, framed as real; no
elapsed-days, no pace, no forecast, no red overdue badge as the headline; one
low-friction action — reschedule the deadline, or start a session now.

**Rule extracted:** *never render a stat whose only possible reading is an
accusation.* Elapsed days, pace and forecast are all conditionally-safe stats.
Effort and count are unconditionally safe.

## Pass 4 — Specificity (2/10)

An implementer handed this plan must invent: which stats appear, in what order,
the copy for every state, the thresholds that switch between them, whether
`elapsedDays` renders, what the empty state says, what the primary CTA does per
state, and the sheet height. That is the whole design.

## Pass 5 — The encouragement layer, as concrete copy

Derived, deterministic, no model call. Every input already ships.

**Effort line** — always, when `actualSessions > 0`:
> `14h 20m of focus across 34 sessions`
> `about two full working days`

The second line converts to a relatable unit (÷ 8h). Only render it above 4h;
below that it is noise.

**Share of a life** — when this goal is ≥ 10% of `gamificationStore.totalFocusMinutes`:
> `18% of all the focus you have ever logged went here`

Free, already in the store, and genuinely encouraging because it is about
identity rather than pace.

**Closing nudge** — `progress ≥ 0.75`:
> `One task left.` / `2 tasks to go.`

**Empty state** — `linkedTaskCount === 0 && actualSessions === 0`:
> `Nothing logged here yet.`
> `Link a task and start a session — this is where the hours will show up.`
> `[ Link tasks to this goal ]`

**Completed:**
> `Finished in 23 days.`
> `14h 20m across 34 sessions to get here.`

`elapsedDays` appears **only** in this state, which resolves Q5: it is a
celebration stat, never a progress stat.

**Never rendered:** pace, forecast, elapsed-days on an in-flight goal, or any
comparison to other goals.

## Pass 6 — Interaction model

Unified: **tap opens stats everywhere**; edit becomes a footer link, matching
`TaskStatsModal:412`.

Cost, honestly: `GoalCard` (`tasks.tsx:2232`) is currently the *only* edit
affordance for a goal, and its tap is being taken. Mitigation is two-layered —
the footer link, plus retaining **long-press → edit** on `GoalCard`, a gesture
the file already uses on goal tags (`onLongPressTag`). Users who learned
tap-to-edit lose one tap and gain a screen.

## Pass 7 — Design system consistency

Reuse `BottomSheet` and `StatBox` verbatim. `TaskStatsModal` uses
`SCREEN_H * 0.66`; the goal modal carries a lead line plus a grid plus a state
block, so it wants `0.75`, still clamped by `SHEET_MAX_H`.

`StatBox` takes `Colors` as a prop rather than calling `useTheme()` — awkward,
but matching it is right. Changing that signature is a separate refactor.

## Design Step 0.5 — Dual voices

**CODEX SAYS (design — UX challenge):** `[codex-unavailable]`.

### CLAUDE SUBAGENT (design — independent review)

Converged with the primary review on the central call — the grid is the wrong
lead, deadline-passed is unhandled, `elapsedDays` belongs only on completed
goals, tap=stats / long-press=edit — having started from the plan alone. It then
found four things the primary review missed, all since verified in the source.

**D1 — CRITICAL, and the sharpest finding in this phase.
`taskProgress = completedTaskCount / linkedTaskCount` (`goalProgress.ts:55-56`),
so linking a new task to a goal makes its percentage go DOWN.** The app
punishes the exact behaviour it wants to encourage: planning more work. A task
cannot do this to you; a goal can. Leading a "feel accomplished" screen with
that ratio is therefore actively hostile, and it is a much stronger argument for
demoting the percentage than the primary review's "grids are boring".

Corollary the subagent draws well: **total focus time is monotonic — it can
never go down whatever the user does. That is what makes it the safe hero
numeral**, not merely the interesting one.

**D2 — CRITICAL. A fixed six-cell grid regresses `progressMode`.**
`goalSubMetrics()` (`tasks.tsx:1392-1402`) already hides the tasks half for a
`'sessions'` goal and the sessions half when `targetSessions` is null. A grid
copied from `TaskStatsModal` has no such conditional, so a sessions-only goal
renders "0/0 tasks" and a tasks-only goal renders "4/— sessions". Cells must be
built from the same conditional, and the grid must be 2-4 cells, not 6.

**D3 — HIGH. `onGoalPress: () => void` (`tasks.tsx:1527`) carries no goal id.**
It currently navigates to the list, so it never needed one. Opening a modal for
a *specific* goal requires changing the signature to `(goalId: string) => void`.
The list route survives via `ZoneHeader`'s "See more" (`:2533`).

**D4 — MEDIUM. `GoalCard`'s tap is the only path to DELETE, not just edit.**
`onDelete` lives inside `GoalFormModal` (`tasks.tsx:1009-1017`), which is only
reachable from that tap. Taking the tap for stats buries destroy two levels
deep. Also `accessibilityLabel={'Edit goal …'}` (`:2229`) would then lie to
VoiceOver.

**D5 — "Stalled" is not free.** `TaskGoal` carries no `lastSessionAt`, so a
stalled state needs the client-side `sessionHistory` join — which the primary
review independently flagged as F5 (it excludes archived instances and so
disagrees with the server's `totalFocusSeconds`). Two voices, same defect.

**Disagreement — which bad state matters most.** The primary review ranked the
**empty** state highest (most likely goal to tap is the one you just made). The
subagent ranks **deadline-passed** highest, and argues it better: "Zero is
quiet; overdue is loud." The card already renders an overdue deadline in `ROSE`
(`:1436-1439`), so the modal opens with a red label above near-zero cells.
**Resolved in the subagent's favour** — P1, completeness: both must be built,
and overdue is the one that does active harm rather than merely disappointing.

## Design consensus table

```
DESIGN DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                             Claude  Codex  Consensus
  ─────────────────────────────────────────────────────────────
  1. Information hierarchy right?        NO      N/A   FLAGGED
  2. All states specified?               NO      N/A   FLAGGED
  3. Emotional arc holds for all users?  NO      N/A   FLAGGED
  4. Plan specific enough to build?      NO      N/A   FLAGGED
  5. Encouragement layer defined?        NO      N/A   FLAGGED
  6. Interaction model coherent?         NO      N/A   FLAGGED
  7. Design-system consistent?           YES     N/A   FLAGGED (pass)
═══════════════════════════════════════════════════════════════
Codex unavailable; nothing CONFIRMED by agreement.
Both voices independently reached the same verdict on 1, 2, 3, 5 and 6.
```

**Design score after both voices: plan as written 3/10, plan as revised 8/10.**

## Revised hierarchy, merging both voices

```
1  Title + tag
2  Deterministic status line          the encouragement, priority-ordered
3  Progress bar + milestone dots      reuse tasks.tsx:1554-1562
4  HERO: total focus time             monotonic, therefore safe to lead
5  2-4 stat cells, progressMode-gated reuse the goalSubMetrics conditional
6  Footer: Start a session / Edit
```

The status line (2) sits above the bar deliberately: it is the only element
that can reframe a bad number before the user reads it.

## Adopted copy — the subagent's, over the primary review's

Priority-ordered, first match wins, with its three rules: every line contains a
number from *this* goal; no adjectives about the user, ever; below 25% or past
deadline the line ends in an **action**, never an assessment.

| # | Condition | Line |
|---|---|---|
| 1 | Completed | `Done. 14 tasks, 22 sessions, 9h 40m of focus.` |
| 2 | No linked tasks | `Nothing linked yet — link a task and this starts tracking.` + *Link a task* |
| 3 | Tasks, no sessions | `3 tasks waiting. One 25-minute session gets this moving.` |
| 4 | First session | `First session logged. That's the hardest one.` |
| 5 | Deadline passed | `Past the deadline, 6 of 12 done. Move the date or cut the scope.` + *Change deadline* |
| 6 | Stalled ≥ 7 days | `Last session 11 days ago. 6 of 12 done, 6 to go.` |
| 7 | On pace | `6 of 12 done with 9 days left — this pace finishes early.` |
| 8 | Behind pace | `6 of 12 done, 9 days left. Two sessions a week closes it.` |
| 9 | No deadline | `9h 40m banked across 14 sessions.` |

Rows 5, 6 and 8 are why this cannot read as sarcasm: they never praise, and
they always hand the user something to do.

**Kept from the primary review:** the *share-of-a-life* stat — "18% of all the
focus you have ever logged went here", from `gamificationStore.totalFocusMinutes`
(`:14`), free and about identity rather than pace. Slot it as a stat cell, not
in the status line.

**Dropped from the primary review:** the "about two full working days"
conversion. It adds a second sentence for no new information, and violates the
subagent's rule that every line carry a number from *this* goal.

# Phase 3 — Eng Review

## Section 0 — Scope challenge (read against the code, not the plan)

`tasks.tsx` is **2603 lines**. `GoalStatsModal` plus its states adds roughly
200 more. `CLAUDE.md` says "avoid large files" and "extract reusable UI
components", so inline is the wrong answer — but extraction is not free,
because `BottomSheet` (`:214`) and `StatBox` (`:262`) are both **local to
tasks.tsx** and consumed by `TaskStatsModal`.

Three options, and the plan picks none of them explicitly:

| Option | Cost | Verdict |
|---|---|---|
| Inline in `tasks.tsx` | 0 new files, file grows to ~2800 | Rejected — P5, the file is already the problem |
| Duplicate `BottomSheet`/`StatBox` into the new component | 0 refactor risk, 2 copies of each | Rejected — P4, DRY |
| **Extract `BottomSheet` + `StatBox` to `components/`, then build `GoalStatsModal` beside them** | 3 files moved/created, `TaskStatsModal` re-imports | **Chosen** — P2, blast radius, mechanical |

Note there are already **two** different `StatBox` implementations —
`tasks.tsx:262` (icon, label, value, sub, big, `Colors` prop) and
`app/user/[id].tsx:19` (label, value only). **Do not try to unify them.** They
have different shapes for different surfaces; merging is a separate refactor and
would triple this blast radius for no user-visible gain.

## Section 1 — Architecture

```
                    mobile/lib/goalStats.ts          <- NEW, pure, Node-testable
                    (status line, cell gating, pace)
                              |
     components/StatBox.tsx   |   components/BottomSheet.tsx
        (extracted)           |        (extracted)
              \               |               /
               \              |              /
            components/goals/GoalStatsModal.tsx   <- NEW
                              |
                    app/(tabs)/tasks.tsx
                    /         |          \
        GoalProgressCard   GoalCard   GoalZoneRow
          (:1527)          (:1448)      (:1403)
                              |
                    stores/goalStore.ts  <- goal read live by id
```

`TaskStatsModal` keeps working by importing the two extracted primitives
instead of defining them. No behaviour change, no new dependency direction.

## Section 2 — Where the derived logic lives

**`mobile/lib/goalStats.ts` + `mobile/lib/goalStats.test.ts`**, following the
precedent this repo already set with `lib/calendarItems.ts` / `.test.ts` — pure
logic pulled out of a `.tsx` specifically so the Node-only vitest config can
reach it. That extraction was forced last time by exactly this constraint; reuse
the pattern rather than rediscovering it.

Exports:

- `goalStatusLine(goal, ctx): { text, action? }` — the priority-ordered copy
- `goalStatCells(goal): CellSpec[]` — `progressMode`-gated, 2-4 cells
- `shareOfLifetimeFocus(goal, totalFocusMinutes): number | null`
- `goalPace(goal, now): { onTrack: boolean, sessionsPerWeekNeeded: number } | null`

No react-native import anywhere in the file.

## Section 3 — Edge cases

| Case | Behaviour | Risk |
|---|---|---|
| `linkedTaskCount === 0` | Server guards: `linkedTaskCount > 0 ? ratio : 0` (`goalProgress.ts:55-56`) | Safe server-side. **Client must not divide again** |
| `targetSessions === null` | `sessionProgress` is `null` (`:58-61`) | Cells must handle `null`, not render `4/—` |
| `deadline === null` | `daysUntilLocalDate` returns `null` | Status rows 5, 7, 8 must be skipped, not rendered with `null` |
| `progressMode === 'sessions'`, 0 tasks | Would render `0/0 tasks` | **Must reuse the `goalSubMetrics` conditional (`:1392-1402`)** |
| **`elapsedDays === 0`** | Pace = `actualSessions / (elapsedDays / 7)` → **division by zero → `Infinity`** | **Real bug. Must guard — this is the day-one state for every new goal** |
| `elapsedDays === 0` on a completed goal | "Finished in 0 days" | Special-case to "Finished today" |
| 200 linked tasks | Counts only, no row transfer | Fine |
| Goal deleted while modal open | See §5 | **Crash risk** |

## Section 5 — State management

`TaskStatsModal` takes a **snapshot object** (`statsTask` holds the whole `Task`).
Copying that shape inherits its defect: the modal shows stale data if the goal
changes underneath, and holds a dangling object if the goal is deleted.

**`GoalStatsModal` should take a `goalId` and select from `goalStore` live**, so
completing a task updates the numbers behind the open sheet. When the selector
returns `undefined` — goal deleted, or archived from another surface — the modal
must close, not render `undefined.title`.

This is a deliberate divergence from the reference implementation and should be
commented as one, or the next reader will "fix" it back.

## Section 6 — Hidden complexity

1. **The `onGoalPress` signature change ripples.** `(: () => void)` →
   `(goalId: string) => void` touches `GoalProgressCard` (`:1527`), the
   `HeroCard` prop bag (`:1732-1736`), the `case 'goal_progress'` dispatch
   (`:1787`), and the call site (`:2471`). Four edits for what reads in the plan
   as "make it open a modal".
2. **`now` during render.** The status line is time-dependent (overdue, stalled,
   pace). Computing `new Date()` during render trips `react-hooks/purity`, held
   at `warn` in `eslint.config.js:64`. The repo already hit this in
   `PlanningView` and resolved it by passing `now` in as a plain value rather
   than memoising it — do the same, do not add a 22nd warning.
3. **Three call sites, three prop paths.** Only `GoalZoneRow` is a clean win.
4. **The extraction is the real work.** Moving `BottomSheet` and `StatBox` is
   mechanical but touches the file everything else in this tab lives in.

## Section 3 (Tests) — test diagram

| Codepath / flow | Type | Exists? | Action |
|---|---|---|---|
| `goalStatusLine` — all 9 branches | unit | ❌ | **Write.** One case per row, plus precedence between overlapping conditions |
| `goalStatusLine` — `elapsedDays === 0` | unit | ❌ | **Write.** The divide-by-zero guard |
| `goalStatCells` — `'tasks'` / `'sessions'` / `'both'` | unit | ❌ | **Write.** Pins the D2 regression |
| `goalStatCells` — `targetSessions === null` | unit | ❌ | **Write** |
| `shareOfLifetimeFocus` — zero lifetime | unit | ❌ | **Write.** Another divide-by-zero |
| Modal closes when goal disappears | unit | ❌ | **Write** if extractable; otherwise manual |
| `GET /task-goals` returns the two fields | integration | ✅ | `stats.integration.test.ts` already covers it |
| Server/client type drift | contract | ❌ | **None exists.** See below |

**No backend change is required, so `CLAUDE.md`'s integration-test mandate is
not triggered by this feature.** State that explicitly rather than leaving it
ambiguous.

**Drift is the uncovered risk.** The whole reason this feature is cheap is that
the server has been sending two fields the client silently dropped — nothing
caught it, and nothing would catch the reverse. There is no contract test
between `serializeGoal` (`routes.ts:53-94`) and `TaskGoal`
(`types/index.ts:312`). Out of scope to build here; worth recording, because it
is the defect class that created this opportunity.

## Eng Step 0.5 — Dual voices

**CODEX SAYS (eng — architecture challenge):** `[codex-unavailable]`.

### CLAUDE SUBAGENT (eng — independent review)

Converged with the primary review on extraction, on `lib/goalStats.ts`, on
live-from-store instead of a snapshot, and on the `progressMode` gating. Then
found four things the primary review missed — including the highest-severity
finding in the whole run.

**A6 — HIGH, and the best finding in this phase. The goal cache is unversioned,
so this feature ships a visible regression to every existing user.**
`readCachedGoals` (`goalStore.ts:18-26`) does an unchecked
`JSON.parse(raw) as TaskGoal[]`, and `hydrateGoals` (`:60-65`) seeds the UI from
it before any fetch. Cached goals written by the current build have no
`totalFocusSeconds`. `formatSeconds(undefined)` (`tasks.tsx:87-90`) computes
`Math.floor(undefined / 3600)` → `NaN`, fails the `h > 0` branch, and returns
the literal string **`"NaNm"`**.

**Verified by reading all three functions.** Every user with a warm goals cache
would open the app after this update and see `NaNm` where their focus time
should be, until the network fetch lands. Fix: default at the read boundary
(`?? 0`) or declare the new fields optional — not both, or the optionality
spreads through every consumer.

**A critical unit bug — in the primary review's own design proposal.**
`totalFocusSeconds` is **seconds**; `gamificationStore.totalFocusMinutes` is
**minutes** (`gamificationStore.ts:81`: `Math.floor(totalFocusTime / 60)`). The
"share of a life" stat as specified in Phase 2 divides one by the other and is
therefore **wrong by a factor of 60**. It also divides by zero for a new user
(`gamificationStore.ts:61`). Both must be fixed, or the stat cut. Caught by the
independent voice, not by the review that proposed it — which is the argument
for running these at all.

**A2 — MEDIUM.** `formatSeconds` (`:87`) and `formatDuration` (`:91`) are
already near-duplicate formatters. The Phase 1 leverage map says "reuse
verbatim", which is **not possible across a file boundary** — both are
unexported locals, exactly like `BottomSheet` and `StatBox`. Move `formatSeconds`
into the new lib module and import it back, or the extraction produces a third
copy.

**A7 — MEDIUM.** `createGoal` (`goalStore.ts:87-105`) hand-builds a complete
`TaskGoal` literal for its optimistic row. Adding required fields breaks that
build. TypeScript catches it, but "add 2 lines to `types/index.ts`" is really
three files.

**A8 — MEDIUM, and it contradicts Phase 2.** The long-press→edit escape hatch
that the design phase recommended **collides with the existing `onLongPressTag`
handler on the same card** (`tasks.tsx:1448`, `:2233`). Two overlapping
long-press regions on one card.

**A3 — MEDIUM.** No contract test exists between `serializeGoal`
(`routes.ts:53-94`, an untyped object literal) and `TaskGoal`
(`types/index.ts:312`); `goalStore.fetchGoals` calls `api.get<TaskGoal[]>` with
no runtime validation. Nothing catches drift — which is exactly how these two
fields got dropped in the first place. Cheap fix inside the blast radius: give
`serializeGoal` an explicit exported return type and add one key-set assertion
to the existing integration test.

**Confirms the no-backend-change claim.** `serializeGoal` already emits both
fields and `stats.integration.test.ts` already asserts them
(`:74`, `:86`, `:104`, `:124`, `:144`, `:159`). No route changes, so
`CLAUDE.md`'s integration-test mandate is **not triggered**. Both voices agree.

## Cross-phase conflict — resolved

| | Phase 2 (design) | Phase 3 (eng) |
|---|---|---|
| Escape hatch for edit | Keep long-press→edit on `GoalCard` | Long-press already taken by `onLongPressTag` |

**Eng wins on the fact; design keeps the concern.** Long-press is genuinely
occupied. Resolution: **footer link only**, matching `TaskStatsModal:412`
exactly. The cost design identified is real and is accepted rather than
dismissed — deleting a goal moves from two levels deep to three
(tap → stats → edit → delete). Deleting a goal is rare and irreversible, so
additional depth is a feature, not a regression. `accessibilityLabel` at
`:2229` must still change from "Edit goal …" to "View goal …".

## Eng consensus table

```
ENG DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                             Claude  Codex  Consensus
  ─────────────────────────────────────────────────────────────
  1. Architecture sound?                 NO      N/A   FLAGGED
  2. Test coverage sufficient?           NO      N/A   FLAGGED
  3. Performance risks addressed?        YES     N/A   FLAGGED (pass)
  4. Security threats covered?           YES     N/A   FLAGGED (pass)
  5. Error paths handled?                NO      N/A   FLAGGED
  6. Deployment risk manageable?         NO      N/A   FLAGGED
═══════════════════════════════════════════════════════════════
Codex unavailable; nothing CONFIRMED by agreement.
Dimensions 1, 2, 5 failed in BOTH voices independently.
Dimension 6 fails on A6 alone — a single-voice critical, flagged regardless.
```

Performance passes on both voices for the same reason: counts are grouped
server-side (`goalProgress.ts:93-125`), two queries regardless of goal count,
and nothing added here iterates task rows. Security passes because no new route,
no new input, and every query is already `userId`-scoped.

## Revised test plan

| # | What | Level | Why |
|---|---|---|---|
| T1 | `goalStatusLine` — all 9 branches + precedence | unit | The feature's whole content |
| T2 | `goalStatusLine` — `elapsedDays === 0` | unit | Divide-by-zero → `Infinity` |
| T3 | `goalStatCells` — `'tasks'` / `'sessions'` / `'both'` | unit | Pins the D2 regression |
| T4 | `goalStatCells` — `targetSessions === null` | unit | Renders `4/null` otherwise |
| T5 | `shareOfLifetimeFocus` — unit conversion **and** zero denominator | unit | The 60× bug |
| T6 | Formatters given `undefined` | unit | **A6 — the `"NaNm"` regression** |
| T7 | `GET /task-goals` emits both fields | integration | ✅ already exists |
| T8 | Key-set contract assertion on `serializeGoal` | integration | A3 — closes the drift class |

T8 is the only backend-touching item and it is an assertion added to an existing
test, not a new route.

---

# APPROVED PLAN — implementation order

Gate decisions: D1 modal-first · D2 label-not-fix F1 · D3 fix-and-keep the
share stat · D4 include pace, action-framed only · D5 approved, implement.

## Step 1 — Types and the cache regression (A6)

`mobile/types/index.ts` — add to `TaskGoal`, **required**, not optional:

```ts
/** Credited focus seconds across every session on this goal's tasks. */
totalFocusSeconds: number;
/** Wall-clock days from creation to completion, or to now while open. */
elapsedDays: number;
```

`mobile/stores/goalStore.ts` — **normalise at the cache read boundary.**
`readCachedGoals` casts unvalidated JSON to `TaskGoal[]`, so a cache written by
the previous build has neither field and `formatSeconds(undefined)` renders the
literal string `"NaNm"` to every existing user on first launch. Defaulting here
rather than making the fields optional keeps the `?? 0` in one place instead of
spreading optionality through every consumer.

`createGoal`'s optimistic literal (`:87-105`) also needs both fields at 0 (A7).

## Step 2 — `mobile/lib/goalStats.ts` + `.test.ts`

Pure, no react-native import, following the seven existing `lib/*.test.ts`.

- `goalStatusLine(goal, now)` — 9 branches, priority-ordered, first match wins
- `goalStatCells(goal)` — 2-4 cells, gated by `progressMode` exactly as
  `goalSubMetrics` (`tasks.tsx:1392-1402`) does
- `shareOfLifetimeFocus(goal, totalFocusMinutes)` — **converts seconds→minutes**
  and returns `null` when the denominator is 0
- `goalPace(goal, now)` — returns `null` when `elapsedDays < 1` or no deadline
- `formatSeconds` moves here from `tasks.tsx:87` and is imported back

Copy rules: every line carries a number from *this* goal; no adjectives about
the user; below 25% or past deadline the line ends in an action.

## Step 3 — Extract the primitives

`components/BottomSheet.tsx` and `components/StatBox.tsx`, moved verbatim from
`tasks.tsx:214` and `:262` with `SCREEN_H`/`SHEET_MAX_H`/`MONO`.
`TaskStatsModal` imports them back — no behaviour change. Do **not** unify with
the different `StatBox` in `app/user/[id].tsx:19`; separate refactor.

## Step 4 — `components/GoalStatsModal.tsx`

Hierarchy: title+tag → status line → progress bar with milestone dots → hero
focus-time numeral (monotonic, therefore safe to lead) → gated stat cells →
footer (Start a session / Edit goal details).

Takes a **`goalId`**, selects live from `goalStore`, closes when the goal
disappears. Deliberately unlike `TaskStatsModal`'s frozen snapshot — comment it
so it does not get "fixed" back. No fetch, no spinner, no error state: every
number already arrives with `GET /task-goals`.

F1 label (D2): the focus-time cell is captioned "all time, every instance" so
it does not silently contradict the task count on habit-linked goals.

## Step 5 — Wire the three sites

- `GoalProgressCard` (`:1527`): `onGoalPress` becomes `(goalId: string) => void`;
  ripples to `HeroCard` props (`:1732-1736`), dispatch (`:1787`), call site (`:2471`)
- `GoalCard` (`:2225-2231`): tap → stats; `accessibilityLabel` changes from
  "Edit goal …" to "View goal …"; edit moves to the modal footer. **No
  long-press hatch** — `onLongPressTag` already owns that gesture (A8)
- `GoalZoneRow` (`:2545`): wrap the plain `View`; pure gain
- Mount `GoalStatsModal` **once** at the top-level return, not twice (A5)

## Step 6 — Backend (the only backend change)

Give `serializeGoal` an explicit exported return interface and add one key-set
assertion to `stats.integration.test.ts` (T8, A3). No route changes, so
`CLAUDE.md`'s new-route integration-test mandate is not triggered — this closes
the drift class that dropped these two fields in the first place. Fix the two
`describe` names that say `GET /task-goals/:id`, a route that does not exist.

## Deferred to TODOS.md

- **F1** — habit-linked goals count today's task but every session ever
  (`goalProgress.ts:95` vs `:117-123`). Labelled here, not fixed
- **Goal-completion celebration** — `TASK_GOAL_COMPLETED` (`goalProgress.ts:219`)
  carries the exact numbers this modal shows, fires at the moment they mean
  most, and has **no client transport**: `index.ts:188` wires it to
  notifications only, never `handleSocialBroadcast`. `RewardModal.tsx` is dead
  code. This is the next feature, and the stats panel is built to be its body
- **No contract test** between `serializeGoal` and `TaskGoal` beyond T8's key-set
- **Two `StatBox` implementations** (`tasks.tsx:262`, `app/user/[id].tsx:19`)
- **Per-goal charts** — possible client-side from `SessionRecord.taskId`, but
  the join excludes archived instances and so would disagree with the server's
  `totalFocusSeconds` (F5)

## Implementation tasks

- [ ] **T1 (P1, human ~1h / CC ~10m) — types + cache** — add both fields; normalise in `readCachedGoals`; fix `createGoal`'s literal. Files: `types/index.ts`, `stores/goalStore.ts`
- [ ] **T2 (P1, human ~4h / CC ~25m) — `lib/goalStats.ts` + tests** — status line, cell gating, share stat, pace, `formatSeconds`. Files: `lib/goalStats.ts`, `lib/goalStats.test.ts`
- [ ] **T3 (P2, human ~1h / CC ~10m) — extract primitives** — Files: `components/BottomSheet.tsx`, `components/StatBox.tsx`, `app/(tabs)/tasks.tsx`
- [ ] **T4 (P1, human ~4h / CC ~30m) — the modal** — Files: `components/GoalStatsModal.tsx`
- [ ] **T5 (P1, human ~2h / CC ~20m) — wire three sites** — Files: `app/(tabs)/tasks.tsx`
- [ ] **T6 (P2, human ~1h / CC ~10m) — contract assertion + describe names** — Files: `backend/src/modules/taskgoals/routes.ts`, `stats.integration.test.ts`
- [ ] **T7 (P3, human ~15m / CC ~5m) — TODOS.md** — record the five deferrals
