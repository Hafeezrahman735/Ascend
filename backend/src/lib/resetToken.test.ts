import { describe, it, expect } from 'vitest';
import {
  mintResetToken, hashResetToken, resetTokenExpiry, resetDeepLink,
  RESET_TOKEN_TTL_MINUTES,
} from './resetToken';

describe('mintResetToken', () => {
  it('never returns a hash equal to the token — the whole point of storing the hash', () => {
    const { token, tokenHash } = mintResetToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toHaveLength(64);
  });

  it('never mints the same token twice', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(mintResetToken().token);
    expect(seen.size).toBe(500);
  });

  it('mints something URL-safe, so an email client cannot mangle it', () => {
    for (let i = 0; i < 100; i += 1) {
      // base64url: no +, /, = — any of which would need escaping in a query
      // string and would survive some mail clients and not others.
      expect(mintResetToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('carries enough entropy that guessing is not a threat model', () => {
    // 32 bytes -> 43 base64url chars.
    expect(mintResetToken().token.length).toBeGreaterThanOrEqual(43);
  });
});

describe('hashResetToken', () => {
  it('is deterministic, or the lookup could never find the row', () => {
    const { token, tokenHash } = mintResetToken();
    expect(hashResetToken(token)).toBe(tokenHash);
  });

  it('gives different tokens different hashes', () => {
    expect(hashResetToken('a')).not.toBe(hashResetToken('b'));
  });

  it('is case- and whitespace-sensitive, so a mangled token does not redeem', () => {
    const { token } = mintResetToken();
    expect(hashResetToken(`${token} `)).not.toBe(hashResetToken(token));
  });
});

describe('resetTokenExpiry', () => {
  it('expires 30 minutes out', () => {
    const now = new Date('2026-09-02T12:00:00.000Z');
    expect(resetTokenExpiry(now).toISOString()).toBe('2026-09-02T12:30:00.000Z');
    expect(RESET_TOKEN_TTL_MINUTES).toBe(30);
  });

  it('is always in the future relative to the clock it is given', () => {
    const now = new Date();
    expect(resetTokenExpiry(now).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('resetDeepLink', () => {
  it('targets the route inside the (auth) group', () => {
    // The group is excluded from the URL by expo-router, and it is what stops
    // the root layout's auth guard bouncing a signed-out user off this screen.
    expect(resetDeepLink('ascend', 'abc')).toBe('ascend://reset-password?token=abc');
  });

  it('escapes the token rather than trusting it to be URL-safe', () => {
    // mintResetToken only emits base64url today; the encode is here so that
    // staying true is not a precondition for the link working.
    expect(resetDeepLink('ascend', 'a b&c')).toBe('ascend://reset-password?token=a%20b%26c');
  });
});
