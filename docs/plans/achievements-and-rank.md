<!-- /autoplan restore point: /c/Users/hafee/.gstack/projects/Hafeezrahman735-pomodoro-app/staging-autoplan-restore-20260818-001919.md -->
# Ascend — Profile Achievements Row, Achievements System, Rank Redesign

Status: DRAFT — plan-first, no implementation. Under `/autoplan` review.

## Intent

Three linked pieces of work, sequenced. The user's stated constraint: small phases,
confirm each phase boundary before moving on. UI copy standardizes on
**"Achievements"** — "awards" and "achievements" are the same system, achievements wins.

- **Task 1** — Profile tab: a horizontal Achievements row below "Current Rank", with a
  "View All" entry point, and the user's Posts section moved below it.
- **Task 2** — Design the Achievements system: data model, reusable unlock-criteria
  evaluators, a tiered difficulty curve, retention framing, monetization stance,
  server-authoritative unlock checks.
- **Task 3** — Design Rank properly: composite formula, tier structure distinct from XP
  level, decay-vs-monotonic call, leaderboard interaction, schema changes.

Tasks 2 and 3 are design documents to review and approve. Task 1 is a component/file
plan that cannot be finalized until the tier system from Task 2 is settled, because the
row renders "highest tier first".

## What already exists (verified in repo)

**Achievements — a working system, missing the concepts this plan needs.**

- `backend/prisma/schema.prisma:142` — `Achievement { id, title, description, icon,
  category, key (unique), threshold, xpReward }`. **No tier/difficulty field.** A single
  `threshold: Int` is the only criteria data, so every unlock rule must be expressible as
  one number.
- `backend/prisma/schema.prisma:156` — `UserAchievement { userId, achievementId,
  unlockedAt, isShared }`, unique on `[userId, achievementId]`. **No progress column** —
  progress toward a locked achievement is computed, never stored.
- `enum AchievementCategory { STREAK, SESSIONS, FOCUS_TIME, LEVEL, TASKS }`
  (`schema.prisma:416`). **No social category**, though Task 2 asks for social milestones.
- `backend/prisma/seed.ts` — 31 seeded achievements across those 5 categories.
- `backend/src/lib/achievementCatalogue.ts` — catalogue is loaded into memory once at
  boot and served from RAM; `loadAchievementCatalogue()` is warmed in `index.ts`.
- `backend/src/modules/achievements/handler.ts` — unlock checking already runs
  server-side off the `SESSION_COMPLETED` eventBus event. Server-authoritative already;
  Task 2 extends it rather than introducing it.
- The old client-side hardcoded achievement list (`mobile/lib/achievements.ts`) has been
  deleted, so there is no longer a competing client catalogue to reconcile.

**Rank — exists, but the formula is XP-only and duplicated across the stack.**

- `mobile/lib/rank.ts` — 5 tiers (Rookie/Steady/Elite/Legend/Champion) at
  0/1000/2500/5000/10000 XP, derived from `User.xp` alone.
- `backend/src/modules/social/routes.ts:26` — `getRankTitle(xp)` hardcodes **the same
  five thresholds again**, and stamps `authorRank` onto every post and leaderboard row.
  The file comment in `rank.ts` already warns these must not drift. Any Task 3 formula
  change must collapse this duplication or it will drift on the first edit.
- `mobile/lib/badges.ts` — a separate per-tag bronze/silver/gold badge system computed
  **client-side** from `task.sessionsOnTask`. A third progression concept alongside Level
  and Rank; Task 3 should say whether it survives.
- "Current Rank" renders at `mobile/app/(tabs)/goals.tsx:890` — the Profile surface is
  the Goals tab, not a file named profile.

## Task 1 — Profile Achievements row (component plan)

Insertion point is `mobile/app/(tabs)/goals.tsx` immediately after the Current Rank
block at `:890`.

Proposed files:
- `mobile/components/achievements/AchievementsRow.tsx` — new. Horizontal `ScrollView` of
  achievement tiles, sorted highest-tier-unlocked first. Section header with a
  right-aligned "View All".
- `mobile/components/achievements/AchievementTile.tsx` — new. One tile: icon, tier ring,
  locked/unlocked state.
- `mobile/app/achievements.tsx` — new route for "View All", grouped by category and tier.
  Registered in `mobile/app/_layout.tsx` alongside the existing `achievement/[id]` modal.
- Reuse the deterministic-hash styling pattern from `getTagColor`/`getTagIcon` for tile
  icon/color rather than hardcoding per achievement.

Open questions this plan must answer before building:
- Navigation shape for "View All" — dedicated screen vs modal. `_layout.tsx` already
  registers `achievement/[id]` as a modal and `settings` as a modal, so both patterns
  exist in the codebase.
- Is "locked but nearly there" highlighting in scope for v1, or v2? It requires progress
  data that `UserAchievement` does not currently store.
- Posts section below the row: confirm this is a reorder of an existing component vs a
  new one, and whether moving it changes what data the screen must fetch.

## Task 2 — Achievements system design (to be produced)

Must cover: data model (tier + criteria-type fields, progress storage), a small reusable
set of criteria evaluators rather than per-achievement logic, a 4-tier difficulty curve
(Day 1-3 / Week 1 / Weeks 2-4 / Month+) with 5-8 achievements per tier, which
achievements are near-term hooks vs long-term retention, monetization stance (default:
entirely free — core loop and social sharing stay free as acquisition drivers), and the
endpoint list with server-side authoritative unlock checks.

## Task 3 — Rank design (framework only, no copy)

Must cover: a composite formula (XP + consistency + volume) that cannot be gamed by one
metric, a tier/sub-level structure visually distinct from XP level, a decay-vs-monotonic
recommendation with tradeoffs, how leaderboard sorting relates to rank, and the schema
change needed (cached `rank` column vs computed on read) — including how to remove the
duplicated threshold table between `mobile/lib/rank.ts` and `social/routes.ts`.

## Constraints carried from CLAUDE.md and repo patterns

- Optimistic updates for unlock writes, following `taskStore`/`goalStore`.
- Backend owns computed stats; do not recompute analytics client-side.
- `StyleSheet.create()` via a factory called through `useMemo` inside components.
- Every new route needs an integration test before it is considered done.
- Two-state dark/light theme, Deep Focus Midnight default.

---

# PHASE 1 — CEO REVIEW (via /autoplan, mode: SELECTIVE EXPANSION)

Voices: Claude subagent only. `[codex-unavailable: binary not found]`.

## 0A. Premise Challenge — 4 premises did not survive

| Premise (implied by brief) | Verdict | Evidence |
|---|---|---|
| Unlock checking must be made server-authoritative | **Already true** | `achievements/handler.ts` unlocks off the `SESSION_COMPLETED` eventBus event |
| Backend endpoints need building | **2 of 3 exist** | `GET /achievements`, `GET /achievements/:userId`, `PATCH /achievements/:id/share` |
| Progress data needs a new column | **Not needed** | `serializeAchievement()` already returns `currentValue` + `progress` (0-1) per achievement, computed from live stats |
| Rank is gameable and needs a composite formula | **Wrong defect** | Nothing is gamed at <20 testers. Real defect: Rank and Level are the same `User.xp` at two resolutions, and thresholds are hardcoded twice (`mobile/lib/rank.ts`, `social/routes.ts:26`) |

**Gate outcomes (user-confirmed, not auto-decided):**
1. Task 3 becomes *de-duplicate first, then differentiate*. Composite formula only if redundancy persists after.
2. Task 1 ships on a **server-derived** tier band (from existing `category` + `threshold`). No migration in v1.
3. Scale is **<20 testers**. Retention design is therefore a hypothesis, not a response to observed drop-off.

**Consequence — the brief's own open question is resolved: "locked but nearly there" is IN scope for v1 and is free.** `progress` is already on the wire; the row can render a near-completion ring with no backend work at all.

**Also settled by existing code:** achievements are already monotonic — never revoked when a streak resets (`routes.ts` comment). Task 3's decay-vs-monotonic question therefore has a precedent to match, not an open choice to invent.

