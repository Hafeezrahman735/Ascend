import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const KEY = 'a'.repeat(64);
const ORIGINAL = process.env.TOKEN_ENCRYPTION_KEY;

describe('secretBox with a key set', () => {
  beforeAll(() => { process.env.TOKEN_ENCRYPTION_KEY = KEY; });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL;
  });

  it('round-trips a token', async () => {
    const { seal, open } = await import('./secretBox');
    const token = 'ya29.a0AfB_byC-not-a-real-google-token';
    expect(open(seal(token))).toBe(token);
  });

  it('does not store the plaintext anywhere in the sealed value', async () => {
    const { seal } = await import('./secretBox');
    const sealed = seal('super-secret-refresh-token');
    expect(sealed).not.toContain('super-secret-refresh-token');
    expect(sealed.startsWith('v1:')).toBe(true);
  });

  it('produces a different ciphertext each time, so equal tokens are not linkable', async () => {
    const { seal } = await import('./secretBox');
    expect(seal('same')).not.toBe(seal('same'));
  });

  it('reads a plaintext row untouched, which is what makes this deployable', async () => {
    // The table is full of unencrypted tokens today. They must keep working
    // until each row is rewritten.
    const { open } = await import('./secretBox');
    expect(open('legacy-plaintext-token')).toBe('legacy-plaintext-token');
  });

  it('refuses a tampered ciphertext rather than returning garbage', async () => {
    const { seal, open } = await import('./secretBox');
    const sealed = seal('token');
    const tampered = `${sealed.slice(0, -4)}AAAA`;
    expect(() => open(tampered)).toThrow();
  });

  it('leaves the empty string alone', async () => {
    // refreshToken is stored as '' when Google omits one.
    const { seal, open } = await import('./secretBox');
    expect(seal('')).toBe('');
    expect(open('')).toBe('');
  });
});
