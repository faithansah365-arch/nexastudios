import crypto from 'node:crypto';
import { Router } from 'express';
import { db, toPublicUser } from '../db.ts';
import {
  clearSessionCookie,
  createSessionForUser,
  dummyPasswordVerify,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  rateLimit,
  requireAuth,
  resolveEntitlements,
  SESSION_COOKIE_NAME,
  validatePasswordStrength,
  verifyPassword,
  verifyTotpCode,
  type AuthenticatedRequest,
} from '../security.ts';

export const authRouter = Router();

const authRateLimit = rateLimit('auth', 20, 15 * 60 * 1000);

function isValidEmail(email: string): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 200;
}

authRouter.get('/me', async (req: AuthenticatedRequest, res) => {
  if (!req.authUser) {
    res.json({
      user: null,
      subscription: null,
      plan: null,
      usage: null,
      savedStudiosCount: 0,
    });
    return;
  }
  const savedStudiosCount = await db.countStudiosByUser(req.authUser.id);
  res.json({
    user: req.publicUser,
    subscription: req.subscription,
    plan: req.activePlan,
    usage: req.usage,
    savedStudiosCount,
  });
});

authRouter.post('/register', authRateLimit, async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
    res.status(400).json({ error: 'Please enter your name (2 to 80 characters).' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  const pwError = validatePasswordStrength(password, false);
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.findUserByEmail(normalizedEmail);
  if (existing) {
    // Anti-enumeration: generic error without confirming account details beyond registration failure
    res.status(409).json({ error: 'Unable to register with this email address. Try signing in or resetting your password.' });
    return;
  }

  const now = new Date();
  const verificationToken = generateOpaqueToken(24);
  const verificationExpiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24).toISOString();
  const userId = crypto.randomUUID();

  const newUser = {
    id: userId,
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    emailVerified: false,
    verificationToken,
    verificationExpiresAt,
    resetToken: null,
    resetExpiresAt: null,
    role: 'free' as const,
    status: 'active' as const,
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await db.createUser(newUser);
  const ent = await resolveEntitlements(newUser);
  await createSessionForUser(userId, req, res);

  res.status(201).json({
    user: toPublicUser(newUser),
    subscription: ent.subscription,
    plan: ent.plan,
    usage: ent.usage,
    savedStudiosCount: 0,
    emailDeliveryConfigured: false,
    verificationToken,
    message: 'Account created. Verify your email address to unlock exports.',
  });
});

authRouter.post('/verify-email', authRateLimit, async (req: AuthenticatedRequest, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== 'string' || token.trim().length < 16) {
    res.status(400).json({ error: 'Invalid verification token.' });
    return;
  }

  const user = await db.findUserByVerificationToken(token.trim());
  if (!user || !user.verificationExpiresAt || new Date(user.verificationExpiresAt) <= new Date()) {
    res.status(400).json({ error: 'Verification token is invalid or has expired.' });
    return;
  }

  await db.updateUser(user.id, {
    emailVerified: true,
    verificationToken: null,
    verificationExpiresAt: null,
  });

  const updated = await db.findUserById(user.id);
  res.json({
    verified: true,
    user: updated ? toPublicUser(updated) : null,
  });
});

authRouter.post('/resend-verification', authRateLimit, requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (user.emailVerified) {
    res.json({ alreadyVerified: true });
    return;
  }
  const verificationToken = generateOpaqueToken(24);
  const verificationExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
  await db.updateUser(user.id, { verificationToken, verificationExpiresAt });
  res.json({
    emailDeliveryConfigured: false,
    verificationToken,
    message: 'New verification token issued.',
  });
});

authRouter.post('/login', authRateLimit, async (req, res) => {
  const { email, password, totpCode } = req.body ?? {};
  if (!isValidEmail(email) || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const user = await db.findUserByEmail(email);
  if (!user) {
    dummyPasswordVerify();
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (user.status === 'suspended') {
    res.status(403).json({ error: 'This account has been suspended. Contact support for assistance.' });
    return;
  }

  if (user.mfaEnabled && user.mfaSecret) {
    if (typeof totpCode !== 'string' || !totpCode.trim()) {
      res.status(200).json({ mfaRequired: true });
      return;
    }
    if (!verifyTotpCode(user.mfaSecret, totpCode)) {
      res.status(401).json({ error: 'Invalid authenticator verification code.', mfaRequired: true });
      return;
    }
  }

  await createSessionForUser(user.id, req, res);
  const ent = await resolveEntitlements(user);
  const savedStudiosCount = await db.countStudiosByUser(user.id);

  res.json({
    user: toPublicUser(user),
    subscription: ent.subscription,
    plan: ent.plan,
    usage: ent.usage,
    savedStudiosCount,
  });
});

authRouter.post('/logout', async (req, res) => {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (rawToken && typeof rawToken === 'string') {
    await db.deleteSessionByTokenHash(hashToken(rawToken));
  }
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

authRouter.post('/forgot-password', authRateLimit, async (req, res) => {
  const { email } = req.body ?? {};
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const user = await db.findUserByEmail(email);
  if (user && user.status === 'active') {
    const rawReset = generateOpaqueToken(24);
    const resetExpiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    await db.updateUser(user.id, {
      resetToken: hashToken(rawReset),
      resetExpiresAt,
    });
    // Zero-budget mode: log to server console only (never return reset token in public HTTP response)
    console.log(`[AUTH] Password reset requested for ${user.email}. Reset token (server log only): ${rawReset}`);
  }

  res.json({
    ok: true,
    emailDeliveryConfigured: false,
    message:
      'If an account matches that email, a reset token has been generated. Automated email delivery requires an SMTP integration; contact your administrator if you need manual reset assistance.',
  });
});

authRouter.post('/reset-password', authRateLimit, async (req, res) => {
  const { token, newPassword } = req.body ?? {};
  if (typeof token !== 'string' || token.trim().length < 16) {
    res.status(400).json({ error: 'Invalid or expired reset token.' });
    return;
  }

  const hashed = hashToken(token.trim());
  const user = await db.findUserByResetToken(hashed);
  if (!user || !user.resetExpiresAt || new Date(user.resetExpiresAt) <= new Date()) {
    res.status(400).json({ error: 'Invalid or expired reset token.' });
    return;
  }

  const pwError = validatePasswordStrength(newPassword, user.role === 'admin');
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }

  await db.updateUser(user.id, {
    passwordHash: hashPassword(newPassword),
    resetToken: null,
    resetExpiresAt: null,
  });
  await db.deleteSessionsByUserId(user.id);
  res.json({ ok: true, message: 'Password updated. Please sign in with your new password.' });
});

authRouter.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const user = req.authUser!;
  if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, user.passwordHash)) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }
  const pwError = validatePasswordStrength(newPassword, user.role === 'admin');
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }
  await db.updateUser(user.id, { passwordHash: hashPassword(newPassword) });
  res.json({ ok: true, message: 'Password changed successfully.' });
});

authRouter.patch('/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
    res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
    return;
  }
  await db.updateUser(req.authUser!.id, { name: name.trim() });
  const updated = await db.findUserById(req.authUser!.id);
  res.json({ user: updated ? toPublicUser(updated) : null });
});

authRouter.delete('/account', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { confirmEmail } = req.body ?? {};
  if (typeof confirmEmail !== 'string' || confirmEmail.trim().toLowerCase() !== req.authUser!.email) {
    res.status(400).json({ error: 'Please type your exact account email to confirm permanent deletion.' });
    return;
  }
  await db.deleteUserAndData(req.authUser!.id);
  clearSessionCookie(res, req);
  res.json({ ok: true });
});
