import { describe, it, expect } from 'vitest';
import {
  appendNotificationPage,
  parseNotificationPage,
  toInAppNotification,
  type NotificationRow,
} from './notificationPages';

function row(id: string, isRead = false, body = ''): NotificationRow {
  return { id, type: 'follow', title: `Title ${id}`, body, isRead, createdAt: '2026-10-21T12:00:00.000Z' };
}

describe('toInAppNotification', () => {
  it('joins title and body', () => {
    expect(toInAppNotification(row('a', false, 'started following you')).text).toBe('Title a: started following you');
  });

  it('shows the title alone when there is no body', () => {
    expect(toInAppNotification(row('a')).text).toBe('Title a');
  });
});

describe('parseNotificationPage', () => {
  it('takes the unread total from the server, not from the page', () => {
    // The bug: 120 unread used to read as however many were in the first 50.
    const page = parseNotificationPage({
      data: [row('a'), row('b', true)],
      cursor: 'next',
      unreadCount: 120,
    });

    expect(page.unreadCount).toBe(120);
    expect(page.cursor).toBe('next');
    expect(page.items.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('marks the last page with a null cursor', () => {
    expect(parseNotificationPage({ data: [row('a')], cursor: null, unreadCount: 1 }).cursor).toBeNull();
  });

  it('falls back to counting the page when the server sends no total', () => {
    const page = parseNotificationPage({ data: [row('a'), row('b'), row('c', true)] });
    expect(page.unreadCount).toBe(2);
    expect(page.cursor).toBeNull();
  });

  it('treats a missing or malformed body as empty', () => {
    expect(parseNotificationPage({}).items).toEqual([]);
    expect(parseNotificationPage({ data: { not: 'an array' } }).items).toEqual([]);
  });
});

describe('appendNotificationPage', () => {
  it('appends older rows after the ones already shown', () => {
    const first = [row('a'), row('b')].map(toInAppNotification);
    const older = [row('c'), row('d')].map(toInAppNotification);

    expect(appendNotificationPage(first, older).map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never shows the same notification twice when pages shift', () => {
    const first = [row('a'), row('b')].map(toInAppNotification);
    const older = [row('b'), row('c')].map(toInAppNotification);

    expect(appendNotificationPage(first, older).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});
