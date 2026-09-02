// Scoped single-API package, not the `googleapis` meta-package — that one pulls
// in every Google API (208MB, ~3s of import time on every cold start) to use
// one. This is the same client, just for Calendar alone.
import jwt from 'jsonwebtoken';
import { auth, calendar } from '@googleapis/calendar';
import type { ExternalCalendarConnection } from '@prisma/client';
import { prisma } from './prisma';
import { config } from '../config';
import { open, seal } from './secretBox';

type OAuth2Client = InstanceType<typeof auth.OAuth2>;

/**
 * Google Calendar integration (read-only pull).
 *
 * Everything here is optional at runtime: if the Google env vars are unset the
 * server still boots and the calendar simply works without external events.
 * That keeps local dev and any deploy that hasn't configured OAuth fully
 * functional rather than crashing on startup.
 */

const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events.readonly'];

export function isGoogleConfigured(): boolean {
  return !!(
    config.GOOGLE_CLIENT_ID &&
    config.GOOGLE_CLIENT_SECRET &&
    config.GOOGLE_REDIRECT_URI
  );
}

export function getOAuthClient(): OAuth2Client {
  if (!isGoogleConfigured()) {
    throw new Error('Google Calendar is not configured on this server');
  }
  return new auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI,
  );
}

/**
 * How long a started OAuth flow stays valid. Long enough to read Google's
 * consent screen and pick an account, short enough that a `state` captured from
 * a browser history or a proxy log is useless by the time anyone finds it.
 */
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_STATE_PURPOSE = 'google-calendar-connect';

interface OAuthStatePayload {
  userId: string;
  purpose: string;
}

/**
 * `state` is a SIGNED token, not the bare user id.
 *
 * It used to be the raw userId, and the callback only checked that the value
 * named a real user. User ids are UUIDs but they are not secret — every
 * leaderboard, the search endpoint and /social/users/:userId all return them —
 * so anyone holding a victim's id could run the consent flow with their OWN
 * Google account and `state=<victim id>`, and the callback would write the
 * attacker's calendar tokens into the victim's connection row. The victim's
 * calendar then renders the attacker's events, and their real connection is
 * silently overwritten. Signing closes it completely: an attacker cannot
 * produce a valid signature over someone else's id, and a replay of their own
 * state can only ever write to their own row.
 *
 * Signed with JWT_ACCESS_SECRET rather than a new secret so this needs no new
 * environment variable and no deploy-ordering step. The `purpose` claim stops
 * the token being interchangeable with an access token signed by the same key.
 */
export function buildAuthUrl(userId: string): string {
  const state = jwt.sign(
    { userId, purpose: OAUTH_STATE_PURPOSE } satisfies OAuthStatePayload,
    config.JWT_ACCESS_SECRET,
    { expiresIn: OAUTH_STATE_TTL_SECONDS },
  );
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline', // required to receive a refresh token
    scope: GOOGLE_SCOPES,
    state,
    prompt: 'consent', // force a refresh token even on re-consent
  });
}

/**
 * The user id inside a callback's `state`, or null when it is missing, expired,
 * signed with the wrong key, or not a connect token at all.
 *
 * Returns null rather than throwing: every failure here ends at the same
 * "failed" deep link, and distinguishing them for the caller would only give an
 * attacker a way to tell "bad signature" from "expired".
 */
export function userIdFromOAuthState(state: string | undefined): string | null {
  if (!state) return null;
  try {
    const payload = jwt.verify(state, config.JWT_ACCESS_SECRET) as Partial<OAuthStatePayload>;
    if (payload.purpose !== OAUTH_STATE_PURPOSE) return null;
    return typeof payload.userId === 'string' ? payload.userId : null;
  } catch {
    return null;
  }
}

/**
 * Return a client authorised for this connection, refreshing the access token
 * first when it is expired or about to be.
 *
 * Refreshing here rather than on a 401 means the very first Calendar API call of
 * a session doesn't have to fail before we notice.
 */
async function authorizedClient(connection: ExternalCalendarConnection): Promise<OAuth2Client> {
  const client = getOAuthClient();
  // Stored sealed when TOKEN_ENCRYPTION_KEY is set. `open` passes plaintext
  // through untouched, so rows written before the key existed keep working.
  const storedRefresh = open(connection.refreshToken);
  client.setCredentials({
    access_token: open(connection.accessToken),
    refresh_token: storedRefresh,
    expiry_date: connection.expiresAt.getTime(),
  });

  // 60s skew so a token that expires mid-request is refreshed up front.
  const isExpired = connection.expiresAt.getTime() - Date.now() < 60_000;
  if (!isExpired) return client;

  const { credentials } = await client.refreshAccessToken();
  client.setCredentials(credentials);

  await prisma.externalCalendarConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: seal(credentials.access_token ?? open(connection.accessToken)),
      // Google only returns a refresh token on first consent — keep the stored
      // one when the response omits it, or the connection breaks on next refresh.
      // Re-sealing the carried-over value is what migrates a plaintext row: any
      // connection that refreshes after the key is set comes back encrypted.
      refreshToken: seal(credentials.refresh_token ?? storedRefresh),
      expiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600_000),
    },
  });

  return client;
}

export interface NormalizedGoogleEvent {
  id: string;
  date: string; // 'YYYY-MM-DD' — the day this event renders on
  title: string;
  startTime: string | null; // ISO instant for timed events, null for all-day
  endTime: string | null;
  isAllDay: boolean;
}

/**
 * Events between two calendar days, normalised to the shape the calendar
 * aggregation returns for local items.
 *
 * `end` is inclusive, so the query window is pushed to the following midnight —
 * timeMax is exclusive in the Google API.
 */
export async function fetchGoogleEvents(
  connection: ExternalCalendarConnection,
  start: string,
  end: string,
): Promise<NormalizedGoogleEvent[]> {
  const client = await authorizedClient(connection);
  const api = calendar({ version: 'v3', auth: client });

  const timeMax = new Date(`${end}T00:00:00.000Z`);
  timeMax.setUTCDate(timeMax.getUTCDate() + 1);

  const response = await api.events.list({
    calendarId: connection.calendarId || 'primary',
    timeMin: new Date(`${start}T00:00:00.000Z`).toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true, // expand recurring series into individual occurrences
    orderBy: 'startTime',
    maxResults: 250,
  });

  await prisma.externalCalendarConnection
    .update({ where: { id: connection.id }, data: { lastSyncedAt: new Date() } })
    .catch(() => {
      /* bookkeeping only — never fail the fetch over it */
    });

  const events = response.data.items ?? [];

  return events
    .filter((e) => e.status !== 'cancelled')
    .map((e) => {
      // All-day events carry `date`; timed events carry `dateTime`.
      const allDayDate = e.start?.date ?? null;
      const startDateTime = e.start?.dateTime ?? null;
      const date = allDayDate ?? (startDateTime ? startDateTime.split('T')[0] : null);
      if (!date) return null;

      return {
        id: e.id ?? `${date}-${e.summary ?? 'untitled'}`,
        date,
        title: e.summary ?? '(no title)',
        startTime: startDateTime,
        endTime: e.end?.dateTime ?? null,
        isAllDay: !!allDayDate,
      };
    })
    .filter((e): e is NormalizedGoogleEvent => e !== null);
}
