// ─── Type system ──────────────────────────────────────────────────────────────
// Until now the app had no loaded fonts at all: every fontFamily in the codebase
// resolved to the string 'monospace', and everything else fell through to System
// (SF Pro / Roboto). Hierarchy was carried entirely by weight, size and wide
// letterSpacing on tiny uppercase labels — the tracking was doing the work a
// display face should do.
//
// Four families, each with one job:
//
//   Space Grotesk  the timer readout and screen titles. Geometric, slightly
//                  mechanical, and its digits hold a strong vertical rhythm at
//                  large sizes.
//   Inter          body and UI text. Designed for screens at small sizes.
//   Fraunces       Profile and stats only. This is the warm, editorial half of
//                  the brand; keeping it off the Focus screen is what lets the
//                  two surfaces feel different without two colour schemes.
//   JetBrains Mono every number that sits in a column or ticks — replaces the
//                  generic 'monospace', which rendered as Courier on iOS.

export const Font = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',

  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',

  editorial: 'Fraunces_400Regular',
  editorialBold: 'Fraunces_600SemiBold',

  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

// ─── Scale ────────────────────────────────────────────────────────────────────
// Nothing below 12. The previous floor was 9, which is where most of the
// screen's contrast problems started.

export const Type = {
  /** Timer readout. */
  display: 56,
  title: 22,
  heading: 18,
  body: 16,
  label: 13,
  /** Hard floor — if it does not fit at 12 it does not belong on the screen. */
  micro: 12,
} as const;

export type FontToken = keyof typeof Font;
