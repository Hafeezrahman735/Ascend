import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export function useAppForeground(onForeground: () => void): void {
  const callbackRef = useRef(onForeground);
  callbackRef.current = onForeground;

  const prevStateRef = useRef<AppStateStatus>(AppState.currentState);

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
