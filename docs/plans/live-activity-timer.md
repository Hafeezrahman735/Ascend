<!-- /autoplan restore point: ~/.gstack/projects/Hafeezrahman735-pomodoro-app/staging-autoplan-restore-20260824-204850.md -->

# Ascend — Focus Timer Live Activity (Lock Screen + Dynamic Island)

Status: **under review** (/autoplan, 2026-08-24)
Branch: `staging`

Supersedes the `## Phase 1 — Live Activity via expo-widgets` section of
`docs/plans/live-activity-and-focus.md`. That document keeps the Focus-nudge
work (Phase 2a, shipped) and Phase 2b/3.

---

## Project context

Ascend: React Native (Expo Router), bundle ID `com.hafeezrahman.ascend`, EAS
project ID `e891b005-10df-49b0-9e5a-2eae20e42b11`. Zustand `timerStore`.

**Timer architecture — load-bearing, do not restructure:** the timer is
frontend-owned and timestamp-based (`startedAt`, `elapsedAtPause`, `totalMs`),
counting down locally with fire-and-forget REST calls to the backend. This was a
deliberate pivot away from a server-tick model that broke over Expo tunnel. The
Live Activity work below must plug into this model as a one-way mirror of state
outward — it is not a new source of truth, and it must not introduce a server
round-trip or per-second bridge traffic into the countdown itself.

Known circular-import risk areas to check before wiring in new files:
`authStore ↔ timerStore ↔ taskStore`, `sync.ts ↔ TimeEngine.ts ↔ timerStore.ts`.

Requires a native EAS dev client build — will not run in Expo Go.

---

## Core architecture — implement exactly this, do not substitute a per-second update loop

```
Ascend timerStore
     ↓ (on start / pause / resume / stop — NOT on every tick)
Native module call: push { endDate, isPaused, pausedRemainingSeconds }
     ↓
ActivityKit Activity<AscendTimerAttributes> (widget extension, Swift/SwiftUI)
     ↓
Text(timerInterval: Date.now..<endDate, countsDown: true)
     ↓
iOS renders the countdown natively — Lock Screen + Dynamic Island
```

Ascend tells iOS "this session ends at 7:24 PM" once per state change, not once
per second. `Text(timerInterval:countsDown:)` is Apple's own mechanism: the OS
rasterizes the countdown from a date range with zero ongoing work from the app or
widget process. Do not use `Timer`, a 1-second `TimelineView`, or repeated
`Activity.update()` calls to simulate a live tick — none of these are allowed
inside a widget extension process budget and all of them defeat the reason we're
doing this.

### The pause problem — designed explicitly

`Text(timerInterval:)` cannot be paused once given a date range — iOS counts to
the end of the range regardless of what the host app does. Ascend's timer
supports pause/resume, so this is an explicit two-mode content state:

- **Running**: `isPaused: false` + `endDate`. Widget renders
  `Text(timerInterval: Date.now..<endDate, countsDown: true)` — OS-driven, no app
  involvement until the next state change.
- **Paused**: `isPaused: true` + a `pausedRemainingSeconds` snapshot (an integer
  computed once at pause time — the widget process cannot know how long ago pause
  happened, so it must be told the value directly). Widget renders a static
  `Text(formatted pausedRemainingSeconds)` — no countdown, doesn't move.
- **On resume**: compute `endDate = now + pausedRemainingSeconds`, push a fresh
  update with `isPaused: false`.
- **On stop/complete**: end the Activity, don't leave a stale one on the Lock
  Screen.

Each pause/resume triggers exactly one push — not a stream. This ties into the
store as a **subscriber**, following `useTimerNotifications`, which reacts to
state changes without modifying the frozen timer actions. Do not modify timer
countdown logic — only add a subscriber.

---

## Phase 1 — Native scaffolding + basic running/paused states

