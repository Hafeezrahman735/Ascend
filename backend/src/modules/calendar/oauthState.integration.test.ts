import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../index';
import { createUser } from '../../test/factories';
import { userIdFromOAuthState } from '../../lib/googleCalendar';
import { prisma } from '../../lib/prisma';

/**
 * The Google OAuth callback used to accept the bare user id as `state` and check
 * only that it named a real account. User ids are not secret — the leaderboards,
 * search, and /social/users/:userId all return them — so anyone holding a
 * victim's id could run the consent flow with their OWN Google account and
 * `state=<victim id>`, and the callback would write the attacker's calendar
 * tokens into the victim's row.
 *
 * The callback cannot be driven end to end here (it exchanges a code with
 * Google), so these pin the two halves that matter: the state is unforgeable,
 * and a request carrying an unsigned one is rejected before any row is written.
 */

describe('Google OAuth state', () => {
  it('rejects a bare user id as state — the actual vulnerability', async () => {
    const victim = await createUser();
    expect(userIdFromOAuthState(victim.id)).toBeNull();
  });

  it('rejects a token signed with the wrong key', async () => {
    const victim = await createUser();
    const forged = jwt.sign(
      { userId: victim.id, purpose: 'google-calendar-connect' },
      'not-the-server-secret',
      { expiresIn: 600 },
    );
    expect(userIdFromOAuthState(forged)).toBeNull();
  });

  it('rejects an access token signed with the RIGHT key but the wrong purpose', async () => {
    // The state is signed with JWT_ACCESS_SECRET, so without the purpose claim
    // any stolen access token would double as a valid state.
    const victim = await createUser();
    const accessTokenShaped = jwt.sign(
      { userId: victim.id, username: victim.username },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: 600 },
    );
    expect(userIdFromOAuthState(accessTokenShaped)).toBeNull();
  });

  it('rejects an expired state', async () => {
    const victim = await createUser();
    const stale = jwt.sign(
      { userId: victim.id, purpose: 'google-calendar-connect' },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: -10 },
    );
    expect(userIdFromOAuthState(stale)).toBeNull();
  });

  it('accepts a state this server signed, and returns the right user', async () => {
    const user = await createUser();
    const valid = jwt.sign(
      { userId: user.id, purpose: 'google-calendar-connect' },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: 600 },
    );
    expect(userIdFromOAuthState(valid)).toBe(user.id);
  });

  it('rejects nothing at all', () => {
    expect(userIdFromOAuthState(undefined)).toBeNull();
    expect(userIdFromOAuthState('')).toBeNull();
  });

  it('writes no connection row when the callback is hit with a forged state', async () => {
    const victim = await createUser();

    const res = await request(app)
      .get('/calendar/google/callback')
      .query({ code: 'anything', state: victim.id });

    // Redirects to the failure deep link rather than erroring.
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('google-failed');

    const rows = await prisma.externalCalendarConnection.findMany({
      where: { userId: victim.id },
    });
    expect(rows).toHaveLength(0);
  });
});
