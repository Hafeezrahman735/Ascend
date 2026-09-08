// ─── Terms of Use, bundled ────────────────────────────────────────────────────
// Structured rather than one markdown blob so app/(auth)/terms.tsx stays pure
// layout and the type system catches a malformed section at build time.
//
// This text is bundled into the binary deliberately. It is what a user agrees to
// before registering, so it has to render with no network and without sending
// App Review out of the app to a hosted page that could change or 404. The
// public copy at TERMS_OF_USE_URL exists for App Store Connect and must be kept
// in step with this file.
//
// Sections 3, 4 and 5 are the ones App Store Guideline 1.2 requires: an explicit
// zero-tolerance statement, the mechanisms to flag content and block users, and
// the commitment to act within 24 hours by removing content and ejecting the
// offending user. Do not soften them without re-reading 1.2.

import { SUPPORT_EMAIL } from './legal'

export interface TermsSection {
  heading: string
  /** Paragraphs, rendered in order. */
  body: string[]
  /** Optional bulleted list, rendered after the paragraphs. */
  bullets?: string[]
  /** Renders the section's first paragraph with emphasis. For the clauses App Review looks for. */
  emphasise?: boolean
}

export const TERMS_EFFECTIVE_DATE = '8 September 2026'

export const TERMS_INTRO =
  'By creating an account or signing in to Ascend, you agree to these Terms. If you do not agree, do not use Ascend.'

export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: '1. Who can use Ascend',
    body: [
      'You must be at least 13 years old to use Ascend.',
      'You are responsible for everything that happens under your account, including keeping your password secure.',
    ],
  },
  {
    heading: '2. Your content',
    body: [
      'Ascend lets you post to a shared feed, join groups, and appear on leaderboards. You keep ownership of what you post.',
      'You grant us only the permission needed to store your content and show it to the people you chose to share it with. You are responsible for what you post.',
    ],
  },
  {
    heading: '3. Zero tolerance for objectionable content and abusive users',
    emphasise: true,
    body: [
      'There is no tolerance for objectionable content or abusive behaviour on Ascend.',
      'You may not post, share, or send content that is:',
    ],
    bullets: [
      'harassing, bullying, threatening, or intimidating',
      'hateful, or that attacks or demeans a person or group on the basis of race, ethnicity, national origin, religion, disability, age, sex, gender identity, or sexual orientation',
      'sexually explicit, or sexual content involving minors',
      'violent or gory, or that promotes or glorifies self-harm, suicide, or eating disorders',
      'illegal, or that promotes illegal activity',
      'impersonating another person or organisation',
      'spam, a scam, or otherwise deceptive',
      "infringing on someone else's copyright, trademark, or privacy",
    ],
  },
  {
    heading: '4. Reporting content and blocking users',
    body: [
      'Every post in the Ascend feed has a flag icon you can tap to report it. Every user profile has a Block button, which hides that person\u2019s posts from you and hides yours from them.',
      `You can also email us directly at ${SUPPORT_EMAIL}.`,
    ],
  },
  {
    heading: '5. Our commitment: action within 24 hours',
    emphasise: true,
    body: [
      'We act on every report of objectionable content within 24 hours.',
      'When we receive a report we review it, and where the content or behaviour violates these Terms we will remove the offending content and eject the user who posted it by terminating their account.',
      'We may remove content and terminate accounts at our sole discretion, without prior notice, for any violation of Section 3. Ejected users may not create a new account.',
    ],
  },
  {
    heading: '6. Your account',
    body: [
      'You can delete your account at any time from Settings, which permanently removes your data.',
      'We may suspend or terminate your account if you violate these Terms.',
    ],
  },
  {
    heading: '7. No warranty; limitation of liability',
    body: [
      'Ascend is provided "as is", without warranty of any kind.',
      'To the maximum extent permitted by law, we are not liable for any indirect, incidental, or consequential damages arising from your use of Ascend.',
    ],
  },
  {
    heading: '8. Changes to these Terms',
    body: [
      'We may update these Terms. If we do, we will ask you to accept the updated Terms the next time you open Ascend.',
      'Continuing to use Ascend after accepting means you agree to the new Terms.',
    ],
  },
  {
    heading: '9. Contact',
    body: [`Questions, reports, or appeals: ${SUPPORT_EMAIL}`],
  },
]
