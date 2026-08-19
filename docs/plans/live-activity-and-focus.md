# Ascend — Timer Live Activity + Focus nudge

Status: **planned, Phase 2a implemented**
Branch: `staging` · Written 2026-08-19

---

## What changed versus the original brief

The brief named three Live Activity libraries and assumed a URL scheme could open
the iOS Focus settings pane. Both premises were checked against npm, GitHub and
Apple's developer forums rather than taken on trust. Two of the three libraries
are dead, and the deep link is a rejection risk.

### Library evidence (checked 2026-08-19)

| Package | Latest | Published | Weekly DL | Verdict |
|---|---|---|---|---|
| `expo-live-activity` | 0.4.2 | 2025-11-18 | 10,543 | **Archived + deprecated 2026-06-01** |
| `@kingstinct/react-native-activity-kit` | 0.0.10 | 2025-12-19 | **33** | Pre-1.0, pulls `react-native-nitro-modules`, dead |
| `@bacons/apple-targets` | 5.0.0 | 2026-07-17 | 285,019 | Healthy, but generic target scaffolding — SwiftUI is yours |
| **`expo-widgets`** | 57.0.10 | 2026-08-14 | **102,579** | Official, stable since SDK 56, Live Activities as React components |

`expo-live-activity`'s own deprecation notice reads verbatim: *"This library is
deprecated. Consider other solutions like expo-widgets"*, with commit
`2026-06-01 Deprecate expo-live-activity library`.

Ascend is on `expo@54`. Current is `expo@57.0.14` (2026-08-17).

### Settings deep link is not available

Apple Developer Relations, quoted on the developer forums: *"linking to any part
of Settings other than your app's own settings page with
`UIApplicationOpenSettingsURLString` is unsupported"* and *"if you're using a URL
that begins with `prefs:` or `App-Prefs:` you will be rejected."*