## 0B. Existing Code Leverage

| Sub-problem | Existing code | Build or reuse |
|---|---|---|
| List achievements w/ lock state | `GET /achievements` + `serializeAchievement` | **Reuse as-is** |
| Progress toward locked achievement | `achievementProgress(category, stats)` | **Reuse as-is** |
| Unlock detection | `achievements/handler.ts` on eventBus | **Reuse**, extend criteria |
| Catalogue read performance | `achievementCatalogue.ts` (in-memory, warmed at boot) | **Reuse** |
| Share an achievement | `PATCH /achievements/:id/share` + social feed read | **Reuse** — surface in UI, do not rebuild |
| Rank tier from XP | Duplicated in `rank.ts` + `social/routes.ts:26` | **Collapse to one source** |
| Per-tag badges | `mobile/lib/badges.ts`, client-computed | **Decide fate** — 3rd progression concept |

## 0C. Dream State

```
  CURRENT                          THIS PLAN                    12-MONTH IDEAL
  3 progression concepts     -->   row surfaces achievements    One legible progression.
  (Level, Rank, badges)            using data already served;   Achievements = discrete
  from 1 XP number;                Rank stops being a second    proof of specific acts.
  thresholds duplicated;           copy of Level;               Rank = social standing,
  achievements invisible           badges get a verdict         earned differently to XP.
  on the profile
```

## 0C-bis. Implementation Alternatives

**APPROACH A — Derived-tier row only.** Compute tier band server-side from `category`+`threshold`; build row + View All. Effort S (human ~2d / CC ~45m). Risk Low. Completeness 6/10. Reuses the entire existing endpoint. Con: tier is inferred, not authored.

**APPROACH B — Full rebuild.** `tier` + `criteriaType` + `criteriaValue` + progress storage + criteria evaluators + rank composite + leaderboard rework. Effort XL (human ~3w / CC ~1.5d). Risk High. Completeness 10/10. Con: blocked behind migration-baseline work; nothing ships for weeks; designs unvalidated at <20 testers.

**APPROACH C — Sequenced: derived v1 → authored schema → rank de-dup.** Three independently shippable phases. Effort M total, S per phase. Risk Low-Med. Completeness 9/10. Reuses everything in A plus the `0_init` baseline plan already drafted this session.

**RECOMMENDATION: C.** Highest completeness per unit of risk, and the only option that does not couple Task 1 to unresolved migration debt. Matches the user's explicit preference for small sequenced phases with a confirmation at each boundary. `[auto-decided: P1 completeness + P2 blast radius, reinforced by stated user preference]`

## 0D. SELECTIVE EXPANSION — cherry-pick candidates

| # | Expansion | Effort | Auto-decision | Principle |
|---|---|---|---|---|
| E1 | Collapse duplicated rank thresholds into one shared source | S | **ACCEPT** — becomes the core of Task 3 | P4 DRY |
| E2 | Give `badges.ts` (3rd progression) an explicit keep/kill verdict | S | **ACCEPT** into Task 3 as a decision, not code | P5 explicit |
| E3 | Surface the existing share-on-unlock capability in the row | S | **TASTE** — real retention hook, but widens Task 1 | P2 blast radius |
| E4 | Local notification on unlock | M | **TASTE** — strongest near-term retention lever in the set | P6 bias to action |
| E5 | `AchievementCategory.SOCIAL` enum value | S | **DEFER** to Phase 2 — needs an enum migration | P2 outside radius |
| E6 | Authored `tier` + `criteriaType` columns | M | **DEFER** to Phase 2 — behind migration baseline | P2 outside radius |
| E7 | Integration tests for new achievement routes | S | **ACCEPT** — CLAUDE.md requires it per new route | P1 completeness |

**E7 carries a hard dependency:** the backend integration harness exists but is blocked on the local Postgres password in `backend/.env.test`. No new route can meet the project's own definition of done until that is unblocked.

## 0E. Temporal Interrogation

```
  HOUR 1  How is the tier band derived, and where? (Answer: server-side in
          serializeAchievement, so the client never infers tiers.)
  HOUR 2-3 What does the row show when zero achievements are unlocked? A new
          user sees an empty row on day one — the exact moment retention matters.
  HOUR 4-5 Does "View All" refetch, or reuse the row's payload? GET /achievements
          already returns the full catalogue, so refetching is waste.
  HOUR 6+  What happens to the Posts section's fetch when it moves below the row?
```

## 0F. Mode

**SELECTIVE EXPANSION** with **Approach C**. `[auto-decided per /autoplan override]`

## Step 0.5 — Dual Voices

**CODEX SAYS (CEO — strategy challenge):** `[codex-unavailable: binary not found]`

**CLAUDE SUBAGENT (CEO — strategic independence):** 9 findings, 3 critical. Verified against the repo before acceptance:

| # | Finding | Sev | Verified? |
|---|---|---|---|
| C1 | Plan contradicts `docs/ascend-pivot-ai-organizer-positioning.md:39` — "Social and gamification get **reframed, not rebuilt**" | CRITICAL | **YES** — quote is verbatim; Phase 5 of that doc is "accountability surfaced inside the plan" |
| C2 | Premise is unfalsifiable: no telemetry to measure retention | CRITICAL | **YES** — no PostHog/Amplitude/Mixpanel/Segment in either package.json; no event model in schema |
| C3 | Retention lever is re-entry (scheduled push), not reward depth | CRITICAL | **YES** — zero matches for cron/scheduler/setInterval/bullmq in `backend/src`. Push pipeline exists (expo-server-sdk) but nothing ever fires it |
| H1 | Task 3 solves a population problem at n<20; correct move is subtraction | HIGH | Consistent with premise gate outcome |
| H2 | Product-level alternatives never enumerated (AI Quick Capture, Live Activity, tag breakdown) | HIGH | **YES** — both plans exist in `docs/`, neither compared |
| H3 | Monetization stance is a company decision made inside a feature spec | HIGH | **YES** — no RevenueCat/IAP/paywall anywhere in repo |
| M1 | Generic criteria-evaluator framework is premature | MEDIUM | **YES** — `handler.ts:84` `BEHAVIOURAL_KEYS` is a 5-key Set skipped by the generic threshold loop. Two mechanisms already cover 31 achievements |
| M2 | Competitors never named; nothing in Task 2/3 is defensible | MEDIUM | Judgment, accepted |
| M3 | Task 1's dependency on Task 2 is self-inflicted — sort by `unlockedAt` desc and ship | MEDIUM | **YES** — and `goals.tsx` is 1523 lines, so inserting at :890 violates the repo's own file-size standard |

### CEO DUAL VOICES — CONSENSUS TABLE
```
  Dimension                             Claude   Codex   Consensus
  ───────────────────────────────────── ──────── ─────── ──────────
  1. Premises valid?                    NO       N/A     single-voice
  2. Right problem to solve?            NO       N/A     single-voice
  3. Scope calibration correct?         NO       N/A     single-voice
  4. Alternatives explored?             NO       N/A     single-voice
  5. Competitive/market risks covered?  NO       N/A     single-voice
  6. 6-month trajectory sound?          PARTIAL  N/A     single-voice
```
Missing voice = N/A, not CONFIRMED. Single critical finding from one voice is flagged regardless.

## USER CHALLENGE (raised early — see rationale)

The plan as briefed conflicts with a strategy document already committed to this repo.
Sections 1-11 and Phases 2-3 are **paused pending this decision**, because reviewing
architecture and design for Tasks 2-3 is wasted work if the pivot deletes them.

**RESOLUTION (user, 2026-08-18):** Pivot is ON HOLD. Proceed as briefed on all three
tasks. `docs/ascend-pivot-ai-organizer-positioning.md` marked accordingly. The
re-entry/scheduler reframe is **noted, not actioned** — recorded below as the
highest-value adjacent work, not added to scope.

---

## Sections 1-11 — Deep Review

### Section 1: Architecture

