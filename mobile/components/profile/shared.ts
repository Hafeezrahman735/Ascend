import type { ThemeColors } from '../../hooks/useTheme';

/**
 * Helpers shared by the profile screen and the sections extracted out of it.
 *
 * These were private to app/(tabs)/goals.tsx. Extracting any section from that
 * file needs them, so they live here rather than being duplicated per component
 * or passed down as props.
 */

/** Small uppercase heading above each profile section. */
export const sectionLabel = (c: ThemeColors) => ({
  color: c.subtext,
  fontSize: 11,
  fontWeight: '600' as const,
  letterSpacing: 1.5,
  textTransform: 'uppercase' as const,
  marginBottom: 12,
});

/** 1200 -> "1.2k". Keeps long XP totals from wrapping the rank card. */
export function fmtXP(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** ISO timestamp -> "Mar 4". Used on earned achievements. */
export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(iso);
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
