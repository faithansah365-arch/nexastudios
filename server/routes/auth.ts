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
  signEphemeralPayload,
  validatePasswordStrength,
  verifyEphemeralPayload,
  verifyPassword,
  verifyTotpCode,
  type AuthenticatedRequest,
} from '../security.ts';

export const authRouter = Router();

const authRateLimit = rateLimit('auth', 20, 15 * 60 * 1000);

function isValidEmail(email: string): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 200;
}

function getGoogleOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function resolveGoogleRedirectUri(req: AuthenticatedRequest): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const queryOrigin = typeof req.query.origin === 'string' ? req.query.origin.trim().replace(/\/+$/, '') : '';
  if (/^(https:\/\/[a-z0-9.-]+(:\d+)?|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i.test(queryOrigin)) {
    return `${queryOrigin}/api/auth/google/callback`;
  }

  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  if (forwardedHost && !forwardedHost.startsWith('localhost') && !forwardedHost.startsWith('127.0.0.1')) {
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
    return `${proto}://${forwardedHost}/api/auth/google/callback`;
  }

  const appUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (appUrl) {
    return `${appUrl}/api/auth/google/callback`;
  }

  return 'http://localhost:3000/api/auth/google/callback';
}

function renderGoogleCallbackHtml(payload: { type: 'GOOGLE_AUTH_SUCCESS'; exchangeCode: string } | { type: 'GOOGLE_AUTH_ERROR'; error: string }): string {
  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  const fallbackUrl =
    payload.type === 'GOOGLE_AUTH_SUCCESS'
      ? `/signin?google_code=${encodeURIComponent(payload.exchangeCode)}`
      : `/signin?google_error=${encodeURIComponent(payload.error)}`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>NexaFlow Google Sign-In</title>
  </head>
  <body style="font-family:system-ui,sans-serif;background:#080B14;color:#F8FAFC;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
    <div style="text-align:center;padding:24px;max-width:360px;">
      <p style="font-size:14px;margin:0 0 8px;">${payload.type === 'GOOGLE_AUTH_SUCCESS' ? 'Google sign-in verified. Returning to NexaFlow...' : 'Sign-in could not be completed.'}</p>
      <p style="font-size:12px;color:#94A3B8;margin:0;">This window will close automatically.</p>
    </div>
    <script>
      (function () {
        var data = ${safeJson};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(data, '*');
            window.close();
            return;
          }
        } catch (e) {}
        window.location.replace(${JSON.stringify(fallbackUrl)});
      })();
    </script>
  </body>
</html>`;
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

// ---- Pure MongoDB/SQLite Google OAuth 2.0 Sign-In (Zero Firebase) ----
authRouter.get('/google/status', (req: AuthenticatedRequest, res) => {
  const creds = getGoogleOAuthCredentials();
  res.json({
    configured: Boolean(creds),
    redirectUri: resolveGoogleRedirectUri(req),
  });
});

authRouter.get('/google/url', (req: AuthenticatedRequest, res) => {
  const creds = getGoogleOAuthCredentials();
  const redirectUri = resolveGoogleRedirectUri(req);
  if (!creds) {
    res.status(503).json({
      error: `Google Sign-In is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your server environment and whitelist callback URL: ${redirectUri}`,
      code: 'GOOGLE_OAUTH_NOT_CONFIGURED',
      redirectUri,
    });
    return;
  }

  const state = signEphemeralPayload(
    {
      nonce: crypto.randomBytes(12).toString('hex'),
      redirectUri,
    },
    10 * 60 * 1000
  );

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });

  res.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    redirectUri,
  });
});

async function handleGoogleCallback(req: AuthenticatedRequest, res: import('express').Response): Promise<void> {
  const creds = getGoogleOAuthCredentials();
  if (!creds) {
    res.status(503).send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_ERROR', error: 'Google OAuth credentials are not configured on the server.' }));
    return;
  }

  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  if (oauthError) {
    res.status(400).send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_ERROR', error: 'Google sign-in was cancelled or denied.' }));
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateToken = typeof req.query.state === 'string' ? req.query.state : '';
  const verifiedState = verifyEphemeralPayload<{ nonce?: string; redirectUri?: string }>(stateToken);
  if (!code || !verifiedState?.redirectUri) {
    res.status(400).send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_ERROR', error: 'Invalid or expired Google OAuth session state.' }));
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: verifiedState.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => '');
      console.error('[Google OAuth Token Error]', tokenRes.status, detail);
      res.status(401).send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_ERROR', error: 'Failed to verify Google authorization code.' }));
      return;
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      res.status(401).send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_ERROR', error: 'Google did not return an access token.' }));
      return;
    }

    const userInfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userInfoRes.ok) {
      res.status(401).send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_ERROR', error: 'Unable to load Google profile information.' }));
      return;
    }

    const profile = (await userInfoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    const email = profile.email?.trim().toLowerCase();
    const googleId = profile.sub?.trim();
    if (!email || !googleId || profile.email_verified === false) {
      res.status(400).send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_ERROR', error: 'Your Google account must have a verified email address.' }));
      return;
    }

    let user = (await db.findUserByGoogleId(googleId)) || (await db.findUserByEmail(email));
    if (user) {
      if (user.status === 'suspended') {
        res.status(403).send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_ERROR', error: 'This account has been suspended. Contact support for assistance.' }));
        return;
      }
      if (!user.googleId || !user.emailVerified) {
        await db.updateUser(user.id, {
          googleId,
          emailVerified: true,
          verificationToken: null,
          verificationExpiresAt: null,
        });
        user = (await db.findUserById(user.id)) || user;
      }
    } else {
      const now = new Date().toISOString();
      const newUser = {
        id: crypto.randomUUID(),
        name: (profile.name || email.split('@')[0] || 'Creator').trim().slice(0, 80),
        email,
        passwordHash: hashPassword(crypto.randomBytes(32).toString('hex')),
        googleId,
        authProvider: 'google' as const,
        emailVerified: true,
        verificationToken: null,
        verificationExpiresAt: null,
        resetToken: null,
        resetExpiresAt: null,
        role: 'free' as const,
        status: 'active' as const,
        mfaEnabled: false,
        mfaSecret: null,
        createdAt: now,
        updatedAt: now,
      };
      await db.createUser(newUser);
      await resolveEntitlements(newUser);
      user = newUser;
    }

    const exchangeCode = signEphemeralPayload(
      { userId: user.id, purpose: 'google_signin' },
      2 * 60 * 1000
    );

    res.send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_SUCCESS', exchangeCode }));
  } catch (err) {
    console.error('[Google OAuth Callback Error]', err);
    res.status(500).send(renderGoogleCallbackHtml({ type: 'GOOGLE_AUTH_ERROR', error: 'Unexpected error completing Google sign-in.' }));
  }
}

authRouter.get(['/google/callback', '/google/callback/'], handleGoogleCallback);

authRouter.post('/google/complete', authRateLimit, async (req, res) => {
  const { exchangeCode } = req.body ?? {};
  const payload = verifyEphemeralPayload<{ userId?: string; purpose?: string }>(exchangeCode);
  if (!payload || payload.purpose !== 'google_signin' || typeof payload.userId !== 'string') {
    res.status(401).json({ error: 'Google sign-in session expired. Please try again.' });
    return;
  }

  const user = await db.findUserById(payload.userId);
  if (!user) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  if (user.status === 'suspended') {
    res.status(403).json({ error: 'This account has been suspended. Contact support for assistance.' });
    return;
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
