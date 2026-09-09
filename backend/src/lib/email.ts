import { config } from '../config';

/**
 * Outbound transactional email, over Brevo's HTTPS API.
 *
 * ─── Why not SMTP ───────────────────────────────────────────────────────────
 *
 * This module used to speak plain SMTP through nodemailer, chosen deliberately
 * so the provider was five environment variables and never a code change. That
 * reasoning was sound and the hosting invalidated it: Railway disables outbound
 * SMTP on Free, Trial and Hobby plans to prevent spam, so every connection sat
 * there until nodemailer gave up.
 *
 *   [email] send failed: to=... subject="[Ascend] Post reported — priya_patel"
 *   Error: Connection timeout
 *       at SMTPConnection._formatError (nodemailer/lib/smtp-connection/index.js:814)
 *
 * It presented as a timeout rather than a refusal, which is what made it look
 * like a misconfigured host or port. It was neither. Password resets and every
 * content-report alert were silently going nowhere.
 *
 * HTTPS is not blocked on any plan, and Railway recommends an HTTPS email API
 * even on the plans where SMTP works.
 *
 * ─── Why Brevo specifically ─────────────────────────────────────────────────
 *
 * Brevo verifies a SINGLE SENDER ADDRESS. Resend, Railway's own suggestion,
 * requires a verified domain, and this project has none — the legal pages live
 * on Notion and support is a Gmail address. Without a domain Resend only sends
 * from onboarding@resend.dev, which delivers to the account owner and nobody
 * else: fine for moderation alerts, useless for a password reset addressed to a
 * real user. Brevo sends from an address you own with no DNS at all.
 *
 * UNCONFIGURED IS STILL A SUPPORTED STATE. With no BREVO_API_KEY, sending logs
 * and resolves false instead of throwing — the same contract the SMTP version
 * had, and what the password-reset integration tests rely on. `isEmailConfigured()`
 * lets a caller tell the difference, and index.ts warns loudly at boot.
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** A slow send must not pin a request; every caller is fire-and-forget anyway. */
const SEND_TIMEOUT_MS = 10_000;

let warned = false;

export function isEmailConfigured(): boolean {
  return !!(config.BREVO_API_KEY && config.EMAIL_FROM);
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Brevo wants the sender split into name and address. EMAIL_FROM is written in
 * the usual header form, `Ascend <you@example.com>`, so it is parsed rather than
 * adding a second variable that could disagree with the first.
 */
function parseSender(from: string): { name?: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, '').trim();
    return name ? { name, email: match[2] } : { email: match[2] };
  }
  return { email: from.trim() };
}

/** Recipients are written the same way, so the address has to come back out. */
function parseRecipient(to: string): { email: string } {
  return { email: parseSender(to).email };
}

/**
 * Sends, or logs and moves on when unconfigured or failing.
 *
 * Never throws. Every caller is on a path where the user has already been told
 * something generic and non-committal, and turning a provider hiccup into a 500
 * would both break that promise and, for password reset, leak whether the
 * address existed.
 *
 * The RECIPIENT is logged; the body is not. Bodies carry reset links, and the
 * whole point of hashing the token in the database is defeated by printing the
 * raw one into a log aggregator.
 */
export async function sendEmail(mail: Mail): Promise<boolean> {
  if (!isEmailConfigured()) {
    if (!warned) {
      console.warn(
        '[email] Brevo is not configured — mail is being dropped. Set BREVO_API_KEY and EMAIL_FROM to enable it.',
      );
      warned = true;
    }
    console.warn(`[email] dropped: to=${mail.to} subject="${mail.subject}"`);
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': config.BREVO_API_KEY as string,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseSender(config.EMAIL_FROM as string),
        to: [parseRecipient(mail.to)],
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Brevo answers 4xx with a JSON body naming the cause — an unverified
      // sender, a bad key, the daily cap. Worth printing: these are all
      // operator errors with a specific fix, and the alternative is a silent
      // failure that looks identical to success.
      const detail = await response.text().catch(() => '(no body)');
      console.error(
        `[email] send failed (${response.status}): to=${mail.to} subject="${mail.subject}" ${detail.slice(0, 500)}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'errored';
    console.error(`[email] send ${reason}: to=${mail.to} subject="${mail.subject}"`, err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
