# `store/` vs `stores/` — which is which

Two similarly-named directories exist. Neither is broken, but the names collide
and that is a common source of confusion when reading this codebase.

## `stores/` (plural) — **the state**

The actual Zustand stores. This is where data lives and where mutations happen.

| Store | Owns |
|---|---|
| `authStore` | session, tokens, current user |
| `taskStore` | tasks, recurring templates |
| `goalStore` | TaskGoals |
| `calendarStore` | calendar range items, notes |
| `socialStore` | feed, groups, leaderboards, follows |
| `gamificationStore` | XP, level, streak, achievements, activity log |
| `timerStore` | timer state + timer settings |
| `userProfileStore` | display name, avatar |
| `userSettingsStore` | preferences (theme, notifications, privacy) |

**Add new state here.**

## `store/` (singular) — **the derived view**

A thin read layer built *on top of* some of those stores. It holds no state of
its own:

- `store/selectors/` — pure functions deriving values from store state
  (`calcIsIdle`, `calcPhaseLabel`, `computeIsLongBreak`, …)
- `store/hooks/` — hooks that bundle selectors into a component-shaped view
  (`useFocusTimer`, `useTasks`, `useBreakProgress`, `useAnalytics`, `useUI`)
- `store/sync.ts` — local session-history cache and its reconciliation with the
  server (the one genuine exception: it does own AsyncStorage data)

**Add derived/computed reads here.** If you are writing `set(...)`, you are in
the wrong directory.

## Why not just rename one?

Renaming `store/` → `selectors/` would be clearer and is worth doing, but it
touches every import in the timer, tasks and profile screens for zero user
benefit. It is deliberately deferred rather than forgotten — this file exists so
the distinction is discoverable in the meantime.
