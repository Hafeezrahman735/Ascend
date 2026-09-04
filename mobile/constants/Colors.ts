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
  // `trace` is the brand's own hue: the colour of a finished session, a live
  // streak, and the orbit-tail mark itself. Named for what it means, not for
  // what colour it happens to be — it is teal in dark, green in light.
  trace: '#00E5C3',
  traceDim: '#003d35',
  inactive: '#2E2C50',
  border: '#2C2C6A',

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

  trace: '#2D8A6A',   // green replaces teal for completion states
  traceDim: '#E0F4EE',   // green chip background

  inactive: '#EAD5C8',   // progress rails, empty track
  border: '#E8DDD5',   // card borders, dividers

  success: '#2D8A6A',
  warning: '#D4820A',   // amber readable on white
  error: '#D04070',   // rose readable on white
  activeGreen: '#2D8A6A',
};