1. **Library choice**: evaluate `expo-apple-targets` (native Widget Extension via
   config plugin, hand-written SwiftUI — most control, most native code to
   maintain) vs a pre-built wrapper (`@txo/live-activity-countdown-react-native`,
   `expo-live-activity`). Check whether either supports the pause/paused-snapshot
   pattern — many countdown-only packages assume a single uninterrupted run.
   Recommend one, given this is solo-maintained; prefer less hand-maintained
   native surface unless the pause requirement forces a custom build.
2. `NSSupportsLiveActivities: YES` in Info.plist via the config plugin. Target
   iOS 16.2+ (not 16.1).
3. `AscendTimerAttributes` (ActivityAttributes): fixed data for the life of the
   activity (session type — focus/break, linked task/goal label) plus a
   `ContentState` with `endDate: Date`, `isPaused: Bool`,
   `pausedRemainingSeconds: Int?`.
4. Widget UI: session type label, task/goal label, the timerInterval-driven
   countdown per the running/paused split. Match Deep Focus Midnight / Warm Dawn
   as far as Live Activity theming allows — state explicitly which tokens can't
   carry over and the fallback.
5. **Lifecycle wiring**: start → `Activity.request(...)`; pause/resume → push the
   two-mode content state; completion/manual stop → `Activity.end(...)`. Handle
   force-quit / OS reclamation — define what `timerStore` does so in-app state
   and Live Activity never contradict. In-app state is authoritative.
6. Respect ActivityKit's ~8-hour max Activity duration.
7. Config plugin / EAS build changes listed explicitly (widget extension target,
   entitlements, `app.json` changes) so provisioning doesn't surface at
   submission.

### Phase 1 test gate

- Start a session, lock the phone, countdown advances with zero JS/bridge
  activity (verify via profiler).
- Pause mid-session, Lock Screen freezes at the correct remaining time.
- Resume, countdown continues from the paused value.
- Force-quit mid-session, no orphaned/stale Activity.
- Complete a session, Activity ends cleanly.
- `/qa` pass on an EAS dev client build before Phase 2.

---

## Phase 2 — Dynamic Island + interactive controls (iPhone 14 Pro+)

1. Compact, minimal, and expanded presentations for the same
   `AscendTimerAttributes`/`ContentState`. Reuse Phase 1's state model.
2. Evaluate interactive pause/resume buttons (App Intents, more native
   complexity) vs display-only. Recommend one given solo-maintenance, with the
   tradeoff stated plainly.

### Phase 2 test gate

- Compact/minimal/expanded all reflect the same running/paused logic.
- If interactive: pausing from the Dynamic Island updates `timerStore`'s real
  state, round-tripping through the App Intent back into the store, not forking.

---

## Explicitly out of scope

- Screen Time / FamilyControls / app-shielding — separate entitlement.
- Server-side push-token Live Activity updates — the timer is local-only.

---

## Repo reality as of 2026-08-24 (read during /autoplan Phase 0)

Facts checked against the tree, not assumed:

| Claim in the brief | Repo reality |
|---|---|
| "Requires a native EAS dev client build" | True. `mobile/eas.json` has a `development` profile with `developmentClient: true` and `image: macos-tahoe-26.5-xcode-26.6`. |
| Expo SDK version | `expo@^57.0.14`, `react-native@0.86.2`, `expo-router@~57.0.14`. The `live-activity-and-focus.md` "Phase U — Expo 54 → 56/57 upgrade" prerequisite is **already done**. |
| Target iOS 16.2+ | The app's floor is already **iOS 16.4** (TODOS.md, SDK 57 bump). 16.2 is moot. |
| `timerStore` state fields | `startedAt`, `elapsedAtPause`, `timeLeft`, `plannedFocusSeconds`, `stopwatchElapsed`. There is **no `totalMs`** — the brief names a field that does not exist. |
| Statuses | `'idle' | 'running' | 'paused' | 'break'`. Note `'break'` means *a break is queued but not started* — `startedAt` is null. |
| Phases | `'focus' | 'shortBreak' | 'longBreak'`. |
| Modes | `'pomodoro' | 'stopwatch'`. **The brief has no representation for stopwatch**, which counts UP and never auto-completes. |
| `useTimerNotifications` pattern | `mobile/hooks/useTimerNotifications.ts`, mounted once in `app/_layout.tsx:64`. Subscribes via `useTimerStore.subscribe((state, prev) => ...)`, keys off `startedAt` flipping to a new non-null value. Exactly the right template. |
| Foreground hook exists | `mobile/hooks/useAppState.ts` exports `useAppForeground`. Reconciliation should reuse it, not add a fourth `AppState.addEventListener`. |
| Live Activity libs installed | **None.** No `expo-widgets`, no `@bacons/apple-targets`, no ActivityKit anything. |
| Prior decision D1 | `live-activity-and-focus.md` (2026-08-19) decided **`expo-widgets`**, explicitly rejecting hand-written SwiftUI because the dev machine is Windows with no Xcode. The brief's Phase 1.1 reopens this. |

