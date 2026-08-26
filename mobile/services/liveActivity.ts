import { Platform } from 'react-native';

import {
  toActivityProps,
  staleDateFor,
  needsUpdate,
  type TimerActivityProps,
  type TimerSnapshot,
} from '../lib/liveActivityState';
// Type-only, so it erases at runtime and never touches the native module.
import type { LiveActivity, LiveActivityFactory } from 'expo-widgets';

/**
 * The bridge between the timer store and the Lock Screen card.
 *
 * Everything here is best-effort by design. A Live Activity is a nice-to-have
 * mirror of state the app already owns, so no failure in this file may ever
 * surface to the user or interfere with the timer: Live Activities can be
 * disabled in iOS Settings, the system caps how many may exist, and iOS can end
 * one on its own while the app is suspended. Each of those throws, each is
 * caught here, and the worst outcome is that no card appears.
 *
 * Logs are prefixed `[liveActivity]` so they can be found in a device log when
 * a future iOS release changes the rules underneath us.
 */

const SUPPORTED = Platform.OS === 'ios';

/**
 * The widget, loaded on first use rather than at import.
 *
 * `expo-widgets` runs `requireNativeModule('ExpoWidgets')` at the top of its own
 * module graph, which THROWS whenever the installed binary predates the
 * dependency — a dev client built before it was added, or an OTA update pushed
 * to a client that never had it. Importing the widget at module scope therefore
 * did not merely disable this feature, it took the whole app down at launch: the
 * throw escaped `app/_layout.tsx`, so expo-router received no default export for
 * the root route and rendered nothing at all.
 *
 * A missing native module is exactly the kind of failure the rest of this file
 * already absorbs, so it is absorbed here too. `undefined` means not yet tried;
 * `null` means tried and unavailable, so the throw is never paid for twice.
 */
let factory: LiveActivityFactory<TimerActivityProps> | null | undefined;

function widget(): LiveActivityFactory<TimerActivityProps> | null {
  if (factory !== undefined) return factory;

  try {
    // Deliberately a lazy require. Metro still resolves it statically, so the
    // widget layout is bundled and serialised exactly as it was before — only
    // the moment of evaluation moves.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    factory = require('../widgets/AscendTimerActivity')
      .default as LiveActivityFactory<TimerActivityProps>;
  } catch (err) {
    console.warn(
      '[liveActivity] native module unavailable, no card will appear. ' +
        'Expected if the dev client was built before expo-widgets was added:',
      err,
    );
    factory = null;
  }

  // `?? null` only satisfies the compiler: both branches above have assigned.
  return factory ?? null;
}

/** The handle to the card currently on screen, if we believe one exists. */
let current: LiveActivity<TimerActivityProps> | null = null;
/** What we last told iOS to display — the basis for skipping no-op updates. */
let lastProps: TimerActivityProps | null = null;

function forget(): void {
  current = null;
  lastProps = null;
}

/**
 * Serialises every ActivityKit operation.
 *
 * Callers fire and forget from store subscribers, so without this a stop
 * immediately followed by a start could interleave: ending clears the handle
 * before its `end()` resolves, the start sees no handle and requests a second
 * card, and the user is left with two. Chaining keeps the handle bookkeeping
 * honest for the cost of one promise per state change.
 */
let queue: Promise<void> = Promise.resolve();

function enqueue(operation: () => Promise<void>): Promise<void> {
  queue = queue.then(operation, operation);
  return queue;
}

/**
 * Points the Live Activity at the given timer state: starting, updating or
 * ending the card as that state requires. Safe to call as often as the store
 * changes — a running countdown produces no ActivityKit traffic, because iOS is
 * already rendering it from the end date it was given.
 */
export function syncLiveActivity(snap: TimerSnapshot, now = Date.now()): Promise<void> {
  if (!SUPPORTED) return Promise.resolve();
  return enqueue(() => syncNow(snap, now));
}

async function syncNow(snap: TimerSnapshot, now: number): Promise<void> {
  const next = toActivityProps(snap, now);

  if (!next) {
    await endNow();
    return;
  }

  const activity = widget();
  if (!activity) return;

  try {
    if (!current) {
      current = activity.start(next, undefined, staleDateFor(next));
      lastProps = next;
      return;
    }

    if (lastProps && !needsUpdate(lastProps, next)) return;

    await current.update(next, staleDateFor(next));
    lastProps = next;
  } catch (err) {
    // Most likely the handle is stale because iOS ended the activity while the
    // app was suspended. Drop it; the next foreground reconcile re-requests.
    console.warn('[liveActivity] sync failed:', err);
    forget();
  }
}

/**
 * Ends the card, if any.
 *
 * Deliberately not exported. Stop, completion and logout all end the card the
 * same way every other state change works: they move the store to a state with
 * no session, `toActivityProps` returns null for it, and `syncNow` lands here. A
 * public `endLiveActivity()` would be a second way to do that — one that could
 * be called without the store agreeing, which is how the card and the app start
 * disagreeing. Always runs inside the queue, via its callers.
 */
async function endNow(): Promise<void> {
  if (!current) {
    forget();
    return;
  }

  const activity = current;
  forget();

  try {
    await activity.end('immediate');
  } catch (err) {
    console.warn('[liveActivity] end failed:', err);
  }
}

/**
 * Reconciles what iOS is actually showing against what the app believes.
 *
 * The case this exists for: the user force-quits mid-session. Our in-memory
 * handle dies with the process, but the card survives on the Lock Screen, frozen
 * and orphaned. On the next foreground we ask ActivityKit what really exists and
 * either adopt it or end it.
 *
 * In-app state is authoritative in every branch. If they disagree, the card is
 * wrong, never the timer.
 */
export function reconcileLiveActivity(snap: TimerSnapshot, now = Date.now()): Promise<void> {
  if (!SUPPORTED) return Promise.resolve();
  return enqueue(() => reconcileNow(snap, now));
}

// Runs inside the queue, so it calls syncNow/endNow directly — going back
// through the enqueuing wrappers would wait on the operation it is part of.
async function reconcileNow(snap: TimerSnapshot, now: number): Promise<void> {
  const activity = widget();
  if (!activity) return;

  let live: LiveActivity<TimerActivityProps>[] = [];
  try {
    live = activity.getInstances();
  } catch (err) {
    console.warn('[liveActivity] getInstances failed:', err);
    return;
  }

  const shouldExist = toActivityProps(snap, now) != null;

  // Adopt the first survivor so we can drive it again, and end any extras —
  // more than one card for a single timer is always wrong.
  const [survivor, ...extras] = live;
  for (const extra of extras) {
    try {
      await extra.end('immediate');
    } catch (err) {
      console.warn('[liveActivity] ending duplicate failed:', err);
    }
  }

  if (survivor) {
    current = survivor;
    // We cannot read back what it is displaying, so force the next sync to push.
    lastProps = null;
  } else {
    forget();
  }

  // Either refresh the adopted card to match the real session, or clear the
  // orphan left behind by a session that is no longer running.
  if (shouldExist) {
    await syncNow(snap, now);
  } else {
    await endNow();
  }
}
