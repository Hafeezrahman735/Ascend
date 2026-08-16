import * as Calendar from 'expo-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { CalendarItem } from '../types';

/**
 * Apple / device-native calendar integration.
 *
 * DELIBERATELY DEVICE-ONLY. Nothing here is ever sent to the backend: no tokens,
 * no event contents, no calendar ids. The chosen calendar id lives in
 * AsyncStorage, and events are read at render time for the visible range only.
 * There is intentionally no ExternalCalendarConnection row with provider
 * 'apple' — that data must not leave the device.
 */

const SELECTED_CALENDAR_KEY = (userId: string) => `calendar:apple:selected:${userId}`;

export interface DeviceCalendar {
  id: string;
  title: string;
  source: string;
  color: string;
}

/** expo-calendar is iOS/Android native only — no-op on web. */
export function isAppleCalendarSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function requestCalendarPermission(): Promise<boolean> {
  if (!isAppleCalendarSupported()) return false;
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    console.warn('[appleCalendar] permission request failed:', err);
    return false;
  }
}

export async function hasCalendarPermission(): Promise<boolean> {
  if (!isAppleCalendarSupported()) return false;
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/** The device's event calendars, for the user to pick from (usually iCloud/Home). */
export async function listDeviceCalendars(): Promise<DeviceCalendar[]> {
  if (!isAppleCalendarSupported()) return [];
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return calendars.map((c) => ({
      id: c.id,
      title: c.title,
      source: c.source?.name ?? 'Device',
      color: c.color ?? '#7B6EF6',
    }));
  } catch (err) {
    console.warn('[appleCalendar] listing calendars failed:', err);
    return [];
  }
}

export async function getSelectedCalendarId(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SELECTED_CALENDAR_KEY(userId));
  } catch {
    return null;
  }
}

export async function setSelectedCalendarId(userId: string, calendarId: string | null): Promise<void> {
  try {
    if (calendarId) {
      await AsyncStorage.setItem(SELECTED_CALENDAR_KEY(userId), calendarId);
    } else {
      await AsyncStorage.removeItem(SELECTED_CALENDAR_KEY(userId));
    }
  } catch (err) {
    console.warn('[appleCalendar] persisting selection failed:', err);
  }
}

/** Local calendar day of a Date, as 'YYYY-MM-DD'. */
function toLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Device events for an inclusive 'YYYY-MM-DD' range, normalised into the same
 * CalendarItem shape the server returns — so the renderer treats Apple and
 * Google events identically.
 */
export async function fetchAppleEvents(
  calendarId: string,
  start: string,
  end: string,
): Promise<CalendarItem[]> {
  if (!isAppleCalendarSupported()) return [];
  if (!(await hasCalendarPermission())) return [];

  // Local midnight to end-of-day local, so the window matches what the user sees.
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);

  try {
    const events = await Calendar.getEventsAsync([calendarId], startDate, endDate);
    return events.map((e) => {
      const eventStart = new Date(e.startDate as string);
      return {
        type: 'external_apple' as const,
        date: toLocalDateKey(eventStart),
        data: {
          id: e.id,
          title: e.title || '(no title)',
          startTime: e.allDay ? null : eventStart.toISOString(),
          endTime: e.allDay || !e.endDate ? null : new Date(e.endDate as string).toISOString(),
          isAllDay: !!e.allDay,
        },
      };
    });
  } catch (err) {
    console.warn('[appleCalendar] fetching events failed:', err);
    return [];
  }
}
