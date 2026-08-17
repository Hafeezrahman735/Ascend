import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { prisma } from '../../lib/prisma';
import { createUser, authed } from '../../test/factories';

describe('POST /auth/register', () => {
  it('creates a user, hashes the password, and stores a refresh token', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'new@example.test', username: 'newuser', password: 'test-password-123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('new@example.test');
    expect(res.body.data.accessToken).toBeTruthy();

    const stored = await prisma.user.findUnique({ where: { email: 'new@example.test' } });
    expect(stored).not.toBeNull();
    // The plaintext must never reach the column.
    expect(stored!.passwordHash).not.toBe('test-password-123');

    const tokens = await prisma.refreshToken.findMany({ where: { userId: stored!.id } });
    expect(tokens).toHaveLength(1);
  });

  it('normalises email casing and whitespace', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: '  Sam@Example.TEST ', username: 'sam', password: 'test-password-123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('sam@example.test');
  });

  it('rejects a duplicate email', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/auth/register')
      .send({ email: user.email, username: 'different', password: 'test-password-123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Email already registered');
  });

  it('rejects a username that differs only by case', async () => {
    await createUser({ username: 'Taken' });
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'other@example.test', username: 'taken', password: 'test-password-123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Username already taken');
  });

  it('rejects a short password with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'short@example.test', username: 'shortpw', password: 'abc' });

    expect(res.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('logs in with the registered credentials', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('accepts a different email casing than was registered', async () => {
    const user = await createUser({ email: 'casing@example.test' });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'Casing@Example.TEST', password: user.password });

    expect(res.status).toBe(200);
  });

  it('gives the same error for an unknown email and a wrong password', async () => {
    const user = await createUser();

    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'not-the-password' });
    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.test', password: 'test-password-123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Identical wording matters: a different message enumerates valid accounts.
    expect(wrongPassword.body.error).toBe(unknownEmail.body.error);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and invalidates the old one', async () => {
    const user = await createUser();

    const first = await request(app).post('/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.data.refreshToken).not.toBe(user.refreshToken);

    // Replaying the consumed token must fail — this is the whole point of rotation.
    const replay = await request(app).post('/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(replay.status).toBe(401);

    // The freshly issued one still works.
    const second = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: first.body.data.refreshToken });
    expect(second.status).toBe(200);
  });

  it('rejects a malformed refresh token', async () => {
    const res = await request(app).post('/auth/refresh').send({ refreshToken: 'not-a-jwt' });
    expect(res.status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('returns the authenticated user', async () => {
    const user = await createUser();
    const res = await authed(user).get('/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.data.id ?? res.body.data.user?.id).toBe(user.id);
  });

  it('rejects a request with no token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a garbage bearer token', async () => {
    const res = await request(app).get('/auth/me').set('Authorization', 'Bearer nonsense');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('invalidates the refresh token it was given', async () => {
    const user = await createUser();

    const logout = await authed(user).post('/auth/logout').send({ refreshToken: user.refreshToken });
    expect(logout.status).toBe(200);

    const reuse = await request(app).post('/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(reuse.status).toBe(401);
  });
});
