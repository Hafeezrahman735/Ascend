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

// These are the fonts' own PostScript names, and the filenames in assets/fonts
// are identical to them on purpose. The files are compiled into the binary by
// the expo-font config plugin, and the two platforms name an embedded face
// differently: iOS resolves it by PostScript name (via UIAppFonts), Android by
// the asset's filename. Naming the file after the PostScript name is what makes
// one string work on both.
//
// They used to be the @expo-google-fonts export names (Inter_400Regular and
// friends), which were aliases expo-font registered at runtime after
// downloading the files. Nothing is downloaded now, so those aliases no longer
// exist.
//
// The four @expo-google-fonts packages stay in package.json even though nothing
// imports them any more: they are where assets/fonts came from, and they are how
// you get the next weight. To add one, copy the .ttf across, rename it to the
// PostScript name recorded in the file's own name table — not to whatever the
// package called it — and add the token here.
export const Font = {
  display: 'SpaceGrotesk-Bold',
  displayMedium: 'SpaceGrotesk-Medium',

  body: 'Inter-Regular',
  bodyMedium: 'Inter-Medium',
  bodySemibold: 'Inter-SemiBold',
  bodyBold: 'Inter-Bold',

  editorial: 'Fraunces-Regular',
  editorialBold: 'Fraunces-SemiBold',

  mono: 'JetBrainsMono-Regular',
  monoMedium: 'JetBrainsMono-Medium',
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
