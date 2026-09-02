import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { createUser, authed } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { mintResetToken, hashResetToken } from '../../lib/resetToken';

/**
 * Password reset, against a real database.
 *
 * Every item in the Phase 3 test gate has a case here. The enumeration ones
 * matter most: they are the difference between a reset endpoint and a tool for
 * finding out who has an account.
 *
 * SMTP is unconfigured in the test environment, so sendEmail logs and resolves.
 * That is deliberate — these exercise the real route rather than a mocked one,
 * and it pins that an unconfigured mailer never changes what the caller sees.
 */

const NEW_PASSWORD = 'a-brand-new-password-9';

/** The raw token only ever exists in the email, so tests mint their own row. */
async function issueToken(userId: string, expiresAt = new Date(Date.now() + 30 * 60_000)) {
  const { token, tokenHash } = mintResetToken();
  await prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  return token;
}

describe('POST /auth/forgot-password — enumeration resistance', () => {
  it('answers identically for a real account and a nonexistent one', async () => {
    const user = await createUser();

    const known = await request(app).post('/auth/forgot-password').send({ email: user.email });
    const unknown = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'nobody-at-all@example.test' });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    expect(known.status).toBe(200);
  });

  it('answers the same for a malformed address', async () => {
    // A "that is not an email" reply is harmless alone, but it makes the
    // response vary with the input, and not varying is the entire design.
    const good = await request(app).post('/auth/forgot-password').send({ email: 'a@b.test' });
    const bad = await request(app).post('/auth/forgot-password').send({ email: 'not-an-email' });
    expect(bad.status).toBe(good.status);
    expect(bad.body).toEqual(good.body);
  });

  it('answers the same when the body has no email at all', async () => {
    const good = await request(app).post('/auth/forgot-password').send({ email: 'a@b.test' });
    const empty = await request(app).post('/auth/forgot-password').send({});
    expect(empty.body).toEqual(good.body);
  });

  it('actually creates a token for a real account', async () => {
    const user = await createUser();
    await request(app).post('/auth/forgot-password').send({ email: user.email });

    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    // Stored hashed: 64 hex characters, nothing resembling a raw token.
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates nothing for an address with no account', async () => {
    await request(app).post('/auth/forgot-password').send({ email: 'ghost@example.test' });
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it('matches the address case-insensitively, as login does', async () => {
    const user = await createUser();
    await request(app)
      .post('/auth/forgot-password')
      .send({ email: user.email.toUpperCase() });
    expect(await prisma.passwordResetToken.count()).toBe(1);
  });
});

describe('POST /auth/reset-password', () => {
  it('sets the new password and lets the user sign in with it', async () => {
    const user = await createUser();
    const token = await issueToken(user.id);

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const login = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('stops the old password working', async () => {
    const user = await createUser();
    const token = await issueToken(user.id);
    await request(app).post('/auth/reset-password').send({ token, password: NEW_PASSWORD });

    const login = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });
    expect(login.status).toBe(401);
  });

  it('refuses the same token a second time', async () => {
    const user = await createUser();
    const token = await issueToken(user.id);

    const first = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'another-password-entirely' });
    expect(replay.status).toBe(400);
  });

  it('refuses an expired token', async () => {
    const user = await createUser();
    const token = await issueToken(user.id, new Date(Date.now() - 60_000));

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired or already been used/i);
  });

  it('gives an unknown token the same answer as an expired one', async () => {
    // Telling them apart tells a caller whether a token ever existed.
    const user = await createUser();
    const expired = await issueToken(user.id, new Date(Date.now() - 60_000));

    const unknown = await request(app)
      .post('/auth/reset-password')
      .send({ token: mintResetToken().token, password: NEW_PASSWORD });
    const stale = await request(app)
      .post('/auth/reset-password')
      .send({ token: expired, password: NEW_PASSWORD });

    expect(unknown.status).toBe(stale.status);
    expect(unknown.body).toEqual(stale.body);
  });

  it('applies the SAME password rule registration does', async () => {
    const user = await createUser();
    const token = await issueToken(user.id);

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'short' });
    expect(res.status).toBe(400);

    // The token survives a rejected attempt, or a typo would burn the link.
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it('revokes every existing session', async () => {
    // The step most reset flows skip, and the one that makes a reset mean
    // something: an account compromised and then recovered must not still be
    // reachable through a refresh token the attacker already holds.
    const user = await createUser();
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBeGreaterThan(0);

    const token = await issueToken(user.id);
    await request(app).post('/auth/reset-password').send({ token, password: NEW_PASSWORD });

    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);

    const refresh = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: user.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('closes the refresh path, which is what bounds the exposure', async () => {
    // Access tokens are stateless, so one already issued stays valid until it
    // expires. This pins that RENEWAL is closed, capping an attacker who holds
    // a live access token at its remaining 15 minutes instead of seven days.
    const user = await createUser();
    const token = await issueToken(user.id);
    await request(app).post('/auth/reset-password').send({ token, password: NEW_PASSWORD });

    const stillWorks = await authed(user).get('/auth/me');
    expect(stillWorks.status).toBe(200);

    const cannotRenew = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: user.refreshToken });
    expect(cannotRenew.status).toBe(401);
  });

  it('burns every outstanding reset token for that user, not just the one used', async () => {
    const user = await createUser();
    const first = await issueToken(user.id);
    await issueToken(user.id);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(2);

    await request(app).post('/auth/reset-password').send({ token: first, password: NEW_PASSWORD });
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('never stores the raw token anywhere', async () => {
    const user = await createUser();
    const token = await issueToken(user.id);
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows[0].tokenHash).toBe(hashResetToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});
