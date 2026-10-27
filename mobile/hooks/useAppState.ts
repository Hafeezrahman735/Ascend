import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export function useAppForeground(onForeground: () => void): void {
  const callbackRef = useRef(onForeground);
  // Synced in an effect rather than assigned during render. A render React
  // throws away — a concurrent pass it abandons, or StrictMode's double
  // invoke — would otherwise leave this ref pointing at a callback from a pass
  // that never committed. Effects only run after commit, so the ref always
  // matches what is actually on screen. The useRef initializer covers the first
  // render, so there is no window where it holds nothing.
  useEffect(() => {
    callbackRef.current = onForeground;
  }, [onForeground]);

  // Typed as RN types it: `currentState` can be null before the first native
  // report (RN 0.88 says so explicitly). Only `=== 'active'` is ever asked.
  const prevStateRef = useRef<string | null | undefined>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = prevStateRef.current;
      prevStateRef.current = nextState;

      if (nextState === 'active' && prev !== 'active') {
        callbackRef.current();
      }
    });
    return () => sub.remove();
  }, []);
}
