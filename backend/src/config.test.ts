import { describe, it, expect, beforeAll } from 'vitest';
import type { envSchema as EnvSchema } from './config';

// config.ts validates process.env at import and exits on failure, so give it
// a valid environment before importing the schema it exports.
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test';
process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(48);
let envSchema: typeof EnvSchema;
beforeAll(async () => {
  ({ envSchema } = await import('./config'));
});

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/test',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
};

describe('BCRYPT_COST', () => {
  it('defaults to 12', () => {
    expect(envSchema.parse(base).BCRYPT_COST).toBe(12);
  });

  it('allows a low cost only in the test suite', () => {
    expect(envSchema.parse({ ...base, BCRYPT_COST: '4', NODE_ENV: 'test' }).BCRYPT_COST).toBe(4);
  });

  it('refuses a low cost in production, in development, and with no NODE_ENV', () => {
    for (const NODE_ENV of ['production', 'development', undefined]) {
      expect(envSchema.safeParse({ ...base, BCRYPT_COST: '4', NODE_ENV }).success).toBe(false);
    }
  });

  it('accepts 10 and above anywhere', () => {
    expect(envSchema.parse({ ...base, BCRYPT_COST: '10', NODE_ENV: 'production' }).BCRYPT_COST).toBe(10);
  });

  it('rejects values outside bcrypt’s sane range', () => {
    expect(envSchema.safeParse({ ...base, BCRYPT_COST: '16', NODE_ENV: 'test' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, BCRYPT_COST: 'twelve', NODE_ENV: 'test' }).success).toBe(false);
  });
});
