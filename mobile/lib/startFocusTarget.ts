/**
 * What the Focus button at the top of Today says, and where it goes.
 *
 * Every state only ever OPENS the Focus tab; pressing play there is the next,
 * deliberate tap (design DD2). The cases, in the order they are decided:
 *
 *   focus phase running/paused -> session   "Back to focus" / "Resume"
 *   break running/paused       -> break     "On a break · 4:12"
 *   no tasks yet, still loading-> loading   skeleton bar
 *   no tasks, first load failed-> openTimer "Open focus timer" (never the first-run prompt)
 *   no tasks at all            -> addFirstTask "+ Add your first task"
 *   tasks, none open           -> openTimer "Open focus timer"
 *   otherwise                  -> target    "Focus on: <first open task>"
 *
 * A running break reports `status: 'running'`, so the phase decides between
 * session and break. Pure and react-native-free so vitest can reach it; the
 * status type is imported as a type only.
 */
import type { TimerPhase } from './phaseDuration';
import type { TimerStatus } from '../stores/sessionLock';

export type FocusButtonState =
  | { kind: 'loading' }
  | { kind: 'addFirstTask' }
  | { kind: 'openTimer' }
  | { kind: 'target'; taskId: string; title: string }
  | { kind: 'session'; status: 'running' | 'paused'; taskTitle: string | null }
  | { kind: 'break'; status: 'running' | 'paused' };

export interface FocusButtonInput {
  /** Today's open tasks, most urgent first (taskBoard.topTasks). */
  topOpenTasks: readonly { id: string; title: string; isCompleted: boolean }[];
  /** Whether the user has any tasks at all, open or not. */
  hasAnyTasks: boolean;
  hasLoaded: boolean;
  loadFailed: boolean;
  status: TimerStatus;
  phase: TimerPhase;
  /** Title of the task the running session is on, if any. */
  sessionTaskTitle: string | null;
}

export function focusButtonState(input: FocusButtonInput): FocusButtonState {
  const { status, phase } = input;
  if (status === 'running' || status === 'paused') {
    return phase === 'focus'
      ? { kind: 'session', status, taskTitle: input.sessionTaskTitle }
      : { kind: 'break', status };
  }

  if (!input.hasAnyTasks) {
    if (input.hasLoaded) return { kind: 'addFirstTask' };
    return input.loadFailed ? { kind: 'openTimer' } : { kind: 'loading' };
  }

  // A ticked-off row (a recurring task done today included) is not open.
  const target = input.topOpenTasks.find((t) => !t.isCompleted);
  return target ? { kind: 'target', taskId: target.id, title: target.title } : { kind: 'openTimer' };
}