### Pre-existing bug found in the blast radius

`getPhaseDuration(phase, settings, plannedFocusSeconds?)` takes the per-task plan
overlay as a third argument. Four of its five call sites never pass it:

- `stores/timerStore.ts:191` — `pause()`
- `stores/timerStore.ts:222` — `tick()`
- `app/(tabs)/index.tsx:218` — the hero progress ring
- `store/hooks/useAnalytics.ts:61` — live focus minutes

Only `timerStore.ts:769` (rehydrate) passes it. So whenever a task plan sets
`plannedFocusSeconds` to anything other than `settings.workDuration`, the running
countdown, the ring, and live analytics all compute against `workDuration`
instead of the planned length. A 20-minute planned block starts at 20:00 and then
jumps to 24:59 on the first tick.

This matters here because `endDate` and `pausedRemainingSeconds` derive from
exactly these values. Mirroring them to the Lock Screen would mirror the bug.

---

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Library = `expo-widgets@57` | Taste (surfaced) | P4 DRY, P5 explicit | Only option the author can verify without Xcode; binds `Text(timerInterval:pauseTime:countsDown:)` natively; plugin auto-writes Info.plist + entitlements. Confirms prior decision D1. | `@bacons/apple-targets` + hand-written SwiftUI (Swift maintenance tail, ~20min EAS loop per typo) |
| 2 | CEO | Drop the two-mode ContentState; use `pauseTime` | Mechanical | P5 explicit | Brief's premise that timerInterval cannot pause is false. `pauseTime?: Date` exists (iOS 16.0+). One render path instead of two. | Static-text paused branch + `pausedRemainingSeconds: Int` |
| 3 | CEO | Reject both pre-built wrappers | Mechanical | P6 evidence | `expo-live-activity` npm-deprecated; `@txo/...` 2 weekly downloads, 14 months stale. | Adopting either |
| 4 | CEO | Target iOS 16.4, not 16.2 | Mechanical | P6 | App floor already 16.4; plugin default is 16.4. | 16.2 |
| 5 | CEO | Add stopwatch support to ContentState | Mechanical | P1 completeness | `mode:'stopwatch'` counts up and never completes; brief had no representation. `countsDown:false` covers it. | Silently excluding stopwatch |
| 6 | CEO | Fix `getPhaseDuration` call sites in this plan | Mechanical | P2 blast radius | 4 of 5 sites drop `plannedFocusSeconds`; `endDate` derives from them. <5 files, no new infra. | Deferring to TODOS |

---

## CEO review — required registries

### Error & Rescue Registry

| Codepath | Failure | Rescued? | Action | User sees |
|---|---|---|---|---|
| `factory.start()` | Live Activities disabled in iOS Settings | Y | catch, warn, adapter goes inert | Nothing; timer normal |
| `factory.start()` | Started while backgrounded / system cap | Y | catch, retry on next foreground reconcile | Nothing |
| `activity.update()` | Handle stale (OS ended it) | Y | drop handle, re-request on reconcile | Card reappears |
| `activity.end()` | Handle lost across restart | Y | `getInstances()` sweep on foreground | Stale card disappears |
| Session > ~8h (stopwatch only) | OS silently drops activity | **Y (new)** | `staleDate` at ~7h50m + end/restart | Card de-emphasises, then refreshes |
| `clearUserData()` (logout) | Activity outlives the session | **Y (new)** | end on logout | Card disappears |

