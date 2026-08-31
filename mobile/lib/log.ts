/**
 * Development-only logging.
 *
 * `console.log` calls compiled into a release build keep running on real
 * devices. That is mostly noise, but some of these lines printed identifiers —
 * the bootstrap log emitted a user's id and username on every launch — and none
 * of it is readable by anyone who could act on it. Gating them means the
 * information stays available while developing and is simply absent in release.
 *
 * `__DEV__` is a React Native global that the bundler replaces with a literal
 * at build time, so in a release bundle this collapses to a no-op function and
 * the arguments are never evaluated for their side effects.
 *
 * Deliberately NOT wrapping `console.warn` or `console.error`. Those report
 * things that went wrong, and a release build is exactly where you want them:
 * they are what a crash report or a user's device log has to work with.
 */

/* eslint-disable no-console -- the one place console.log is allowed to live. */
export const log: (...args: unknown[]) => void = __DEV__
  ? (...args: unknown[]) => console.log(...args)
  : () => {};
/* eslint-enable no-console */