```
  MOBILE                                    BACKEND
  ┌──────────────────────────┐              ┌────────────────────────────┐
  │ (tabs)/goals.tsx  1523L  │              │ achievements/routes.ts     │
  │  ├─ Current Rank  :890   │              │  ├─ GET /achievements      │
  │  ├─ AchievementsRow  NEW │─────────────▶│  │   serializeAchievement()│
  │  │   └─ AchievementTile  │   HTTP       │  │   + deriveTier()   NEW  │
  │  └─ Posts (moved below)  │              │  ├─ GET /achievements/:id  │
  └──────────┬───────────────┘              │  └─ PATCH /:id/share       │
             │ router.push                  └──────────┬─────────────────┘
             ▼                                         │ reads
  ┌──────────────────────────┐              ┌──────────▼─────────────────┐
  │ app/achievements.tsx NEW │              │ achievementCatalogue.ts    │
  │  (View All, grouped)     │              │  (in-memory, warm at boot) │
  └──────────────────────────┘              └────────────────────────────┘
```

**A1 — Two consumers, one payload.** Row and View All both need the full catalogue.
`GET /achievements` already returns all 31 rows with progress. **Auto-decided:** single
fetch in `gamificationStore`, both surfaces read from it. Refetching on View All would
recompute per-user stats server-side for data the client already holds. `[P3 pragmatic]`

**A2 — Coupling.** Deriving tier in `serializeAchievement()` couples presentation
ordering to the API. **Justified** — CLAUDE.md says the backend owns computed stats, and
it keeps one tier definition instead of two. `[P4 DRY]`

**Scaling:** catalogue is 31 static rows served from RAM. `loadAchievementStats(userId)`
is the per-request cost and is unchanged by this plan. Nothing breaks at 100x of 20 users.

**Rollback:** v1 is additive (one derived response field plus new UI). `git revert`, no
migration, no data change. Reversibility 5/5.

### Section 2: Error and Rescue Map

```
  CODEPATH                    | WHAT CAN GO WRONG          | HANDLED?
  ----------------------------|----------------------------|----------
  deriveTier(category,thresh) | unknown category enum      | N <- GAP
  GET /achievements (client)  | offline / timeout          | Y (errorKind, added earlier)
  GET /achievements (client)  | 500                        | Y (errorKind: server)
  Row render                  | zero unlocked achievements | N <- GAP (design, not error)
  View All navigation         | route not registered       | N <- GAP
```

**E1 — GAP: unknown category.** `deriveTier` must have an explicit `default:` returning
the lowest tier, not `undefined`. An achievement added later with a new category would
otherwise sort as `undefined` and land unpredictably. **Auto-decided:** explicit default
plus a `console.warn` naming the unmapped key. `[P5 explicit]`

**E2 — GAP: empty vs failed is indistinguishable.** A new user with zero unlocks and a
user whose fetch failed both render an empty row. This is the exact silent-failure class
this section exists to catch. **Auto-decided:** the row branches on the `errorKind` field
added to `apiRequest` earlier this session — offline/timeout/server renders a retry
affordance, genuinely-empty renders the day-one empty state. `[P1 completeness]`

### Section 3: Security and Threat Model

Examined: new attack surface, authorization on the reused endpoints, IDOR on
`/achievements/:userId`, input validation on the new route param.

**No new attack surface in v1** — no new endpoints, no new user input, no new secrets,
no new dependencies. The one authorization question worth checking resolved clean:
`achievements/routes.ts:93-107` already scopes cross-user reads, returning 404 for
unknown users and **403 when `privacySetting === 'private'`**. Threat: low likelihood,
low impact, already mitigated.

One note for Phase 2: `PATCH /achievements/:id/share` flips a boolean that surfaces into
the social feed. If the row exposes a share control, that becomes a one-tap path from
private achievement to public feed. Confirm the copy makes the visibility change obvious.

### Section 4: Data Flow and Interaction Edge Cases

```
  INTERACTION        | EDGE CASE                    | HANDLED? | FIX
  -------------------|------------------------------|----------|---------------------------
  Row render         | zero unlocked (day 1)        | N <- GAP | design empty state (S11)
  Row render         | all 31 unlocked              | Y        | horizontal scroll
  Row render         | fetch in flight              | N <- GAP | skeleton, not spinner
  Tile tap           | double-tap -> 2 modals       | N <- GAP | guard, as _layout does
  Unlock while open  | row is stale                 | N <- GAP | refetch on focus
  View All           | back nav loses scroll        | N        | acceptable
```

**D1 — Unlock while the screen is open.** Achievements unlock server-side off the
session-completed event. The profile row will not know. **Auto-decided:** refetch on tab
focus, matching the pattern just added to the calendar tab. Do NOT add a socket for this.
`[P3 pragmatic, P5 explicit]`

### Section 5: Code Quality

**Q1 — `goals.tsx` is 1523 lines.** Adding a section at `:890` deepens a file that
already violates the CLAUDE.md standard on large files and large components.
**Auto-decided:** extract the Current Rank block and the new row into components as part
of Task 1, rather than inserting inline. In blast radius, under a day. `[P2 boil lakes]`

**Q2 — Tier bands must exist exactly once.** The repo already has this bug in the rank
thresholds (duplicated `rank.ts` / `social/routes.ts:26`). Repeating it for tiers would
be the same mistake twice. **Auto-decided:** tier bands live server-side only; the client
receives a tier and never computes one. `[P4 DRY]`

**Q3 — Do not build the criteria-evaluator framework in Phase 2.** `handler.ts:84`
already covers 31 achievements with a threshold loop plus a 5-key behavioural set. A
generic evaluator for ~40 static rows is premature abstraction. **Auto-decided:** extend
the existing switch; revisit only when a rule genuinely resists it. `[P5 explicit, P6]`

### Section 6: Test Review

```
  NEW UX FLOWS:        profile row render; tile tap -> detail; View All open
  NEW DATA FLOWS:      deriveTier() inside serializeAchievement
  NEW CODEPATHS:       tier band mapping; row empty/error/loading branches
  NEW BACKGROUND JOBS: none
  NEW INTEGRATIONS:    none
  NEW ERROR PATHS:     E1 unknown category; E2 empty-vs-failed
```

| Item | Test type | Exists? | Spec |
|---|---|---|---|
| `deriveTier` | Unit | No | `deriveTier.test.ts` — every category, boundary thresholds, unknown category to lowest tier |
| Response contract | Integration | No | assert `GET /achievements` returns `tier` for all 31 seeds |
| Row states | Component | **Not possible** | `mobile/vitest.config.mts` documents component rendering as deliberately out of scope |

**T1 — CRITICAL DEPENDENCY.** CLAUDE.md requires an integration test for every new route
before it counts as done. v1 adds no new route but *changes the contract of an existing
one*, which warrants the same coverage. The backend integration harness was built earlier
this session and is **blocked on the local Postgres password in `backend/.env.test`**.
Until that is supplied, no backend work in this plan can meet the project's own
definition of done. `[flagged, not auto-decidable]`

**2am-Friday test:** the response contract test — it catches a tier mapping that silently
returns undefined for a category someone adds later.

### Section 7: Performance

Examined N+1s, payload size, indexes, caching. `deriveTier` is O(1) per achievement over
31 in-memory rows, which is immeasurable. No new queries, no new indexes, no new
connections. The single-fetch decision in A1 avoids a duplicate
`loadAchievementStats(userId)` per View All open, which is the only non-trivial cost on
this path. No issues found.

### Section 8: Observability

**O1 — Zero.** No Sentry, no structured logging, `morgan` disabled in production. A tier
mapping returning undefined, or an unlock that fails to fire, is invisible. This is the
same gap identified earlier this session and is not this plan's to fix — but it means the
day-one verification for this feature is "open the app and look". **Auto-decided:** defer
to the existing observability work item; do not expand this plan. `[P2 outside radius]`

### Section 9: Deployment and Rollout

