import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  authenticate,
} from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { handleAuthError, handleZodError } from '../../lib/errors';
import { logAuthFailure } from '../../lib/authLog';
import { sendEmail } from '../../lib/email';
import {
  mintResetToken, hashResetToken, resetTokenExpiry, resetDeepLink,
  RESET_TOKEN_TTL_MINUTES,
} from '../../lib/resetToken';
import { config } from '../../config';
import { CURRENT_TERMS_VERSION } from '../../lib/terms';
export const authRouter = Router();

// Email is stored and matched lowercase. Without this, signing up as
// "Sam@Gmail.com" and later typing "sam@gmail.com" fails to log in (Postgres
// compares case-sensitively), and the unique constraint would allow both as
// separate accounts. Mobile keyboards autocapitalise, so this is routine.
// Trimming catches trailing whitespace from paste/autofill.
const normalizeEmail = (v: string) => v.trim().toLowerCase();

const registerSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  username: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(100),
  // OPTIONAL on purpose. Builds released before the terms existed post without
  // this field, and they must keep registering successfully — the backend
  // deploys before the new binary clears App Review, so for a window the only
  // clients calling this route are old ones. Accounts created without consent
  // are caught by the terms gate on their next launch instead.
  //
  // Note it carries no version: the client says only THAT the user accepted,
  // and the server stamps WHICH version from its own constant. A version string
  // supplied by the client would be a consent record the client controls.
  acceptedTerms: z.boolean().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

