import { useTimerStore } from '../stores/timerStore';

type TickListener = (remainingMs: number) => void;

let intervalId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<TickListener>();

function tick() {
  const state = useTimerStore.getState();
  if (!state.isRunning || !state.startedAt) {
    stop();
    return;
  }
  const elapsed = Date.now() - state.startedAt + state.elapsedAtPause;
  const remaining = Math.max(0, state.totalMs - elapsed);
  state.setRemainingMs(remaining);
  listeners.forEach((cb) => cb(remaining));
  if (remaining <= 0) {
    stop();
    state.completeTimer();
  }
}

function start() {
  if (intervalId) return;
  intervalId = setInterval(tick, 1000);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function subscribeToEngine(cb: TickListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let activated = false;
export function ensureEngineActive() {
  if (activated) return;
  activated = true;

  useTimerStore.subscribe((state) => {
    if (state.isRunning && state.startedAt) start();
    if (!state.isRunning) stop();
  });

  const state = useTimerStore.getState();
  if (state.isRunning && state.startedAt) start();
}