v1 has **no migration** (per premise gate). The response gains a field; older clients
ignore unknown JSON keys, so old-app/new-server is safe. New-app/old-server would render
tiers as undefined, mitigated by the E1 default. Rollout: deploy backend first, then ship
the app. Rollback: revert, no data implications. Post-deploy check: `GET /achievements`
returns `tier` on all 31 rows.

Phase 2 (authored `tier` column) is the risky one and is gated behind the `0_init`
migration baseline. That sequencing is already the plan.

### Section 10: Long-Term Trajectory

**L1 — The derived tier is visible and will change.** If v1 *labels* tiers ("Gold"),
Phase 2 authored tiers may re-tier achievements and a user sees their Gold become Silver.
Achievements are monotonic by design in this codebase, so a visible downgrade breaks that
promise. **Auto-decided:** v1 uses tier for **ordering only**, with no visible tier label.
Labels land with authored tiers in Phase 2. `[P5 explicit — highest-value finding in this
section]`

Debt introduced: one throwaway mapping function. Reversibility 5/5. The 1-year question:
a new engineer reading `deriveTier` needs a comment saying it is provisional and why.

### Section 11: Design and UX

```
  GOALS TAB (profile)
  ┌─────────────────────────┐
  │ Current Rank            │  <- unchanged
  ├─────────────────────────┤
  │ Achievements  [View All]│  <- NEW: horizontal, highest-tier-unlocked first
  │ (*) (*) (*) (~) ( ) ( ) │     (~) = near-completion ring (progress already on wire)
  ├─────────────────────────┤
  │ Your Posts              │  <- moved below
  └─────────────────────────┘
```

| State | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Row | skeleton tiles | **day-one copy** | retry affordance | tiles sorted | scrolls |

**U1 — The empty state is the most important pixel in this plan.** A new user with zero
unlocks sees this row on day one, which is exactly the moment retention is won or lost.
An empty row actively signals "you have nothing". **Auto-decided:** the empty state shows
the nearest *locked* achievements with their progress rings, turning an empty shelf into
a visible next goal. The data for this is already on the wire. `[P1 completeness]`

**U2 — "locked but nearly there" is IN for v1** (the brief listed this as possibly-v2).
`progress` is already returned per achievement, so the near-completion ring costs no
backend work. `[P1 completeness]`

Recommend `/plan-design-review` for the row visual treatment — queued as Phase 2 of this
pipeline.

## Required Outputs — Phase 1

### NOT in scope

| Item | Why deferred | Where it went |
|---|---|---|
| Authored `tier` / `criteriaType` columns | Needs the `0_init` migration baseline first | Phase 2 of this plan |
| `AchievementCategory.SOCIAL` enum value | Enum change needs a migration | Phase 2 of this plan |
| Generic criteria-evaluator framework | Premature for 31 static rows; `handler.ts` already covers them with a loop plus 5 special cases | Rejected outright (P4/P5) |
| Composite rank formula | Premise did not survive; the defect is redundancy, not gameability | Replaced by de-duplication (Task 3 revised) |
| Monetization / premium gating | Company-level pricing decision, not a feature spec's call; no IAP infrastructure exists in the repo | Struck from this plan |
| Backend scheduler + streak-at-risk push | Highest-value adjacent work per the CEO voice; user chose "note, do not act" | TODOS.md |
| Sentry / structured logging | Already an open work item from earlier this session | Existing plan `eager-tumbling-fog.md` |
| Live Activity, AI Quick Capture, tag time breakdown | Product alternatives never compared against this brief | TODOS.md |

### Failure Modes Registry

| # | Failure mode | Visible? | Severity | Mitigation | Status |
|---|---|---|---|---|---|
| F1 | `deriveTier` returns undefined for an unmapped category | No — sorts unpredictably | HIGH | Explicit `default:` to lowest tier plus warn log | Auto-decided (E1) |
| F2 | Row empty because fetch failed, not because user has nothing | No — looks identical | HIGH | Branch on `errorKind` from `apiRequest` | Auto-decided (E2) |
| F3 | Achievement unlocks while profile is open; row goes stale | No | MEDIUM | Refetch on tab focus | Auto-decided (D1) |
| F4 | Phase 2 authored tiers re-tier achievements; user sees a visible downgrade | Yes — and it breaks the monotonic promise | HIGH | v1 uses tier for ordering only, no visible label | Auto-decided (L1) |
| F5 | Contract change ships with no integration test | No | HIGH | Blocked on `.env.test` Postgres password | **UNRESOLVED — user action** |
| F6 | Unlock never fires; nobody finds out | No | MEDIUM | No observability exists | Deferred (O1) |

### Completion Summary — CEO

| Dimension | Result |
|---|---|
| Mode | SELECTIVE EXPANSION, Approach C (sequenced) |
| Premises challenged | 4 of 5 did not survive; user gate resolved all three consequential ones |
| Sections run | 11 of 11 |
| Findings | 13 auto-decided, 1 unresolved (F5), 1 user challenge (resolved: pivot on hold) |
| Expansions accepted | E1 rank de-dup, E2 badges verdict, E7 integration tests |
| Expansions deferred | E5 social enum, E6 authored tier columns |
| Expansions rejected | Criteria-evaluator framework (premature), composite rank formula (wrong defect) |
| Critical gap | F5 — the project's own definition of done is unreachable while `.env.test` lacks a password |

## Implementation Tasks

- [ ] **T1 (P1, human: ~2h / CC: ~15m) — backend/achievements** — Add `deriveTier(category, threshold)` to `serializeAchievement`, with explicit default for unmapped categories
  - Surfaced by: ceo-review — E1, Q2
  - Files: backend/src/modules/achievements/routes.ts
- [ ] **T2 (P1, human: ~1d / CC: ~45m) — mobile/profile** — Extract Current Rank into a component and add `AchievementsRow` + `AchievementTile` below it, sorted by tier then unlockedAt
  - Surfaced by: ceo-review — Q1, U1
  - Files: mobile/app/(tabs)/goals.tsx, mobile/components/achievements/
- [ ] **T3 (P1, human: ~3h / CC: ~20m) — mobile/profile** — Row states: skeleton, day-one empty state showing nearest locked achievements, error retry via `errorKind`
  - Surfaced by: ceo-review — E2, U1, U2
  - Files: mobile/components/achievements/AchievementsRow.tsx
- [ ] **T4 (P2, human: ~4h / CC: ~30m) — mobile/navigation** — `app/achievements.tsx` View All screen reading the store's existing payload, no refetch
  - Surfaced by: ceo-review — A1
  - Files: mobile/app/achievements.tsx, mobile/app/_layout.tsx
- [ ] **T5 (P2, human: ~1h / CC: ~10m) — mobile/profile** — Move Posts section below the achievements row
  - Surfaced by: ceo-review — Task 1 brief
  - Files: mobile/app/(tabs)/goals.tsx
- [ ] **T6 (P1, human: ~2h / CC: ~15m) — backend/tests** — Unit test `deriveTier` and integration-test the `GET /achievements` contract
  - Surfaced by: ceo-review — T1 (blocked on .env.test password)
  - Files: backend/src/modules/achievements/
- [ ] **T7 (P2, human: ~3h / CC: ~20m) — rank** — Collapse duplicated rank thresholds into one shared source, then decide what Rank means that Level does not
  - Surfaced by: ceo-review — E1 expansion, H1
  - Files: mobile/lib/rank.ts, backend/src/modules/social/routes.ts
- [ ] **T8 (P3, human: ~1h / CC: ~10m) — rank** — Explicit keep/kill verdict on `mobile/lib/badges.ts` as a third progression concept
  - Surfaced by: ceo-review — E2 expansion
  - Files: mobile/lib/badges.ts

---

# PHASE 2 — DESIGN REVIEW (via /autoplan)

Classifier: **APP UI** (workspace-driven, task-focused). Landing-page rules do not apply.

## Step 0: Design Scope Assessment