authRouter.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, username, password, acceptedTerms } = registerSchema.parse(req.body);

    // Username is matched case-insensitively so "Admin" and "admin" can't coexist
    // as separate accounts — in a social feed that reads as impersonation. The
    // original casing is still stored and displayed.
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username: { equals: username, mode: 'insensitive' } }],
      },
    });
    if (existingUser) {
      res.status(409).json({
        success: false,
        error: existingUser.email === email ? 'Email already registered' : 'Username already taken',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        // Stamped here rather than leaving every new account to the terms gate:
        // the signup form already blocked submission until the box was ticked,
        // so re-prompting immediately after would be asking twice for the same
        // consent — and would race the isNewUser redirect to onboarding.
        ...(acceptedTerms
          ? { termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION }
          : {}),
      },
    });

    const accessToken = signAccessToken({ userId: user.id, username: user.username });
    const refreshToken = signRefreshToken({ userId: user.id, username: user.username });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          privacySetting: user.privacySetting,
          createdAt: user.createdAt,
          // The client's auth guard reads these to decide whether to route to
          // the terms gate. Omitting them here would leave a just-logged-in user
          // ungated until the next /auth/me.
          termsAcceptedAt: user.termsAcceptedAt,
          termsVersion: user.termsVersion,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors[0].message });
      return;
    }
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Logged separately from a bad password so credential stuffing (many
      // unknown addresses) is distinguishable from a targeted guess against one
      // real account. The RESPONSE stays identical either way — the distinction
      // belongs in the log, never on the wire, or it becomes an enumeration
      // oracle.
      logAuthFailure(req, 'no_such_email', { email });
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      logAuthFailure(req, 'bad_password', { email, userId: user.id });
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const accessToken = signAccessToken({ userId: user.id, username: user.username });
    const refreshToken = signRefreshToken({ userId: user.id, username: user.username });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt,
      },
    });

    // Prune this user's expired tokens on the way through — see /auth/refresh.
    prisma.refreshToken
      .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
      .catch((err) => console.error('Refresh token cleanup failed:', err));

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          privacySetting: user.privacySetting,
          createdAt: user.createdAt,
          // The client's auth guard reads these to decide whether to route to
          // the terms gate. Omitting them here would leave a just-logged-in user
          // ungated until the next /auth/me.
          termsAcceptedAt: user.termsAcceptedAt,
          termsVersion: user.termsVersion,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors[0].message });
      return;
    }
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.post('/auth/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      logAuthFailure(req, 'refresh_invalid');
      res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
      return;
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });
    if (!storedToken) {
      // A signature-valid token that is not in the table has already been spent.
      // That is either a benign race or a replay of a stolen token, and it is
      // the single most interesting line in this file.
      logAuthFailure(req, 'refresh_unknown', { userId: payload.userId });
      res.status(401).json({ success: false, error: 'Refresh token not found' });
      return;
    }

    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      logAuthFailure(req, 'refresh_user_missing', { userId: payload.userId });
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    const newAccessToken = signAccessToken({ userId: user.id, username: user.username });
    const newRefreshToken = signRefreshToken({ userId: user.id, username: user.username });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: newRefreshToken,
        expiresAt,
      },
    });

    // Opportunistic cleanup. A row was written on every login and every refresh
    // and only ever deleted on explicit logout, so expired tokens accumulated
    // forever. Pruning this user's expired rows here keeps the table bounded
    // without needing a scheduled job. Best-effort: never fail a refresh over it.
    prisma.refreshToken
      .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
      .catch((err) => console.error('Refresh token cleanup failed:', err));

    res.json({
      success: true,
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors[0].message });
      return;
    }
    console.error('Refresh error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    await prisma.refreshToken.deleteMany({ where: { userId } });
    res.json({ success: true, data: { message: 'Logged out successfully' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Logout error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

  // Proactively resets the overall day-streak the moment a day is missed, instead
  // of the lazy "recompute on next session" path in lib/streak.ts. Called on app
  // boot / foreground alongside recurring-task spawning. The streak survives only
  // if the user was active today or yesterday; any older last-active means at least
  // one full day was missed, so it resets to 0 immediately. Never increments here.
  authRouter.post('/auth/me/streak-check', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const schema = z.object({ localDate: z.string().optional() });
      const { localDate } = schema.parse(req.body ?? {});
      const today = localDate ?? new Date().toISOString().split('T')[0];

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { currentStreak: true, lastActiveDate: true },
      });
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      let currentStreak = user.currentStreak;

      if (user.lastActiveDate && currentStreak !== 0) {
        // lastActiveDate is stored as midnight UTC of the user's local date, so UTC
        // getters return the correct calendar day (matches lib/streak.ts semantics).
        const la = user.lastActiveDate;
        const lastActive = `${la.getUTCFullYear()}-${String(la.getUTCMonth() + 1).padStart(2, '0')}-${String(la.getUTCDate()).padStart(2, '0')}`;

        const y = new Date(`${today}T00:00:00.000Z`);
        y.setUTCDate(y.getUTCDate() - 1);
        const yesterday = `${y.getUTCFullYear()}-${String(y.getUTCMonth() + 1).padStart(2, '0')}-${String(y.getUTCDate()).padStart(2, '0')}`;

        if (lastActive !== today && lastActive !== yesterday) {
          await prisma.user.update({ where: { id: userId }, data: { currentStreak: 0 } });
          currentStreak = 0;
        }
      }

      res.json({ success: true, data: { currentStreak } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: error.errors[0].message });
        return;
      }
      if (handleAuthError(res, error)) return;
      console.error('Streak check error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  authRouter.get('/auth/me', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      res.json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          avatarEmoji: user.avatarEmoji,
          privacySetting: user.privacySetting,
          createdAt: user.createdAt,
          xp: user.xp,
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
          totalSessions: user.totalSessions,
          totalFocusTime: user.totalFocusTime,
          publicProfile: user.publicProfile,
          showOnLeaderboard: user.showOnLeaderboard,
          shareFocusStats: user.shareFocusStats,
          termsAcceptedAt: user.termsAcceptedAt,
          termsVersion: user.termsVersion,
        },
      });
    } catch (error) {
      if (handleAuthError(res, error)) return;
      console.error('Get me error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

/**
 * Record that the signed-in user accepted the current Terms of Use.
 *
 * This is the LOGIN half of App Store Guideline 1.2's "before registering or
 * logging in". Registration records consent inline (see /auth/register), but
 * every account that existed before the terms did has termsAcceptedAt null, and
 * a returning user never calls /auth/register again — they bootstrap straight
 * through /auth/me. The client's auth guard routes those accounts here.
 *
 * Idempotent: accepting twice simply restamps. The client may retry freely
 * after a network failure without needing to know whether the first call landed.
 */
authRouter.post('/auth/accept-terms', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    // The version is NOT taken from the request. The client says only that the
    // user accepted; which text that was is whatever this server is serving.
    const user = await prisma.user.update({
      where: { id: userId },
      data: { termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION },
      select: { termsAcceptedAt: true, termsVersion: true },
    });

    res.json({ success: true, data: user });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Accept terms error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.delete('/auth/account', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    await prisma.$transaction(async (tx) => {
      // Hand off any groups this user created before removing them. A study
      // group is shared content — the other members shouldn't lose it because
      // the creator left. The longest-standing remaining member inherits it.
      // Groups with no one else left fall through to the schema's onDelete
      // cascade, which is also the backstop that stops account deletion from
      // ever failing on a foreign key again.
      const createdGroups = await tx.studyGroup.findMany({
        where: { createdBy: userId },
        select: { id: true },
      });

      for (const group of createdGroups) {
        const successor = await tx.studyGroupMember.findFirst({
          where: { groupId: group.id, userId: { not: userId } },
          orderBy: { joinedAt: 'asc' },
          select: { userId: true },
        });
        if (successor) {
          await tx.studyGroup.update({
            where: { id: group.id },
            data: { createdBy: successor.userId },
          });
        }
      }

      // These two tables intentionally carry no foreign keys, so nothing removes
      // their rows automatically. Clean them up explicitly rather than leaving
      // orphaned records pointing at a deleted account.
      await tx.userBlock.deleteMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      });
      await tx.postReport.deleteMany({ where: { reportedBy: userId } });

      // Everything else cascades from the User relations in schema.prisma.
      await tx.user.delete({ where: { id: userId } });
    });

    res.json({ success: true, data: { message: 'Account deleted' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.patch('/auth/me/profile', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({
      avatarEmoji: z.string().min(1).max(16),
    });
    const { avatarEmoji } = schema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarEmoji },
    });

    res.json({ success: true, data: { avatarEmoji: user.avatarEmoji } });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Profile update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.patch('/auth/me/privacy', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({
      privacySetting: z.enum(['public', 'friends_only', 'private']).optional(),
      publicProfile: z.boolean().optional(),
      showOnLeaderboard: z.boolean().optional(),
      shareFocusStats: z.boolean().optional(),
    });
    const data = schema.parse(req.body);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, error: 'No privacy fields provided' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
    });

    res.json({
      success: true,
      data: {
        privacySetting: user.privacySetting,
        publicProfile: user.publicProfile,
        showOnLeaderboard: user.showOnLeaderboard,
        shareFocusStats: user.shareFocusStats,
      },
    });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Privacy update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Password reset ──────────────────────────────────────────────────────────

const forgotSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
});

