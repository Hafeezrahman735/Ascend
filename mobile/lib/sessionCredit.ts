/**
 * How many seconds of a finished focus block are actually credited.
 *
 * This deliberately mirrors backend/src/lib/sessionCredit.ts, because the server
 * does not clamp what it is sent — POST /timer/complete validates
 * `actualElapsedSeconds` with `.max(MAX_SESSION_SECONDS)`, so a client that
 * reports more gets a 400 and NO session at all, rather than a trimmed one.
 *
 * The pomodoro path never reached that ceiling: it already clamped every block
 * to the planned duration. The stopwatch has no planned duration, so a stopwatch
 * left running overnight reported eight hours, was rejected, and left the device
 * crediting itself time the server had never heard of — no XP, no streak day, no
 * week dot, and a local total that could never agree with the profile again.
 *
 * Clamping here is what keeps the two sides equal. Six hours credited beats
 * eight hours discarded.
 */
export const MAX_SESSION_SECONDS = 6 * 60 * 60;

/**
 * `plannedSeconds` is the length of the block that was loaded, or null when
 * there was no plan — which is the stopwatch, and is why the parameter is
 * required rather than optional. A caller has to say which it is.
 *
 * The result is a whole number because the wire schema is `z.number().int()`.
 */
export function creditableSessionSeconds(
  elapsedSeconds: number,
  plannedSeconds: number | null,
): number {
  const planned = plannedSeconds != null && plannedSeconds > 0
    ? Math.min(elapsedSeconds, plannedSeconds)
    : elapsedSeconds;
  return Math.floor(Math.min(Math.max(0, planned), MAX_SESSION_SECONDS));
}
