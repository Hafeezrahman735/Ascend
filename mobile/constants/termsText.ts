import { SUPPORT_EMAIL, PRIVACY_POLICY_URL } from './legal'

// ─── Terms of Service, bundled ────────────────────────────────────────────────
// The CANONICAL source. The page published at TERMS_OF_SERVICE_URL is generated from
// this file rather than written separately — two hand-maintained copies of a
// legal document diverge, and the last time they did, the hosted copy described
// a Report button on user profiles that does not exist.
//
// Structured rather than one markdown blob so app/(auth)/terms.tsx stays pure
// layout and the type system catches a malformed section at build time.
//
// Bundled into the binary deliberately: this is what a user agrees to before
// registering, so it must render with no network and without sending App Review
// out of the app to a hosted page that could change or 404.
//
// Section 5 is what App Store Guideline 1.2 requires — an explicit
// zero-tolerance statement, the mechanisms to flag content and block users, and
// the commitment to act within 24 hours by removing content and ejecting the
// offending user. Do not soften it without re-reading 1.2.
//
// EVERY factual claim here is a claim about how the app behaves, and App Review
// reads this alongside the app. Before adding one, verify it in code.

export interface TermsSection {
  heading: string
  /** Paragraphs, rendered in order. */
  body: string[]
  /** Optional bulleted list, rendered after `body`. */
  bullets?: string[]
  /** Paragraphs rendered after `bullets`. */
  tail?: string[]
  /** Renders the section's first paragraph with emphasis. For the clauses App Review looks for. */
  emphasise?: boolean
}

export const TERMS_EFFECTIVE_DATE = '8 September 2026'

export const TERMS_INTRO =
  'These Terms of Service ("Terms") govern your use of the Ascend mobile application ("Ascend" or the "App"). By downloading, installing, or using Ascend, you agree to these Terms. If you do not agree, please do not use the App.'