### Failure Modes Registry

| # | Failure mode | Severity | Detected how | Mitigation | Gap? |
|---|---|---|---|---|---|
| F1 | Orphaned card after force-quit | High | User sees a frozen card | `useAppForeground` → `reconcile()` using `getInstances()` | Closed |
| F2 | Card shows wrong remaining time for a planned focus block | **High** | Visible mismatch vs in-app | Fix the 4 `getPhaseDuration` call sites | **Open — pre-existing bug** |
| F3 | Stopwatch unrepresentable | High | Card never appears in stopwatch mode | `countsDown: false`, no end bound | Closed by design change |
| F4 | Frozen 5:00 card during a queued break | Medium | Card that never moves | No card while `startedAt === null` | Closed by design |
| F5 | 8-hour silent drop | Medium | Card vanishes with no signal | `staleDate` + end/restart | Closed |
| F6 | Progress bar keeps draining while paused | Medium | Bar and text disagree | `ProgressView` has no `pauseTime`; swap to `value:` when paused | Closed by design |
| F7 | Task title readable on a locked phone | Medium | Privacy, by design | Settings toggle, default on | Product decision — at gate |
| F8 | Adapter breaks silently after an iOS update | Low | Nobody notices | `[liveActivity]` prefixed logs | Accepted (no error backend) |

### Dream state delta

Ships the ambient-presence half of the 12-month ideal. Because `expo-widgets`
also covers Home Screen widgets and App Intents, the same dependency later
serves Phase 2b (`SetFocusFilterIntent`) from `live-activity-and-focus.md`.
Distance to ideal after this lands: one dependency closer, zero new ones needed.

### NOT in scope

- Server-side push-token updates (brief excludes; `getPushToken` exists but unused).
- Screen Time / FamilyControls (separate entitlement, separate work).
- Android widgets (`enableAndroid` defaults false; Live Activities are iOS-only).
- Home Screen widget (unlocked by this dependency, deliberately not built here).
- Sentry / error reporting for the adapter (already deferred in TODOS.md).

### What already exists

| Need | Existing code |
|---|---|
| Store subscriber that respects frozen actions | `mobile/hooks/useTimerNotifications.ts` |
| Foreground hook | `mobile/hooks/useAppState.ts` → `useAppForeground` |
| Force-quit rehydration | `timer:activeSession` + `timerStore.ts:769` |
| Single phase-duration rule | `mobile/lib/phaseDuration.ts` |
| Pure-logic test precedent | `mobile/lib/sessionPlan.test.ts` + `vitest.config.mts` |
| Orphan discovery | `LiveActivityFactory.getInstances()` (library) |
| Interactive button round-trip | `addUserInteractionListener()` (library) |
| Info.plist + entitlements | `expo-widgets` config plugin (automatic) |

---

## Phase 1 implementation record (2026-08-25)

Status: **implemented, unverified on device.** Everything below was checked
against the installed package source, not against the plan's assumptions.

### Plan claims confirmed against `expo-widgets@57.0.12`

| Claim | Verified how |
|---|---|
| `expo-widgets` is official and alive | npm: maintained by the Expo team, `57.0.12` published 2026-08-24, matches our SDK 57 |
| D2 — `Text` can be paused, so no two-mode ContentState | `@expo/ui/swift-ui/Text` exposes `timerInterval`, `countsDown` **and `pauseTime`** (iOS 16.0+). One render path, as the decision said |
| F6 — `ProgressView` cannot be paused | `ProgressView` has `timerInterval` + `countsDown` but **no `pauseTime`**. Paused now passes a fixed `value` instead |
| D4 — iOS 16.4 | Plugin's `deploymentTarget` default is exactly `16.4` |
| F1 — orphan sweep is possible | `LiveActivityFactory.getInstances()` exists |
| F5 — staleness is expressible | `start()`/`update()` take a `staleDate`; `isStale` is readable in the widget |
| D5 — stopwatch representable | `countsDown: false` with an open-ended range |

