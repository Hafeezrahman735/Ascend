// ─── Spacing & radius scale ───────────────────────────────────────────────────
// One 4pt scale for the whole app. Roughly 80% of the values already in the
// codebase sit on this grid; the remainder (7, 9, 11, 13, 15, 18, 22, 26, 34)
// were one-off literals that made spacing look arbitrary rather than systematic.
//
// Snapping guide when migrating an existing literal:
//
//   7,  9        → sm (8)
//   11, 13       → md (12)
//   15, 18       → lg (16)
//   22, 26       → xxl (24)
//   34           → section (32)
//   10           → md (12), or sm (8) when deliberately tightening
//   14           → md (12), or lg (16) when deliberately opening up
//
// 10 and 14 are the two high-traffic off-grid values (102 and 101 uses). They
// are a judgement call per site, not a blind find-and-replace: pick the
// direction that preserves the existing visual grouping.

export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  /** Gap between major sections within a screen. */
  section: 32,
  /** Outer breathing room at the top/bottom of a scroll view. */
  page: 48,
} as const;

// ─── Radius ───────────────────────────────────────────────────────────────────
// Previously 20 distinct values from 2 to 80, with 12 / 14 / 10 all competing
// for the same role. Five tokens cover every real case in the app.

export const Radius = {
  /** Chips, tags, small inline controls. */
  sm: 8,
  /** Inputs, list rows, tiles. */
  md: 12,
  /** Cards. */
  lg: 16,
  /** Sheets, modals, hero surfaces. */
  xl: 24,
  /** Circular buttons and pills — any value past half the height reads the same. */
  pill: 999,
} as const;

export type SpaceToken = keyof typeof Space;
export type RadiusToken = keyof typeof Radius;