**0A. Initial rating: 4/10 as briefed, 6/10 after the CEO pass.** The brief specifies
placement ("below Current Rank"), ordering ("highest tier first"), and one control
("View All") — but nothing about what the user actually sees. The CEO pass already
resolved the empty state and near-completion display. A 10/10 for THIS plan specifies:
tile anatomy, day-one empty copy, skeleton shape, error affordance, the tie-break inside
the sort, scroll affordance, touch target size, and what View All groups by.

**0B. DESIGN.md status: absent — but the repo has a real de facto design system.**
`constants/Colors.ts` (dark/light token pairs), `constants/socialTheme.ts`, `useTheme()`
merging both, and the `getStyles(Colors)` factory-in-`useMemo` convention. Recommend
`/design-consultation` to formalize it, but this plan is NOT designing in a vacuum.

**0C. Existing design leverage — reuse, do not reinvent:**

| Need | Existing pattern | File |
|---|---|---|
| Section label | `HeroLabel` — 9px, 700, letterSpacing 1, uppercase | `app/(tabs)/tasks.tsx:1208` |
| Card chrome | `styles.card` from `getStyles(Colors)` | `app/(tabs)/tasks.tsx` |
| Deterministic color per item | `TAG_COLOR_TOKENS` — 10 tokens, each `{bar, bg, text}` triplet, hashed | `utils/tagStyle.ts:8` |
| Deterministic icon per item | `TAG_ICONS` — 16-emoji pool, stable hash | `utils/tagStyle.ts:25` |
| Progress display | `XPBarFill` + 4px bars | `app/(tabs)/goals.tsx:425`, `:1060` |
| Compact list row | `ItemRow` | `components/calendar/ItemRow.tsx` |

**0D. Focus areas:** all 7 passes. `[auto-decided: P1 completeness]`

## Pass 1: Information Architecture — 5/10

The profile becomes Rank -> Achievements -> Posts: three consecutive "look at my stats"
blocks. Constraint worship (if you could show only three things) says a profile should
answer *who am I, how am I doing, what did I do* — and Rank plus Achievements both answer
the middle one at different resolutions, which is the exact redundancy the CEO pass found
between Rank and Level.

**D-IA1 — Rank and Achievements are the same question twice.** `[auto-decided]` The row
sits directly under Rank, so make the relationship explicit rather than parallel: Rank is
the summary, Achievements are the evidence. Concretely — no section divider between them,
one shared heading block, achievements visually subordinate (smaller, lighter) so the eye
reads Rank first and the row as its supporting detail. `[P5 explicit]`

**D-IA2 — "View All" competes with the tiles for the same tap.** `[auto-decided]` Right-
aligned text link in the section header, not a button. Matches the existing header idiom
and keeps one primary target per row. `[P3 pragmatic]`

## Pass 2: Interaction State Coverage — 7/10

| Feature | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL |
|---|---|---|---|---|---|
| Achievements row | 4 skeleton tiles at final size, no spinner | Nearest 4 **locked** achievements with progress, plus one line of copy | Inline retry using `errorKind`; never an empty row | Unlocked tiles sorted, horizontally scrollable | Unlocked first, then in-progress; scroll reveals locked |
| View All | Full-screen skeleton | Cannot be empty — catalogue is always 31 | Retry, preserving scroll | Grouped by category, tier ordering within group | n/a |
| Tile tap | Press state | n/a | n/a | Push to `achievement/[id]` | n/a |

**D-ST1 — Skeleton, not spinner.** `[auto-decided]` The row has a known fixed shape; a
centered spinner makes the section jump on load. Skeleton tiles at final dimensions hold
layout. `[P1 completeness]`

**D-ST2 — There is no true empty state, and that is the point.** `[auto-decided]` A user
with zero unlocks sees the four nearest locked achievements with real progress values
instead of a blank shelf. The row is never empty, so "empty" collapses into "not yet".
This is the single highest-leverage design decision in the plan. `[P1 completeness]`

## Pass 3: User Journey & Emotional Arc — 4/10

| Step | User does | User feels | Plan specifies? |
|---|---|---|---|
| Day 1 | Opens profile after first session | "I just started, is any of this for me?" | **Now yes** — nearest-locked view shows a reachable next goal |
| Day 3 | Returns after 3rd session | "I'm 2 sessions from that one" | Yes — progress values are live |
| Day 7 | First unlock lands | Should feel like a moment | **NO — gap** |
| Day 60 | 20 unlocked, scrolls the row | "Look what I built" | Partial — sort surfaces best first |

**D-JR1 — The unlock moment is unspecified and it is the whole point.** `[TASTE
DECISION]` Everything in this plan builds toward a user earning something, and the plan
says nothing about what happens at that instant. The row silently gains a tile on next
focus. Options range from a subtle new-tile highlight (cheap) to a full unlock
celebration (a real feature). Surfacing at the gate — it widens Task 1 beyond a display
row. Time-horizon note: 5-second visceral response is exactly what this plan lacks.

## Pass 4: AI Slop Risk — 6/10

App UI rules applied. Instant-fail scan: no card mosaic, no hero, no 3-column grid, no
centered-everything. Clean.

**D-SL1 — Emoji-as-icon is NOT slop here.** Worth stating plainly because it looks like
blacklist item 7: `TAG_ICONS` is a 16-emoji pool and `RANK_META` uses emoji for all five
tiers. Emoji is this app's established, consistent icon language. Keep it. Replacing it
with Ionicons for achievements alone would fragment the vocabulary. **No action.**

**D-SL2 — REAL defect: the seeded achievement icons collide.** `⚡` appears at least
twice in the first eight seeds. In a row of ~44px tiles with no labels, two different
achievements are visually identical — fatal for a surface whose entire job is instant
recognition. `[auto-decided]` De-duplicate the icon set at seed level, and drive the tile
*background* from `TAG_COLOR_TOKENS` hashed on the achievement `key` so that even a
repeated glyph lands on a different color. This is exactly the deterministic-hash reuse
the brief asked for. `[P4 DRY, P1 completeness]`

**D-SL3 — Uniform bubbly radius risk.** `[auto-decided]` Tiles inherit the existing card
radius scale rather than introducing a new one. `[P5 explicit]`

## Pass 5: Design System Alignment — 5/10

No DESIGN.md, so alignment is measured against the de facto token system. The plan
introduced one primitive that does not exist in the codebase.

**D-DS1 — The "progress ring" is a new primitive.** Every existing progress display in
this app is a **bar** (`XPBarFill`, the 4px goal bars at `goals.tsx:1060`). A ring around
a tile would be the first ring in the product. `[auto-decided]` Use a thin bar under the
tile, or a partial border-arc only if a mockup proves it reads better at 44px. Defaulting
to the established idiom. Corrects the CEO pass, which said "ring" without checking.
`[P4 DRY, P5 explicit]`

## Pass 6: Responsive & Accessibility — 3/10 (weakest dimension)

The plan says nothing about either. Fixes, all auto-decided under `[P1 completeness]`:

- **Touch targets:** tiles minimum 44x44pt. At 6 visible tiles on a 375pt screen this is
  the binding constraint — it dictates tile size, not aesthetics.
- **Screen readers:** each tile needs `accessibilityLabel` carrying title, lock state and
  progress ("Marathon, locked, 3 of 10 sessions"). An emoji alone announces as the raw
  glyph name, which is useless.
- **Dynamic Type:** CLAUDE.md asks for Dynamic Type support where practical. A fixed-height
  horizontal row is where that breaks first — cap the label at 2 lines and let the tile
  grow.
- **Contrast:** `TAG_COLOR_TOKENS` `text` values are tuned against their own `bg`. Any new
  pairing must be re-checked against 4.5:1, not assumed.
- **Horizontal scroll discoverability:** show a partial 7th tile at the right edge so the
  row visibly continues. A row that ends flush at the screen edge reads as complete.

## Pass 7: Unresolved Design Decisions

