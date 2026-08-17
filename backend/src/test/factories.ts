import request from 'supertest';
import app from '../index';

export interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

// Tables are truncated between tests, but a counter keeps usernames unique
// within a single test that creates several users.
let seq = 0;

/**
 * Registers a user through the real /auth/register route rather than inserting
 * a row directly, so every test starts from state the application itself
 * produced — correct password hashing, refresh-token row, default settings.
 */
export async function createUser(overrides: Partial<Pick<TestUser, 'email' | 'username' | 'password'>> = {}): Promise<TestUser> {
  seq += 1;
  const email = overrides.email ?? `user${seq}@example.test`;
  const username = overrides.username ?? `user${seq}`;
  const password = overrides.password ?? 'test-password-123';

  const res = await request(app).post('/auth/register').send({ email, username, password });

  if (res.status !== 201) {
    throw new Error(`createUser failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return {
    id: res.body.data.user.id,
    email: res.body.data.user.email,
    username: res.body.data.user.username,
    password,
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
  };
}

/** `authed(user).get('/tasks')` — supertest with the bearer token attached. */
export function authed(user: TestUser) {
  const agent = request(app);
  const withAuth = <T extends { set: (k: string, v: string) => T }>(req: T): T =>
    req.set('Authorization', `Bearer ${user.accessToken}`);

  return {
    get: (url: string) => withAuth(agent.get(url)),
    post: (url: string) => withAuth(agent.post(url)),
    put: (url: string) => withAuth(agent.put(url)),
    patch: (url: string) => withAuth(agent.patch(url)),
    delete: (url: string) => withAuth(agent.delete(url)),
  };
}
