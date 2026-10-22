import type { InAppNotification } from '../types';

/**
 * Paging for the in-app notification list.
 *
 * The app used to read only GET /notifications' first page, so anything past
 * the newest 50 could never be reached, and the unread badge counted only the
 * unread rows inside that page — 50 unread showed as 50 however many there
 * really were. The server now reports the true unread total beside each page.
 *
 * Pure, so the merge and the response parsing can be tested without the store.
 */

/** One row as GET /notifications sends it. */
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: InAppNotification[];
  /** Pass back to fetch the next, older page. Null means this was the last. */
  cursor: string | null;
  /** Every unread notification the user has, not just those in this page. */
  unreadCount: number;
}

export function toInAppNotification(row: NotificationRow): InAppNotification {
  return {
    id: row.id,
    text: row.title + (row.body ? `: ${row.body}` : ''),
    createdAt: row.createdAt,
    isRead: row.isRead,
  };
}

/**
 * Reads a GET /notifications response.
 *
 * `data` stays a bare array on the wire so builds already in people's hands
 * keep working; `cursor` and `unreadCount` ride alongside it. A server without
 * `unreadCount` falls back to counting the page, which is what the app did
 * before.
 */
export function parseNotificationPage(response: {
  data?: unknown;
  cursor?: unknown;
  unreadCount?: unknown;
}): NotificationPage {
  const rows = Array.isArray(response.data) ? (response.data as NotificationRow[]) : [];
  const items = rows.map(toInAppNotification);
  return {
    items,
    cursor: typeof response.cursor === 'string' ? response.cursor : null,
    unreadCount:
      typeof response.unreadCount === 'number'
        ? response.unreadCount
        : items.filter((n) => !n.isRead).length,
  };
}

/**
 * Appends an older page to what is already shown.
 *
 * Deduplicated by id: a notification created between two fetches shifts the
 * server's pages, and the same row must never render twice.
 */
export function appendNotificationPage(
  existing: InAppNotification[],
  older: InAppNotification[],
): InAppNotification[] {
  const seen = new Set(existing.map((n) => n.id));
  return [...existing, ...older.filter((n) => !seen.has(n.id))];
}