### Two places the plan was wrong about the mechanics

**1. A Live Activity needs no entry in the plugin's `widgets` array.** The
generator always appends a built-in `WidgetLiveActivity()` to the widget bundle,
and dispatches to our layout at runtime by the name given to
`createLiveActivity()`. The `widgets` array is for Home Screen widgets only.

Adding an entry for `AscendTimer` with `supportedFamilies: []` — the obvious
reading of the plan — generates `.supportedFamilies([.])`, which is a **Swift
syntax error** that would have failed the EAS build about twenty minutes in.
Verified by running the plugin's real file generator; the empty-`widgets` case is
explicitly handled and emits a valid `@main` bundle. `app.json` therefore
configures only the two identifiers.

**2. The widget function may close over nothing at all.** The `'widget'`
directive makes Babel serialise the function to a *string*, evaluated in a
separate JS context inside the extension with SwiftUI injected as globals. No
module constants, no helpers, no theme tokens, and Dates cannot be passed
(props go through `JSON.stringify`). This is why the accent colour is a literal
in the widget and the adapter sends epoch milliseconds.

### F2 closed — the pre-existing bug is fixed

The four call sites now pass `plannedFocusSeconds`. Rather than patch four
copies, the shared rule was extended with `elapsedInPhase()` and
`remainingInPhase()` in `lib/phaseDuration.ts`, and all five inline copies of the
computation (`pause`, `tick`, `complete`, `pauseStopwatch`, `reconstructSession`)
now route through it — the same consolidation `89a2a04` applied to
`getPhaseDuration` itself. `lib/phaseDuration.test.ts` pins the regression.

### Two further defects found while wiring this up

- **`clearUserData()` left an incoherent state.** It cleared `startedAt` but not
  `status`, so logging out mid-session left `status: 'running'` with a null
  anchor — a state nothing else can produce, where `tick()` returns early and the
  UI shows a running timer that cannot advance. It now resets to idle. This also
  closes the registry's logout row.
- **`pauseStopwatch()` does not pause.** It commits the elapsed time and returns
  to idle. The stopwatch has no paused state, so the plan's stopwatch-pause
  handling was unnecessary; `isPaused` is unreachable in stopwatch mode.

### Files

| File | Role |
|---|---|
| `lib/phaseDuration.ts` | +`elapsedInPhase`, `remainingInPhase` — one rule, all callers |
| `lib/phaseDuration.test.ts` | **new** — 11 tests, pins the F2 regression |
| `lib/liveActivityState.ts` | **new** — pure timer-state → card content |
| `lib/liveActivityState.test.ts` | **new** — 20 tests |
| `widgets/AscendTimerActivity.tsx` | **new** — Lock Screen + Dynamic Island layouts |
| `services/liveActivity.ts` | **new** — adapter: start/update/end/reconcile, serialised, all failures caught |
| `hooks/useTimerLiveActivity.ts` | **new** — store subscriber + foreground reconcile |
| `stores/timerStore.ts` | plan overlay passed; inline elapsed maths removed; logout resets |
| `app/(tabs)/index.tsx`, `store/hooks/useAnalytics.ts` | plan overlay passed |
| `app/_layout.tsx` | mounts the hook at root |
| `app.json` | `expo-widgets` plugin + explicit bundle/group identifiers |

### Local verification

`tsc --noEmit` clean · 162/162 vitest pass · `eslint` 0 errors (81 pre-existing
`no-console` warnings unchanged) · plugin file generation exercised directly.

`npx expo prebuild --platform ios` **cannot run on Windows** — it skips with
"Run npx expo prebuild again from macOS or Linux". The generated Xcode target,
entitlements and provisioning are therefore unverified until an EAS build.

### Still outstanding before this can be called done