const resetSchema = z.object({
  token: z.string().min(1).max(200),
  // The SAME rule registration uses, referenced rather than restated. Two
  // copies of a password policy is how a reset flow ends up accepting a
  // password that signup would have refused.
  password: registerSchema.shape.password,
});

/**
 * Start a reset.
 *
 * Answers identically whether or not the address has an account. That is the
 * whole point: a different message, a different status code, or a measurably
 * different response time all turn this into an oracle for "does this person
 * use Ascend", which is worth something to a spammer and more to someone
 * targeting one individual.
 *
 * It follows that nothing below may return early with a distinguishable result,
 * including on send failure — the caller is told the same thing regardless, and
 * the real outcome goes to the log.
 */
authRouter.post('/auth/forgot-password', async (req: Request, res: Response) => {
  // Identical for every caller. Built once so no branch can drift from it.
  const genericResponse = {
    success: true,
    data: { message: "If an account exists for this email, we've sent a reset link." },
  };

  try {
    const { email } = forgotSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (!user) {
      // Logged, not answered differently. This is the enumeration probe worth
      // knowing about, and the log is where that belongs.
      logAuthFailure(req, 'reset_unknown_email', { email });
      res.json(genericResponse);
      return;
    }

    const { token, tokenHash } = mintResetToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: resetTokenExpiry() },
    });

    // Expired rows for this user, swept opportunistically — same approach the
    // refresh-token routes take rather than adding a scheduled job.
    prisma.passwordResetToken
      .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
      .catch((err) => console.error('Reset token cleanup failed:', err));

    const link = resetDeepLink(config.APP_DEEP_LINK_SCHEME, token);
    // NOT awaited, and that is a security property rather than a performance
    // one. Awaiting makes the "account exists" path wait for an SMTP round trip
    // while the "no account" path returns immediately, so the two answers
    // become distinguishable by RESPONSE TIME even though their bodies are
    // byte-identical. A timing oracle enumerates just as well as a worded one.
    //
    // Safe to leave unhandled: sendEmail catches internally and resolves false
    // rather than rejecting, so this can never become an unhandled rejection.
    //
    // `link` holds the RAW token and is never logged, here or in lib/email.ts.
    void sendEmail({
      to: email,
      subject: 'Reset your Ascend password',
      text: `Open this link to set a new password:\n\n${link}\n\nIt expires in ${RESET_TOKEN_TTL_MINUTES} minutes and can only be used once. If you didn't ask for this, you can ignore this email — your password has not changed.`,
      html: `<p>Open this link to set a new password:</p><p><a href="${link}">Reset my password</a></p><p>It expires in ${RESET_TOKEN_TTL_MINUTES} minutes and can only be used once.</p><p>If you didn't ask for this, you can ignore this email — your password has not changed.</p>`,
    });

    res.json(genericResponse);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Even a malformed address gets the generic answer. Replying "that isn't
      // an email" is harmless on its own, but it makes the endpoint's responses
      // vary with the input, and the whole design here is that they do not.
      res.json(genericResponse);
      return;
    }
    console.error('Forgot password error:', error);
    res.json(genericResponse);
  }
});

