import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

/**
 * Outbound transactional email.
 *
 * Plain SMTP rather than a provider SDK, deliberately. Every free tier worth
 * using — Brevo at 300/day, SendGrid, Mailgun, even a plain mailbox — speaks
 * SMTP, so the provider is five environment variables and never a code change.
 * Committing to one vendor's SDK would have meant a rewrite to switch, on a
 * decision driven entirely by whose free tier is best this year.
 *
 * It also means no domain is required: providers offering single-sender
 * verification let you send from one address you already own, which is what
 * makes this shippable at zero cost.
 *
 * UNCONFIGURED IS A SUPPORTED STATE. With no SMTP_* variables set, sending
 * logs and resolves instead of throwing. That is not laziness — the alternative
 * is a password-reset route that 500s on a deploy where the variables have not
 * been filled in yet, and a reset flow that fails loudly at the wrong layer is
 * worse than one that is visibly switched off. `isEmailConfigured()` lets the
 * caller tell the difference when it matters.
 */

let cached: Transporter | null = null;
let warned = false;

export function isEmailConfigured(): boolean {
  return !!(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS && config.EMAIL_FROM);
}

function transport(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: Number(config.SMTP_PORT ?? 587),
    // 587 is STARTTLS (secure:false, upgraded after connect); 465 is implicit
    // TLS. Getting this backwards is the single most common SMTP misconfig and
    // it fails with a timeout rather than anything that names the cause.
    secure: Number(config.SMTP_PORT ?? 587) === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  return cached;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends, or logs and moves on when unconfigured.
 *
 * Never throws. Every caller is on a path where the user has already been told
 * something generic and non-committal, and turning an SMTP hiccup into a 500
 * would both break that promise and leak whether the address existed.
 *
 * The RECIPIENT is logged; the body is not. Bodies carry reset links, and the
 * whole point of hashing the token in the database is defeated by printing the
 * raw one into a log aggregator.
 */
export async function sendEmail(mail: Mail): Promise<boolean> {
  const t = transport();
  if (!t) {
    if (!warned) {
      console.warn('[email] SMTP is not configured — mail is being dropped. Set SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM to enable it.');
      warned = true;
    }
    console.warn(`[email] dropped: to=${mail.to} subject="${mail.subject}"`);
    return false;
  }

  try {
    await t.sendMail({ from: config.EMAIL_FROM, ...mail });
    return true;
  } catch (err) {
    // Logged without the body for the reason above.
    console.error(`[email] send failed: to=${mail.to} subject="${mail.subject}"`, err);
    return false;
  }
}