1. An EAS **development build** (`npm run build:dev:ios`) — none of this runs in
   Expo Go, and nothing below can be checked without it.
2. The Phase 1 test gate, unchanged: lock screen counts down with no JS activity,
   pause freezes at the right time, resume continues, force-quit leaves no
   orphan, completion ends cleanly.
3. The **App Group** `group.com.hafeezrahman.ascend` must exist on the Apple
   Developer portal, and the widget extension's bundle ID
   `com.hafeezrahman.ascend.ExpoWidgetsTarget` needs its own provisioning
   profile. EAS usually creates both, but this is the step that surfaces at
   submission time if it goes wrong.
4. Colour and layout are a first pass. The Lock Screen composites over an unknown
   wallpaper and supports tinted rendering modes, so it wants a design pass on
   real hardware, not a guess from here.
5. Phase 2's interactive pause/resume buttons are **not** built.
   `addUserInteractionListener()` is the hook for it when that starts.

---

## Review pass (2026-08-26) — three defects found by re-reading the diff

Found by review, not by running it: none of this has been on a device yet, so
these were reasoned from the store rather than observed.

### 1. Editing durations mid-session desynced the card

The phase end is **derived** from `settings`, not stored — `remainingInPhase()`
reads the durations on every call. The duration sheet on the Timer screen
(`app/(tabs)/index.tsx:559`) is not gated on timer status, so it opens mid-run,
and `setWorkDuration()` moves the in-app end date immediately.

`useTimerLiveActivity`'s change check did not watch `settings`, so the card kept
the old end date: go 25 → 50 minutes mid-session and the Lock Screen would hit
00:00 twenty-five minutes early while the app kept counting. Exactly the
app/card disagreement the design forbids.

Fixed by adding `state.settings !== prev.settings` to the subscriber's change
check. Reference comparison is deliberate — the store replaces the object on
every edit, and a spurious sync costs nothing because `needsUpdate` still gates
the write.

**Note the same gap exists in `useTimerNotifications`, where it is deliberate**
(`index.tsx:928`: "a running timer keeps its original alarm"). Now that the
in-app clock does move, that older choice means the timer, the notification and
the card can disagree three ways. Unresolved; it is a product decision, not a
bug fix.

### 2. A phase ending in the background left the card reading 00:00

`tick()` is driven only from the Timer screen (`app/(tabs)/index.tsx:138`), so
if the phone is locked when the phase ends, `complete()` never runs, `status`
stays `running`, and nothing ends the card. The completion notification fires;
the Lock Screen goes on insisting the session is live.

`staleDate` is the only lever iOS offers with no app running, and it was being
spent: `staleDateFor()` returned *session start + 7h50m* for every card,
including a 25-minute pomodoro. It now returns `rangeEndMs` for a running
countdown. Paused cards and the stopwatch keep the ActivityKit ceiling — a
frozen card stays correct however long it sits, and a stopwatch has no end to be
late for.

This de-emphasises the card; it does not remove it. Ending it still requires the
app to notice. A real fix is a background task or a push-updated activity, both
out of scope here.

### 3. `endLiveActivity()` was dead

Exported, never called. Stop, completion and logout all end the card through the
ordinary path — the store reaches a state with no session, `toActivityProps`
returns null, `syncNow` ends it — and `reconcileNow` calls `endNow` directly.
Removed rather than wired: a public ender is a second way to end the card, one
callable without the store agreeing, which is how the two start disagreeing.

### Not fixed

`widgets/AscendTimerActivity.tsx` imports `@expo/ui`, which is not in
`mobile/package.json`. It resolves because `expo-widgets` depends on it directly
(`@expo/ui@~57.0.13`), so this is latent rather than broken — the same class as
the `expo-constants` issue already fixed. Declaring it means a lockfile change;
left for whenever dependencies are next touched.

### Verification

`tsc --noEmit` clean · 165/165 vitest pass (162 + 3 new) · `eslint` clean on all
changed files. **The Phase 1 test gate above is still entirely unrun** — every
one of these fixes is unverified on hardware, like the feature they patch.