export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: '1. Eligibility',
    body: [
      'You must meet the minimum age required by the Apple App Store or Google Play in your country, and by applicable local law, to use Ascend.',
      'Personal information is not knowingly collected from children under 13. If it is later discovered that such information has been collected, it will be deleted promptly.',
    ],
  },
  {
    heading: '2. License to Use the App',
    body: [
      'You are granted a limited, non-exclusive, non-transferable, revocable license to use Ascend on devices you own or control, for personal, non-commercial purposes.',
      'You may not resell, redistribute, reverse engineer, or extract the App’s source code except where permitted by law.',
    ],
  },
  {
    heading: '3. Your Account',
    body: [
      'You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account.',
      `If you believe your account has been accessed without authorization, contact ${SUPPORT_EMAIL} immediately.`,
    ],
  },
  {
    heading: '4. User Content',
    body: [
      'Ascend allows you to post content, including session activity, progress updates, and group information ("User Content"). You retain ownership of your User Content.',
      'By posting it, you grant Ascend a non-exclusive license to display and distribute that content within the App as necessary to operate its features — for example, showing your posts to users who follow you.',
      'You are solely responsible for your User Content and for confirming you have the right to post it.',
    ],
  },
  {
    heading: '5. Zero Tolerance for Objectionable Content and Abusive Conduct',
    emphasise: true,
    body: [
      'Ascend maintains zero tolerance for objectionable content or abusive users. This is a binding condition of use, not a general guideline.',
      'Prohibited content and conduct includes, without limitation:',
    ],
    bullets: [
      'harassment, threats, or bullying directed at other users',
      'hate speech, or content demeaning individuals based on a protected characteristic',
      'sexually explicit content',
      'content promoting self-harm, violence, or illegal activity',
      'impersonation of another person',
      'spam, scams, or deceptive content',
      'any content that infringes another party’s rights',
    ],
    tail: [
      `Reporting. Every post in the Ascend feed carries a flag icon that reports it. You are encouraged to report any content that violates these Terms, and you may also write to ${SUPPORT_EMAIL} directly.`,
      'Blocking. You may block any other user at any time from their profile. Blocking hides that user’s posts from your feed and hides yours from theirs, and removes them from your search results.',
      'Enforcement commitment. Reports of objectionable content or abusive conduct are reviewed promptly. Where a report is substantiated, the offending content will be removed and the responsible user will be ejected — suspended or permanently banned, as appropriate — within 24 hours of the report being received.',
      'Action may also be taken independently of a report where warranted, and the severity of the response may vary based on the nature and history of the conduct. You will be informed of the outcome of your report where reasonably practicable, though a detailed explanation of every moderation decision is not guaranteed.',
    ],
  },
  {
    heading: '6. Additional Prohibited Uses',
    body: ['You agree not to:'],
    bullets: [
      'use the App for any unlawful purpose',
      'attempt to gain unauthorized access to other accounts or backend systems',
      'use automated tools, such as bots or scrapers, to access the App',
      'interfere with the App’s normal operation',
      'otherwise violate the rights of any third party',
    ],
  },
  {
    heading: '7. Intellectual Property',
    body: [
      'The Ascend name, logo, and application design, excluding User Content, are the property of Ascend and are protected under applicable intellectual property law.',
      'Use of Ascend’s branding without prior written permission is not permitted.',
    ],
  },
  {
    heading: '8. Disclaimer of Warranties',
    body: [
      'Ascend is provided "as is" and "as available", without warranties of any kind, whether express or implied, including implied warranties of merchantability, fitness for a particular purpose, or non-infringement.',
      'Uninterrupted, error-free operation is not guaranteed, and no assurance is made against potential data loss.',
    ],
  },
  {
    heading: '9. Limitation of Liability',
    body: [
      'To the maximum extent permitted by applicable law, Ascend shall not be liable for indirect, incidental, special, or consequential damages, including loss of data, arising from use of, or inability to use, the App.',
      'Where liability is nonetheless established, total liability shall not exceed the greater of the amount you paid to use the App in the preceding 12 months, or 50 USD.',
      'Some jurisdictions do not permit the exclusion or limitation of certain damages, so portions of this section may not apply depending on your location.',
    ],
  },
  {
    heading: '10. Indemnification',
    body: [
      'You agree to indemnify and hold harmless Ascend from claims, damages, or reasonable expenses arising from your User Content, your violation of these Terms, or your violation of a third party’s rights.',
    ],
  },
  {
    heading: '11. Termination',
    body: [
      'You may delete your account at any time from Settings. Deleting your account permanently removes your data.',
      'Access to the App may be suspended or terminated at Ascend’s discretion, particularly for violations of Sections 5 or 6, and without prior notice where the conduct warrants immediate action.',
    ],
  },
  {
    heading: '12. Changes to These Terms',
    body: [
      'These Terms may be updated periodically. When they change materially, Ascend will ask you to accept the updated Terms the next time you open the App.',
      'Continued use of the App following such changes constitutes acceptance of the revised Terms.',
    ],
  },
  {
    heading: '13. Governing Law',
    body: [
      'These Terms are governed by the laws of the United States of America, without regard to conflict-of-law principles.',
      'Where mandatory consumer-protection law in your country of residence provides you greater protection, that law applies.',
    ],
  },
  {
    heading: '14. Apple App Store Terms',
    body: [
      'If Ascend was downloaded from the Apple App Store, these Terms are between you and Ascend, not Apple. Apple has no obligation to furnish maintenance or support for the App.',
      'In the event Ascend fails to conform to an applicable warranty, you may notify Apple, and Apple will refund the purchase price, if any; to the maximum extent permitted by law, Apple has no further warranty obligation.',
      'Apple is not responsible for addressing any other claims relating to the App, including product liability or legal compliance claims, and is not responsible for investigating claims that the App infringes a third party’s intellectual property rights.',
      'Apple and its subsidiaries are third-party beneficiaries of these Terms and may enforce them against you accordingly.',
    ],
  },
  {
    heading: '15. Google Play Terms',
    body: [
      'If Ascend was downloaded from Google Play, use of the App is also subject to Google Play’s Terms of Service and applicable policies, including those governing user-generated content and user conduct, in addition to these Terms. Where these Terms and Google’s policies overlap, both apply.',
      'Reports of objectionable content or abusive users originating from Google Play users are handled under the same enforcement commitment described in Section 5, within 24 hours.',
    ],
  },
  {
    heading: '16. Contact',
    body: [
      `Questions regarding these Terms, or reports of objectionable content or abusive conduct, may be directed to: ${SUPPORT_EMAIL}`,
    ],
  },
  {
    heading: '17. Severability and Entire Agreement',
    body: [
      'If any provision of these Terms is found unenforceable, the remaining provisions remain in full effect.',
      `These Terms, together with the Privacy Policy (${PRIVACY_POLICY_URL}), constitute the entire agreement governing use of Ascend.`,
    ],
  },
]