| Decision needed | If deferred, what happens |
|---|---|
| What the unlock moment looks like | Engineer ships a silently-appearing tile; the payoff never lands (D-JR1 — at gate) |
| Sort tie-break within a tier | Arbitrary order; the row reshuffles between launches for no visible reason |
| Does the row show locked achievements once some are unlocked | Engineer shows unlocked only, and the "next goal" pull disappears the moment it starts working |
| View All grouping: category or tier | Two defensible answers; engineer picks one and it silently becomes the spec |
| Tile label: always, on-tap, or never | Drives tile width, which drives how many are visible, which drives the whole row |

## Step 0.5 — Design Dual Voices

**CODEX SAYS (design — UX challenge):** `[codex-unavailable: binary not found]`

**CLAUDE SUBAGENT (design — independent review):** 9 findings, 3 critical. It read the
actual screen rather than the plan's description of it, and found that **most of Task 1
already ships.** All load-bearing claims verified before acceptance:

| # | Finding | Sev | Verified |
|---|---|---|---|
| DC1 | Posts is a peer **tab**, not a section. `goals.tsx:1433-1450` renders an Awards\|Posts segmented switcher | CRITICAL | **YES** |
| DC2 | The Awards tab already renders `AchievementsSection` (`:1081`, mounted `:1462`) — a full grid of all 31 with progress bars and an all-unlocked banner. Row + View All would be a **third** rendering of one dataset | CRITICAL | **YES** |
| DC3 | The day-one "nearest locked with progress" state **already ships** — locked items at 0.45 opacity (`:1017`), sorted unlocked-gold-first (`:1327-1328`) | CRITICAL | **YES** |
| DC4 | A third tier definition already exists client-side: `isGoldTier = a.xpReward >= GOLD_TIER_XP` (`:1323`, `GOLD_TIER_XP = 500` at `:74`), and it is already a **visible** label (gold accent bar `:1024`, gold "Earned" text `:1046`) | HIGH | **YES** |
| DC5 | `CategoryBadgesSection` (`:1200`, mounted `:1463`) is already a horizontal ScrollView. A second one makes the tab two identical shelves for two progression systems | HIGH | **YES** |
| DC6 | Hierarchy is five trophy cases, not three: Level+XP -> Streak -> Rank -> Achievements -> Badges before any content | HIGH | Consistent |
| DC7 | `achievement/[id]` is registered (`_layout.tsx:274`) but nothing navigates to it — a dead route cited as precedent | MEDIUM | Registered; no nav found |
| DC8 | Hash-for-icon replaces authored emoji/titles with random decoration | MEDIUM | Accepted |
| DC9 | Refetch-on-focus re-sorts by progress, so tiles reorder under the user's finger mid-scroll | MEDIUM | Accepted — real bug in D1 |

### DESIGN LITMUS SCORECARD
```
  Dimension                          Claude   Codex   Consensus
  ────────────────────────────────── ──────── ─────── ──────────
  1. Plan describes the real screen?  NO       N/A     single-voice
  2. Information hierarchy sound?     NO       N/A     single-voice
  3. States specified?                PARTIAL  N/A     single-voice
  4. Specific (not generic) UI?       PARTIAL  N/A     single-voice
  5. Design-system aligned?           NO       N/A     single-voice
  6. Responsive / a11y covered?       NO       N/A     single-voice
  7. Duplicates existing surfaces?    YES      N/A     single-voice
```

## CORRECTIONS TO PHASE 1 (superseded findings)

The CEO pass reviewed the plan's *description* of the profile screen instead of the
screen. These Phase 1 auto-decisions are **WITHDRAWN**:

| Withdrawn | Why it was wrong |
|---|---|
| **U1** "design the day-one empty state — highest-leverage decision" | It already ships: locked at 0.45 opacity with live progress, sorted nearest-first |
| **U2** "'locked but nearly there' is IN for v1, free" | Already shipped. Not a new capability |
| **Q2** "tier bands live server-side only; client never computes one" | Cannot hold while `isGoldTier` computes a tier client-side at `:1323`. Either delete `isGoldTier` and repoint the gold accent at the server tier, or drop `deriveTier` |
| **L1** "v1 uses tier for ordering only, no visible label" | Already violated in shipped code — the gold accent bar and gold "Earned" text ARE visible tier labels |
| **T5** "move Posts section below the row (~1h)" | Not a reorder. It deletes a tab switcher and demotes Posts to a scrolled-to section — an IA change the plan never named or priced |
| **D1** "refetch on tab focus" | Kept, but incomplete: re-sorting by progress reorders tiles mid-scroll. Row order must be frozen per mount |

**Standing:** A1, A2, E1, E2 (still valid — the *row* still needs an error branch), Q1
(file size), Q3 (no evaluator framework), O1, F4/L1-revised, and the entire Section 3
security result are unaffected.

## TASK 1 — REVISED (user decisions, 2026-08-18)

The original Task 1 was written against a screen that does not exist. Revised definition:

1. **Move `AchievementsSection` out of `goals.tsx` into `app/achievements.tsx`** — it
   becomes the "View All" destination. It is already the grid the brief asked View All to
   be; it is not rebuilt.
2. **A compact achievements row replaces it in-tab**, linking to that screen. One
   rendering in-tab, one detail view behind it. No third surface.
3. **Delete the Awards|Posts tab switcher** (`goals.tsx:1433-1450`). Profile becomes one
   scroll: Level/XP -> Streak -> Rank -> Achievements row -> Posts.
4. **Delete `mobile/lib/badges.ts` and `CategoryBadgesSection`** (`:1200`, `:1463`).
   Removes the third progression concept and the competing horizontal shelf.
5. **Reconcile the tier definitions.** `isGoldTier` (`:1323`) is deleted; the gold accent
   and sort repoint at the server-derived tier. This is the only way Q2 (one tier
   definition) can hold.

### Revised task list (supersedes T1-T8 above)

| # | Task | Priority | Effort (human / CC) | Files |
|---|---|---|---|---|
| R1 | `deriveTier()` in `serializeAchievement`, explicit default for unmapped category | P1 | 2h / 15m | `backend/src/modules/achievements/routes.ts` |
| R2 | Move `AchievementsSection` -> `app/achievements.tsx`, register route, delete dead `achievement/[id]` or wire it up | P1 | 4h / 30m | `mobile/app/achievements.tsx`, `mobile/app/_layout.tsx`, `mobile/app/(tabs)/goals.tsx` |
| R3 | Build the row: 4 tiles + terminal "+N more" affordance, order frozen per mount | P1 | 1d / 45m | `mobile/components/achievements/` |
| R4 | Delete the Awards\|Posts switcher; stack Rank -> Achievements -> Posts | P1 | 3h / 20m | `mobile/app/(tabs)/goals.tsx` |
| R5 | Delete `badges.ts` + `CategoryBadgesSection` + `CategoryBadge` types | P1 | 2h / 15m | `mobile/lib/badges.ts`, `mobile/types/profile.ts`, `goals.tsx` |
| R6 | Delete `isGoldTier`; repoint gold accent + sort at server tier | P1 | 2h / 15m | `goals.tsx:74,1323,1024,1046` |
| R7 | De-duplicate seeded achievement emoji (`⚡` repeats) | P2 | 1h / 10m | `backend/prisma/seed.ts` |
| R8 | Unit-test `deriveTier`; integration-test the `GET /achievements` contract | P1 | 2h / 15m | **BLOCKED on `.env.test` password** |
| R9 | Extract Current Rank from `goals.tsx` (1523 lines) while touching this area | P2 | 3h / 20m | `mobile/components/profile/` |
| R10 | Rank de-duplication: one shared threshold source | P2 | 3h / 20m | `mobile/lib/rank.ts`, `backend/src/modules/social/routes.ts:26` |

**Net surface change: -2 components, -1 progression system, +1 row, +1 route.** The plan
now removes more than it adds, which is what the CEO pass was asking for and the original
brief did not deliver.

---

# PHASE 3 — ENG REVIEW (via /autoplan)

