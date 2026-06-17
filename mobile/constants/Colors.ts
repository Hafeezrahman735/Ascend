// ─── Two palettes: Deep Focus Midnight (dark) and Warm Dawn (light) ──────────
// Both objects MUST have identical key sets. `darkColors` is a verbatim copy of
// the original Colors object. Color access is reactive via the useTheme() hook.

export const darkColors = {
  bg: '#08081A',
  surface: '#10103A',
  raised: '#1E1E52',
  primary: '#7B6EF6',
  primarySoft: '#A89CF9',
  primaryDim: '#2a2560',
  text: '#B8AEFF',
  textBright: '#EEE9FF',
  subtext: '#6B6899',
  accent: '#00E5C3',
  tealDim: '#003d35',
  inactive: '#2E2C50',
  border: '#2C2C6A',

  // Legacy dark*/light* aliases — kept so existing call sites resolve.
  // In dark mode they map to the dark equivalents.
  darkBg: '#08081A',
  lightBg: '#08081A',
  darkCard: '#10103A',
  lightCard: '#10103A',
  darkText: '#B8AEFF',
  lightText: '#B8AEFF',
  darkSubtext: '#6B6899',
  lightSubtext: '#6B6899',

  success: '#00E5C3',
  warning: '#F59E0B',
  error: '#EF4444',
  activeGreen: '#00E5C3',
};

export const lightColors: typeof darkColors = {
  bg: '#FEFAF7',   // warm cream background
  surface: '#FFFFFF',   // cards — pure white
  raised: '#F0EAE4',   // inputs, toggles, control buttons

  primary: '#E05A3A',   // coral red — replaces purple
  primarySoft: '#C84020',   // darker coral for text on light bg
  primaryDim: '#FDE8E2',   // coral chip backgrounds

  text: '#3A2218',   // warm dark brown body text
  textBright: '#1A0A00',   // headings, primary labels
  subtext: '#9A8070',   // muted / secondary labels

  accent: '#2D8A6A',   // green replaces teal for completion states
  tealDim: '#E0F4EE',   // green chip background

  inactive: '#EAD5C8',   // progress rails, empty track
  border: '#E8DDD5',   // card borders, dividers

  // Legacy aliases map to the light equivalents so call sites theme correctly.
  darkBg: '#FEFAF7',
  lightBg: '#FEFAF7',
  darkCard: '#FFFFFF',
  lightCard: '#FFFFFF',
  darkText: '#3A2218',
  lightText: '#3A2218',
  darkSubtext: '#9A8070',
  lightSubtext: '#9A8070',

  success: '#2D8A6A',
  warning: '#D4820A',   // amber readable on white
  error: '#D04070',   // rose readable on white
  activeGreen: '#2D8A6A',
};

// Backward-compatible static export. Defaults to the dark palette so any module
// that reads Colors at load time (or hasn't been migrated to useTheme) still
// renders the original Deep Focus Midnight look.
export const Colors = darkColors;
