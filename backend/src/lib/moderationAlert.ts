import { sendEmail } from './email';
import { config } from '../config';

/**
 * Outbound alert when a user reports a post.
 *
 * WHY THIS EXISTS: the Terms of Use commit us, in writing, to acting on every
 * report within 24 hours by removing the content and ejecting its author. Before
 * this, a report wrote a row to post_reports and nothing on earth read it — the
 * commitment had no mechanism behind it, and a breach would have been invisible.
 *
 * This is the INTERIM mechanism. The real one is the admin moderation panel
 * (see TODOS.md), which is what can actually remove a post and ban an account.
 * Until that ships, acting on a report means a manual database edit, and this
 * email is the only thing that tells the operator one is owed.
 *
 * Fire-and-forget by design. A report must be recorded even when mail is broken,
 * so nothing here is awaited and nothing here throws — sendEmail already resolves
 * false rather than rejecting.
 */
export interface ReportAlert {
  postId: string;
  postCaption: string | null;
  authorId: string;
  authorUsername: string;
  reporterId: string;
  reporterUsername: string;
  reason: string | null;
}

/** Keeps a long caption from making the alert unreadable while still showing what was said. */
const CAPTION_EXCERPT_LIMIT = 400;

function excerpt(caption: string | null): string {
  if (!caption) return '(no caption)';
  return caption.length > CAPTION_EXCERPT_LIMIT
    ? `${caption.slice(0, CAPTION_EXCERPT_LIMIT)}… [truncated]`
    : caption;
}

/**
 * Everything interpolated into the HTML body is user-generated: captions and
 * usernames are whatever someone typed. Escaping is less about a hostile mail
 * client than about making sure a caption containing markup arrives readable and
 * cannot forge structure inside the alert itself.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function notifyContentReported(alert: ReportAlert): void {
  const to = config.MODERATION_ALERT_TO ?? config.EMAIL_FROM;
  if (!to) return;

  const reason = alert.reason ?? '(none given)';
  const caption = excerpt(alert.postCaption);

  const text = [
    'A post has been reported on Ascend.',
    '',
    `Post ID:   ${alert.postId}`,
    `Author:    ${alert.authorUsername} (${alert.authorId})`,
    `Reporter:  ${alert.reporterUsername} (${alert.reporterId})`,
    `Reason:    ${reason}`,
    '',
    'Caption:',
    caption,
    '',
    'The Terms of Use commit to acting on this within 24 hours: remove the',
    'content and terminate the author if it violates Section 3.',
  ].join('\n');

  const html = [
    '<p>A post has been reported on Ascend.</p>',
    '<table cellpadding="4">',
    `<tr><td><b>Post ID</b></td><td><code>${esc(alert.postId)}</code></td></tr>`,
    `<tr><td><b>Author</b></td><td>${esc(alert.authorUsername)} (<code>${esc(alert.authorId)}</code>)</td></tr>`,
    `<tr><td><b>Reporter</b></td><td>${esc(alert.reporterUsername)} (<code>${esc(alert.reporterId)}</code>)</td></tr>`,
    `<tr><td><b>Reason</b></td><td>${esc(reason)}</td></tr>`,
    '</table>',
    '<p><b>Caption:</b></p>',
    `<blockquote>${esc(caption)}</blockquote>`,
    '<p>The Terms of Use commit to acting on this within 24 hours: remove the ',
    'content and terminate the author if it violates Section 3.</p>',
  ].join('');

  void sendEmail({
    to,
    subject: `[Ascend] Post reported — ${alert.authorUsername}`,
    text,
    html,
  });
}