**Test framework:** vitest both workspaces (`mobile/vitest.config.mts`, `backend/vitest.config.mts`).
10 test files tracked. CLAUDE.md has no `## Testing` section; the binding rule is line 321:
"Every new route needs an integration test before it's considered done."

## Section 1: Architecture

```
  BEFORE                              AFTER (revised Task 1)
  goals.tsx (1523 lines)              goals.tsx (smaller)
   ├─ Level/XP hero                    ├─ Level/XP hero
   ├─ Streak                           ├─ Streak
   ├─ Current Rank :890                ├─ Current Rank  (extracted, R9)
   └─ Tabs [Awards | Posts] :1433      ├─ AchievementsRow  NEW ──▶ app/achievements.tsx
       ├─ AchievementsSection :1462    └─ Posts (inline, tabs deleted)
       └─ CategoryBadgesSection :1463
                                       DELETED: tab switcher, CategoryBadgesSection,
                                                badges.ts, isGoldTier
```

**[HIGH] (confidence: 9/10) `backend/prisma/seed.ts` — R1 as specified cannot work.**
Deriving a tier from `category` + `threshold` is incoherent because thresholds are not
comparable across categories. Measured from the seed data:

| Category | n | thresholds |
|---|---|---|
| STREAK | 6 | 3, 7, 14, 30, 60, 100 |
| SESSIONS | 12 | 1, 1, 1, 1, 1, 1, 10, 25, 50, 100, 250, 500 |
| FOCUS_TIME | 6 | 1, 5, 10, 50, 100, 200 |
| TASKS | 5 | 1, 10, 50, 100, 500 |
| LEVEL | 2 | 5, 10 |

A STREAK of 30 is punishing; SESSIONS of 50 is routine. Six SESSIONS achievements share
`threshold: 1` (the behavioural ones skipped by `BEHAVIOURAL_KEYS`), so threshold carries
no difficulty signal for them at all.

**`xpReward` does carry it, across every category:** 25 → 2500, banding cleanly as
25-50 / 75-150 / 200-600 / 1000-2500. **Fix:** `deriveTier` bands on `xpReward`, not
category+threshold.

**[HIGH] (confidence: 9/10) `goals.tsx:1323` — R6 is wrong in the other direction.**
`isGoldTier = a.xpReward >= GOLD_TIER_XP` already bands on xpReward. It is not a
competing bad idea to delete; it is the correct idea at 2-tier resolution. **Fix:** R6
becomes "promote the existing xpReward banding from 2 tiers to 4, server-side" — a
generalisation of shipped logic, not a replacement. This also collapses the DRY problem
Q2 was chasing, since the client stops computing tiers as a side effect rather than as a
deletion.

## Section 2: Code Quality

**[MEDIUM] (confidence: 8/10)** `goals.tsx` is 1523 lines and this plan deletes two
sections from it while adding one. Net direction is right. R9 (extract Current Rank)
should be done **first**, not last, so the row lands in an already-extracted file rather
than deepening the monolith and then being moved.

**[MEDIUM] (confidence: 7/10)** The plan deletes `badges.ts` but the type surface may be
wider — `CategoryBadge` and `BADGE_THRESHOLDS` live in `mobile/types/profile.ts`, and
`computeCategoryBadges` may have callers beyond the profile screen. Deletion order:
callers first, then component, then lib, then types.

## Section 3: Test Review

```
  NEW CODEPATHS
    deriveTier(xpReward) ──┬─▶ tier 1  (xp <= 50)
                           ├─▶ tier 2  (51-150)
                           ├─▶ tier 3  (151-600)
                           ├─▶ tier 4  (> 600)
                           └─▶ default ──▶ tier 1 + warn   [E1]
    AchievementsRow ───────┬─▶ loading  (skeleton)
                           ├─▶ error    (errorKind branch)
                           ├─▶ unlocked tiles + "+N more"
                           └─▶ zero unlocked ──▶ nearest-locked (already ships in grid)
    Row order ─────────────▶ frozen per mount   [DC9 — reorder-under-finger bug]
  DELETED CODEPATHS (regression risk)
    activeProfileTab state, CategoryBadgesSection, computeCategoryBadges, isGoldTier
```

| Codepath | Test type | Exists | Status |
|---|---|---|---|
| `deriveTier` bands + boundaries + default | Unit (backend) | No | **Write it** — pure function, cheapest high-value test in the plan |
| `GET /achievements` returns `tier` on all 31 | Integration | No | **BLOCKED** on `.env.test` |
| Row states | Component | No | **Impossible** — component rendering is deliberately out of scope per `mobile/vitest.config.mts` |
| Deletion regressions (badges/tabs) | Any | No | **No safety net** — see below |

**[HIGH] (confidence: 9/10) The deletions have no test coverage protecting them.** R4/R5/R6
delete a tab switcher, a section, a lib and a computed field from a 1523-line file that has
**zero component tests**, and the config documents that component testing is out of scope.
The only verification available is running the app. **Fix:** treat `npm run typecheck` as
the primary safety net (it catches removed imports/types but not runtime layout), and do
the deletions as their own commit, separate from the row, so a revert is surgical.

**2am-Friday test:** `deriveTier` boundary cases — off-by-one at 50/150/600 silently
re-tiers the entire catalogue.

## Section 4: Performance

`deriveTier` is O(1) over 31 in-memory rows. Deleting `computeCategoryBadges` **removes**
a client-side O(tasks x tags) loop from every profile render, so this plan is net-negative
on client work. No new queries, no new indexes. No issues.

**Blast-radius correction (verified):** `badges` is fully self-contained — `goals.tsx:45,46,1126,1200,1288,1463`, `lib/badges.ts`, `types/profile.ts:11,18`. No callers elsewhere. Confidence raised to 10/10; deletion order is goals.tsx usages -> lib -> types. `BadgeCard:1126` is used only by `CategoryBadgesSection` and dies with it.

## Step 0.5 — Eng Dual Voices

**CODEX SAYS (eng — architecture challenge):** `[codex-unavailable: binary not found]`

**CLAUDE SUBAGENT (eng — independent review):** 11 findings, 4 critical. It converged
independently on the xpReward conclusion and found four things the primary pass missed.

| # | Finding | Sev | Verified |
|---|---|---|---|
| EC1 | R1+R6 incompatible: six achievements share `(SESSIONS, 1)` — `sessions_1` plus the five behavioural keys — so tier-by-threshold maps `marathon` (xp 400) and "first session" (xp 25) to one band | CRITICAL | **YES** (`seed.ts:71-72`) |
| EC2 | **The 4-tile row would be permanently filled by achievements that can never unlock.** `serializeAchievement` caps progress at threshold, so the five behavioural keys report `progress = 1.0` while `isUnlocked` stays false. The existing sort puts highest-progress-locked first, so four tiles read 100%-locked forever | CRITICAL | **YES** — and `seed.ts:24-27` already documents that speed-runner/marathon "can never unlock anything" |
| EC3 | E2/F2 ("branch on `errorKind`") is **not implementable**: `gamificationStore.fetchAchievements` swallows errors and exposes no `isLoading`/`error`. The store change appears nowhere in R1-R10 | CRITICAL | **YES** |
| EC4 | `achievement/[id].tsx:26` calls `GET /achievements/{id}`, but that path is the cross-user route `:userId` — passing an achievement id returns 404 "User not found". The dead route is also broken. Delete it, do not wire it | CRITICAL | **YES** |
| EC5 | R5 deletion set incomplete (`BadgeCard`, `BadgeLevel`, `BADGE_THRESHOLDS`) and `types/profile.ts` must SURVIVE because `StreakState` lives there. Bonus: dropping `useTaskStore` from the profile removes a re-render on every task edit | HIGH | **YES** |
| EC6 | R4 unpriced: deleting the switcher leaves `PostsPane` permanently mounted with a "Load more" button inside the parent ScrollView (unbounded, non-virtualized), and it binds shared `social.isLoading` so unrelated actions flash a spinner | HIGH | Accepted |
| EC7 | Sort logic is inline in the component, so R3-R6 ship with zero coverage. Extract to `mobile/lib/achievementOrder.ts` (pure, RN-free) — the only testable slice, and it covers EC1 and EC2 | HIGH | **YES** |
| EC8 | "Order frozen per mount" freezes forever — a tab screen mounts once per app session | MEDIUM | Accepted |
| EC9 | **LIVE BUG: FOCUS_TIME thresholds are in the wrong unit.** `handler.ts:69` returns minutes; seeds express hours (`focus_6000` "One Hundred Hours" has `threshold: 100`). Users unlock "One Hundred Hours" after 100 **minutes** | MEDIUM | **YES** — pre-existing, unrelated to this plan, shipping today |
| EC10 | No new attack surface in R1-R10 | — | Concurs with Phase 1 |
| EC11 | R2 under-estimated: `AchievementsSection` depends on `AchievementItem`, `MergedAchievement`, `sectionLabel`, `fmtDate`, `GOLD_TIER_XP` — all private to `goals.tsx` | MEDIUM | **YES** |