`App-Prefs:root=DO_NOT_DISTURB` is undocumented, therefore private API, therefore
a rejection risk. There is no sanctioned deep link to the Focus pane. The plan
uses `Linking.openSettings()` (the app's own page, documented and safe) plus an
in-app walkthrough, and never constructs an `App-Prefs:` URL.

---

## Decisions taken

**D1 → upgrade to SDK 56+ and use `expo-widgets`.** Zero hand-written SwiftUI,
which was the brief's stated criterion ("least native-code surface area to
hand-maintain, given this is a solo-maintained project"). Cost: an Expo 54 → 56/57
migration lands before any Lock Screen work.

**D2 → `SetFocusFilterIntent` splits out to Phase 2b.** It needs a native App
Intent target and a dev-client build; the rest of the Focus nudge is plain JS and
ships immediately.

Reinforcing D1: this repo is developed on Windows with no Xcode. Hand-written
Swift could not be compiled or type-checked locally — every mistake would surface
only after a ~20 minute EAS cloud build. `expo-widgets` removes that loop entirely.

---

## Delivery order

```
  2a  Focus nudge, JS only          SDK 54, Expo Go        SHIPPABLE NOW
   │
   ├── independent of everything below
   │
  U   Expo 54 -> 56/57 upgrade      whole-app regression   needs your machine
   │
   1  Live Activity, expo-widgets   dev-client build       after U
   │
  2b  SetFocusFilterIntent          native App Intent      after U
```

Phase 2a is deliberately first: it is the only piece with no native dependency,
so it delivers value without waiting on the migration.

---

## Phase 2a — Focus nudge (JS only) · IMPLEMENTED

### Files

| File | Change |
|---|---|
| `mobile/stores/userSettingsStore.ts` | `remindFocusMode: boolean` added to `SettingsData` + `DEFAULTS`. Local-only: it is absent from `PRIVACY_KEYS` / `NOTIF_KEYS` / `REMINDER_KEYS`, so `update()` never sends it to the backend — same treatment as `theme` and `weekStartDay`. |
| `mobile/components/FocusModeSheet.tsx` | New. The walkthrough: what Focus does, why Ascend wants it, the Shortcuts Automation steps, and the two buttons. |
| `mobile/app/settings.tsx` | New "Focus Mode" section between Notifications and Appearance. |

Storage rides on the existing `settings:${userId}` blob rather than a new
AsyncStorage key, matching the user-scoped convention (`goals:cache:${userId}`,
`profile:${userId}`) and avoiding a second source of truth.

### Behaviour

- The section explains what Focus does **before** asking for anything. No dumping
  the user into iOS Settings cold.
- "Set up Focus" opens the sheet. The sheet carries the honest explanation: iOS
  gives no app the ability to switch Focus on, so this is a guided manual setup.
- The Shortcuts Automation walkthrough is written out step by step. `shortcuts://`
  opens the app; an automation cannot be pre-filled by a third party, so the steps
  are text. If Shortcuts is missing, the button is hidden rather than dead.
- "Open iOS Settings" uses `Linking.openSettings()`. Copy says it lands on
  Ascend's own page, because that is where it lands.
- `remindFocusMode` is a reminder preference only. It gates a nudge; it never
  blocks starting a session.

### Deliberately NOT done in 2a

- No `App-Prefs:` URL. Rejection risk, documented above.
- No claim that Ascend can enable Focus. It cannot.
- No blocking of session start on the nudge.

---

## Phase U — Expo 54 → 56/57 upgrade

Not started. Prerequisite for Phase 1 and 2b.

- `expo@54.0.37` → `56.x` or `57.x`. Two or three majors.
- `expo-router@6`, `expo-notifications@0.32`, `react-native@0.81.5` all move.
- Blast radius is the whole app. Needs a full regression pass, not a spot check.
- Must be its own branch and its own landing. Bundling it with feature work would
  make a regression impossible to attribute.
- I cannot verify an iOS build from Windows. `eas build -p ios --profile development`
  runs on remote macOS workers, so it works from here, but only you can install
  and exercise the result.

---

## Phase 1 — Live Activity via `expo-widgets`

Not started. Depends on Phase U.

### Design

The Live Activity **mirrors** `timerStore`; it is never a source of truth. The
timer stays frontend-owned: local countdown, fire-and-forget REST, Socket.IO for
broadcasts only. No server round-trip enters the tick loop.

```
  timerStore  (source of truth, local)
      │  start / pause / resume / complete / skip / reset
      ▼
  liveActivity.ts   thin adapter, subscribes to timerStore
      │  start()  update()  end()
      ▼
  expo-widgets  ──▶  Lock Screen + Dynamic Island
```

The adapter subscribes to the store. The store must not import the adapter —
that is what reintroduces the `sync.ts → TimeEngine.ts → timerStore.ts → sync.ts`
cycle that has crashed app load before. (`TimeEngine.ts` no longer exists in the
tree; the cycle is historical, but the shape of the mistake is not.)

Countdown rendering uses an end-timestamp handed to the widget once, so the OS
renders the ticking text itself. No per-second bridge traffic.

### Lifecycle and failure modes

| Event | Store | Live Activity |
|---|---|---|
| `start()` | running | start with `endsAt` |
| `pause()` | paused | update to static remaining |
| `resume()` | running | update with new `endsAt` |
| `complete()` / `skip()` / `reset()` | idle | end |
| App backgrounded | unchanged | unchanged, OS keeps rendering |
| **App force-quit** | rehydrates from `timer:activeSession` | may outlive the app |
| **OS reclaims the activity** | unchanged | gone |

The two rows in bold are where Lock Screen and app can contradict each other.
Rule: **on every app foreground, reconcile.** If the store has no running session,
end any activity found. If the store has one and no activity exists, start one.
`timerStore` already persists `timer:activeSession`, so rehydration is the
authority and the activity is rebuilt from it, never the reverse.

ActivityKit caps an activity at ~8 hours. Irrelevant at Pomodoro lengths, but the
adapter should end and restart rather than let the OS silently drop it.

### Theming

Live Activities render in a constrained widget context. Colors from
`hooks/useTheme` can carry over as literals; anything derived at runtime cannot.
Fallback is the brand purple `#7B6EF6` (already the `expo-notifications` color in
`app.json`) on the dark ground `#08081A` (already the splash background).

### Interactive buttons — Phase 1b

Pause/resume from the Lock Screen needs App Intents, not just display, and an
intent that can reach into JS state. Deferred. Display-only first; the
reconciliation rule above is what makes buttons safe to add later.

---

## Phase 2b — `SetFocusFilterIntent`

Not started. Depends on Phase U.

Lets Ascend react to a Focus that is already on (for example, not playing the
timer-complete chime at full volume). What is actually inspectable needs
confirming against the SDK before scoping — do not assume the app can read which
Focus is active, only that a filter can be applied to itself.

---

## Phase 3 — Screen Time / app shielding

**Out of scope. No code, no entitlements, no targets.**

FamilyControls / ManagedSettings / DeviceActivity need a separately-requested,
manually-reviewed Apple entitlement per bundle ID and per extension. That request
is being handled outside this work. Nothing here starts until it is approved.

Logged as a Phase 3 candidate only.
