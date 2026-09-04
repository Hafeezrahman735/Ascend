# `store/` vs `stores/` — which is which

Two similarly-named directories exist. The names collide, and that is a common
source of confusion when reading this codebase.

## `stores/` (plural) — **the state**

The actual Zustand stores. This is where data lives and where mutations happen.

| Store | Owns |
|---|---|
| `authStore` | session, tokens, current user |
| `taskStore` | tasks, recurring templates |
| `goalStore` | TaskGoals |
| `calendarStore` | calendar range items, notes |
| `socialStore` | feed, groups, leaderboards, follows |
| `gamificationStore` | XP, streak, achievements, activity log |
| `timerStore` | timer state + timer settings |
| `userProfileStore` | display name, avatar |
| `userSettingsStore` | preferences (theme, notifications, privacy) |

**Add new state here.**

## `store/` (singular) — two things, and that is all

- `store/sync.ts` — the local session-history cache and its reconciliation with
  the server. It owns real AsyncStorage data and has nine importers. Load-bearing.
- `store/hooks/index.ts` — five grouped store reads, for the places that need a
  GROUP of fields at once and rely on `useShallow` to avoid re-rendering on
  unrelated state.

## The rule for `store/hooks/`

**A hook belongs here only when a component needs several fields together.** For
a single field, call the store directly with a selector —
`useTimerStore((s) => s.timeLeft)` — the way `app/(tabs)/focus.tsx` does
throughout.

This matters because the directory used to hold 34 hooks across five files, plus
a `selectors/` directory of pure derivations under them. Exactly **five** hooks
were ever imported. The other 29 — and every selector that existed only to feed
them — were written speculatively, never called, and have been deleted. Most were
one-line wrappers around a single store field, which is precisely what the rule
above exists to prevent.

One selector, `calcDaysUntilDue`, had a real consumer and moved to
`lib/taskMetrics.ts` alongside it.

## Why not just rename one?

Renaming `store/` → something clearer is worth doing, but it touches imports in
the timer, tasks and profile screens for zero user benefit. Deliberately
deferred; this file exists so the distinction is discoverable meanwhile. It is a
much smaller job now than it was.
