import { create } from 'zustand';

/**
 * Whether the person filling in the signup form has read and accepted the Terms.
 *
 * Shared state rather than local state because the two halves of the decision
 * now live on different screens: the form is on (auth)/login, and the checkbox
 * is at the foot of (auth)/terms, which is the entire point of the change — a
 * checkbox on the form itself could be ticked without opening the document.
 * Router params cannot carry a value backwards, so the screens need somewhere
 * to meet.
 *
 * Deliberately tiny and deliberately transient. It is not a source of truth for
 * anything: the durable record is termsAcceptedAt on the user row, written by
 * /auth/register. This only survives long enough to get the answer from the
 * terms screen back to the submit button, and `reset` is called whenever the
 * form's context changes so a stale yes can never be submitted.
 */
interface TermsConsentState {
  accepted: boolean;
  setAccepted: (value: boolean) => void;
  reset: () => void;
}

export const useTermsConsentStore = create<TermsConsentState>((set) => ({
  accepted: false,
  setAccepted: (value) => set({ accepted: value }),
  reset: () => set({ accepted: false }),
}));
