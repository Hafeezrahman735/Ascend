import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { createUser, authed } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { CURRENT_TERMS_VERSION } from '../../lib/terms';

/**
 * Terms of Use consent — App Store Guideline 1.2.
 *
 * Two populations have to be covered, and they arrive by different routes:
 * someone registering ticks the box on the signup form and consent is stamped
 * inline, while an account that predates the terms only ever passes through
 * /auth/accept-terms, driven by the client's auth guard. Both are tested here,
 * along with the backward-compatibility case that lets already-installed builds
 * keep registering while the backend runs ahead of App Review.
 */
describe('POST /auth/register — terms consent', () => {
  it('stamps acceptance when the client says the user agreed', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'consenting@example.test',
      username: 'consenting',
      password: 'test-password-123',
      acceptedTerms: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.termsAcceptedAt).not.toBeNull();
    expect(res.body.data.user.termsVersion).toBe(CURRENT_TERMS_VERSION);

    const row = await prisma.user.findUnique({
      where: { id: res.body.data.user.id },
      select: { termsAcceptedAt: true, termsVersion: true },
    });
    expect(row?.termsAcceptedAt).toBeInstanceOf(Date);
    expect(row?.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it('still registers a client that sends no consent field at all', async () => {
    // The backward-compatibility case, and the reason acceptedTerms is optional:
    // the backend deploys before the new binary clears App Review, so for a
    // window every client calling this route is an older build that knows
    // nothing about terms. Rejecting them would break signup for real users.
    const res = await request(app).post('/auth/register').send({
      email: 'legacy@example.test',
      username: 'legacyclient',
      password: 'test-password-123',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.termsAcceptedAt).toBeNull();
  });

  it('does not stamp acceptance when the client explicitly says no', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'declined@example.test',
      username: 'declined',
      password: 'test-password-123',
      acceptedTerms: false,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.termsAcceptedAt).toBeNull();
  });

  it('rejects a non-boolean consent value', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'bogus@example.test',
      username: 'bogusconsent',
      password: 'test-password-123',
      acceptedTerms: 'yes',
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /auth/accept-terms', () => {
  it('records acceptance for a signed-in account that had none', async () => {
    const user = await createUser();

    const before = await prisma.user.findUnique({
      where: { id: user.id },
      select: { termsAcceptedAt: true },
    });
    expect(before?.termsAcceptedAt).toBeNull();

    const res = await authed(user).post('/auth/accept-terms').send({});

    expect(res.status).toBe(200);
    expect(res.body.data.termsVersion).toBe(CURRENT_TERMS_VERSION);

    const after = await prisma.user.findUnique({
      where: { id: user.id },
      select: { termsAcceptedAt: true, termsVersion: true },
    });
    expect(after?.termsAcceptedAt).toBeInstanceOf(Date);
    expect(after?.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it('ignores any version the client tries to supply', async () => {
    // The version is a consent record. A client that could choose it could
    // claim the user accepted terms they never saw.
    const user = await createUser();

    const res = await authed(user)
      .post('/auth/accept-terms')
      .send({ termsVersion: 'whatever-i-like' });

    expect(res.status).toBe(200);
    expect(res.body.data.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it('is idempotent — accepting twice is not an error', async () => {
    // The client retries this freely after a network failure, without knowing
    // whether the first call landed.
    const user = await createUser();

    const first = await authed(user).post('/auth/accept-terms').send({});
    const second = await authed(user).post('/auth/accept-terms').send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/auth/accept-terms').send({});
    expect(res.status).toBe(401);
  });

  it('rejects a garbage bearer token', async () => {
    const res = await request(app)
      .post('/auth/accept-terms')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /auth/me — consent fields', () => {
  it('exposes the consent state the auth guard routes on', async () => {
    // The client decides whether to show the terms gate from these two fields.
    // If /auth/me omits them, a returning user is never gated — which is the
    // exact population Guideline 1.2 is about.
    const user = await createUser();

    const before = await authed(user).get('/auth/me');
    expect(before.status).toBe(200);
    expect(before.body.data).toHaveProperty('termsAcceptedAt', null);
    expect(before.body.data).toHaveProperty('termsVersion', null);

    await authed(user).post('/auth/accept-terms').send({});

    const after = await authed(user).get('/auth/me');
    expect(after.body.data.termsAcceptedAt).not.toBeNull();
    expect(after.body.data.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });
});
