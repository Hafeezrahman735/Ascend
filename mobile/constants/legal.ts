// ─── Legal constants ──────────────────────────────────────────────────────────
// Published values shared by the auth flow and the Settings screen. These used
// to be file-locals in app/settings.tsx; the terms gate needs the same URLs
// before a user is signed in, and a copy-pasted URL is exactly the kind that
// goes stale in one place only.
//
// Both URLs are live and must stay publicly reachable — App Review follows them
// from App Store Connect, so re-check them in a private window after any Notion
// permission change.

/**
 * The address users are told to write to, and the one the Terms name as the
 * route for reports and appeals. A dedicated account rather than a personal one:
 * it is published in the App Store listing and inside the app, and the Terms
 * commit to answering reports sent here within 24 hours.
 *
 * Not the same thing as EMAIL_FROM on the backend, which is the verified sender
 * that outbound mail leaves from, nor MODERATION_ALERT_TO, which is where report
 * alerts land. Those are environment variables; this is what users see.
 */
export const SUPPORT_EMAIL = 'ascendproductivity.app@gmail.com'

export const PRIVACY_POLICY_URL =
  'https://striped-anger-f6d.notion.site/38554567a17b800099fae40ddaf740b9?source=copy_link'

/**
 * Public copy of the text bundled in constants/termsText.ts.
 *
 * The in-app screen is the one a user actually agrees to — it is bundled, so it
 * renders offline and App Review never has to leave the app to read it. This URL
 * exists because App Store Connect requires a licence-agreement link, and because
 * a user who has deleted the app still needs somewhere to read what they agreed
 * to. It is GENERATED from constants/termsText.ts, never hand-edited: two
 * hand-maintained copies is how the published page came to describe features the
 * app does not have.
 */
export const TERMS_OF_SERVICE_URL =
  'https://striped-anger-f6d.notion.site/Ascend-Terms-of-Service-3d554567a17b802aa87bffe0ceea228b'

/**
 * The version of the Terms a user is agreeing to right now.
 *
 * LOADED: any account whose stored termsVersion differs — or is null, which is
 * every account created before the terms existed — is routed to the terms gate
 * before it can reach the app. Bumping this therefore re-prompts the ENTIRE user
 * base on their next launch. Do it when the terms materially change, and not to
 * fix a typo.
 *
 * The server keeps its own copy in backend/src/lib/terms.ts and stamps that one
 * on the user row; this constant is only what the client displays and sends.
 * They are compared, never merged — see POST /auth/accept-terms.
 */
export const CURRENT_TERMS_VERSION = '2026-09-08'
