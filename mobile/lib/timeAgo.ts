/**
 * "5m ago", "3h ago", "Yesterday", "4d ago" for a past ISO timestamp.
 *
 * Shared by the Community feed and the notifications inbox, which used to live
 * on the same screen and kept a private copy.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : `${d}d ago`;
}
