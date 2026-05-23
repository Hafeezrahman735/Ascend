import { useState, useCallback } from 'react';

interface UIModalState {
  timerEdit: boolean;
  taskSelect: boolean;
  reward: boolean;
}

const defaultModalState: UIModalState = {
  timerEdit: false,
  taskSelect: false,
  reward: false,
};

export function useModalState() {
  const [modals, setModals] = useState<UIModalState>(defaultModalState);

  const openModal = useCallback((key: keyof UIModalState) => {
    setModals((prev) => ({ ...prev, [key]: true }));
  }, []);

  const closeModal = useCallback((key: keyof UIModalState) => {
    setModals((prev) => ({ ...prev, [key]: false }));
  }, []);

  const closeAllModals = useCallback(() => {
    setModals(defaultModalState);
  }, []);

  return { modals, openModal, closeModal, closeAllModals };
}