### ENG DUAL VOICES — CONSENSUS TABLE
```
  Dimension                          Claude   Codex   Consensus
  ────────────────────────────────── ──────── ─────── ──────────
  1. Architecture sound?             NO       N/A     single-voice
  2. Test coverage sufficient?       NO       N/A     single-voice
  3. Performance risks addressed?    YES      N/A     single-voice
  4. Security threats covered?       YES      N/A     single-voice
  5. Error paths handled?            NO       N/A     single-voice
  6. Deployment risk manageable?     YES      N/A     single-voice
```

## Cross-Phase Themes

**Theme 1 — "This already exists."** Surfaced independently in Phase 1 (endpoints,
progress, server-authoritative unlocks), Phase 2 (the grid, the empty state, the
horizontal shelf), and Phase 3 (xpReward banding). Three phases, three voices, same
conclusion: **the brief consistently proposed building things that ship today.** This is
the highest-confidence signal in the whole review.

**Theme 2 — Tier definition keeps multiplying.** Phase 1 wanted a server tier, Phase 2
found a client `isGoldTier`, Phase 3 proved threshold-banding is incoherent and xpReward
is the only authored signal. Converged answer: **one function, banding on `xpReward`,
server-side.**

**Theme 3 — Nothing here is testable by the current harness.** Phase 1 flagged the
`.env.test` blocker, Phase 2 found no component tests possible, Phase 3 showed the sort
logic is trapped inside the component. Converged fix: **extract pure logic to
`mobile/lib/achievementOrder.ts` and unlock the backend harness.**

---

# APPROVED PLAN — Final Task List

User approved 2026-08-18 with eng fixes folded in. Unlock moment: **full celebration
overlay** (taste decision resolved by user, not auto-decided).

Sequenced so each step lands on ground the previous one cleared.

| # | Task | Pri | human / CC | Files |
|---|---|---|---|---|
| **R9** | Extract Current Rank out of `goals.tsx` (1523 lines) **first**, so everything after lands in extracted files | P1 | 3h / 20m | `mobile/components/profile/` |
| **R11** | `gamificationStore`: add `isLoadingAchievements` + `achievementsError`. **Prerequisite for R3** — the error branch cannot be built without it | P1 | 2h / 15m | `mobile/stores/gamificationStore.ts` |
| **R12** | Stop reporting `progress: 1.0` for permanently-locked behavioural achievements. **Prerequisite for R3** | P1 | 2h / 15m | `backend/src/modules/achievements/routes.ts`, `handler.ts` |
| **R1** | `deriveTier(xpReward)` server-side, 4 bands (<=50 / 51-150 / 151-600 / >600), explicit default | P1 | 2h / 15m | `backend/src/modules/achievements/routes.ts` |
| **R6** | Delete `isGoldTier`; repoint gold accent + sort at the server tier. A generalisation of shipped logic, not a replacement | P1 | 2h / 15m | `goals.tsx:74,1024,1046,1323` |
| **R16** | Extract sort/selection to `mobile/lib/achievementOrder.ts` (pure, RN-free) — the only testable slice, covers EC1+EC2 | P1 | 2h / 15m | `mobile/lib/achievementOrder.ts` |
| **R2** | Move `AchievementsSection` -> `app/achievements.tsx`, extracting its 5 private deps (`AchievementItem`, `MergedAchievement`, `sectionLabel`, `fmtDate`, `GOLD_TIER_XP`) | P1 | **1d / 1h** (was 4h/30m — under-estimated) | `mobile/app/achievements.tsx`, `_layout.tsx`, `goals.tsx` |
| **R3** | The row: 4 tiles + terminal "+N more", skeleton/error/nearest-locked states, order frozen per cold mount | P1 | 1d / 45m | `mobile/components/achievements/` |
| **R14** | Unlock celebration overlay: achievement, XP gained, share action reusing `PATCH /:id/share` | P1 | 1d / 45m | `mobile/components/achievements/UnlockOverlay.tsx` |
| **R15** | Delete the dead+broken `achievement/[id]` route (calls the cross-user endpoint, 404s) | P2 | 30m / 5m | `mobile/app/achievement/`, `_layout.tsx:274` |
| **R4** | Delete Awards\|Posts switcher; stack Rank -> Achievements -> Posts. Watch `PostsPane` unbounded "Load more" inside the parent ScrollView | P1 | **6h / 30m** (was 3h) | `goals.tsx:1433-1470` |
| **R5** | Delete badges: `goals.tsx` usages (45,46,1126,1200,1288,1463) -> `lib/badges.ts` -> `types/profile.ts:11,18`. **Keep `StreakState`** | P1 | 2h / 15m | 3 files |
| **R7** | De-duplicate seeded achievement emoji | P2 | 1h / 10m | `backend/prisma/seed.ts` |
| **R13** | **LIVE BUG:** FOCUS_TIME thresholds are hours, `handler.ts:69` compares minutes. "One Hundred Hours" unlocks at 100 minutes | P1 | 1h / 10m | `handler.ts:69` or `seed.ts:42-46` |
| **R10** | Rank de-duplication: one shared threshold source, then differentiate from Level | P2 | 3h / 20m | `mobile/lib/rank.ts`, `social/routes.ts:26` |
| **R8** | Unit-test `deriveTier` + `achievementOrder`; integration-test the `GET /achievements` contract | P1 | 2h / 15m | **BLOCKED** |

**Net surface change: -2 components, -1 progression system, -1 dead route, +1 row,
+1 route, +1 overlay. Three live bugs fixed.**

## GSTACK REVIEW REPORT

| Run | Status | Findings |
|---|---|---|
| plan-ceo-review (via autoplan) | issues_open | 4 of 5 premises failed; 11/11 sections; 13 auto-decided; 1 user challenge resolved |
| autoplan-voices (ceo) | subagent-only | 9 findings, 3 critical, all verified |
| plan-design-review (via autoplan) | issues_open | 7/7 passes; overturned 5 Phase-1 decisions |
| autoplan-voices (design) | subagent-only | 9 findings, 3 critical, all verified |
| plan-eng-review (via autoplan) | issues_open | 4 sections; 4 critical |
| autoplan-voices (eng) | subagent-only | 11 findings, 4 critical, all verified |
| plan-devex-review | skipped | No developer-facing scope |

**VERDICT: APPROVED WITH FIXES FOLDED IN.** The brief's three tasks survive, but Task 1
was rewritten against the real screen, Task 2's schema/framework work was cut as
premature, and Task 3 was re-aimed from a composite formula at de-duplication. The review
found three live bugs unrelated to the brief. CODEX: unavailable, not absorbed —
every consensus row is single-voice.

**UNRESOLVED DECISIONS:**
- R8 is blocked: `backend/.env.test` still contains the literal placeholder
  `YOUR_LOCAL_POSTGRES_PASSWORD`. Until a real local Postgres password is supplied, no
  backend task here can satisfy CLAUDE.md:321 ("every new route needs an integration test
  before it's considered done"), which means R1, R12 and R13 ship untested.