/**
 * Redeem a reset.
 *
 * Single-use, expiry-checked, and it revokes every existing session: an account
 * that was compromised and then recovered must not still be reachable through a
 * refresh token the attacker already holds. That is the step most reset flows
 * omit, and it is the one that makes the reset actually mean something.
 */
authRouter.post('/auth/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = resetSchema.parse(req.body);

    // Looked up BY HASH — the raw token is never stored, so this is the only
    // way to find the row, which is the property we wanted.
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(token) },
      select: { id: true, userId: true, expiresAt: true },
    });

    // One message for "no such token" and "expired". A caller who can tell them
    // apart learns whether a token ever existed.
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      if (record) {
        // Distinguished in the LOG only, and by id — never by the token itself.
        logAuthFailure(req, 'reset_token_expired', { userId: record.userId });
        await prisma.passwordResetToken.delete({ where: { id: record.id } }).catch(() => {});
      } else {
        logAuthFailure(req, 'reset_token_invalid');
      }
      res.status(400).json({
        success: false,
        error: 'This reset link has expired or already been used. Request a new one.',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // One transaction: the new password, the death of every reset token for
    // this user, and the death of every session. Split across three statements,
    // a failure between them could leave the password changed with the old
    // sessions still live — which is the exact state this is meant to end.
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
      prisma.refreshToken.deleteMany({ where: { userId: record.userId } }),
    ]);

    res.json({
      success: true,
      data: { message: 'Your password has been reset. Sign in with your new password.' },
    });
  } catch (error) {
    if (handleZodError(res, error)) return;
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
