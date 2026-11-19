import crypto from 'node:crypto';
import { Router } from 'express';
import { db, toPublicUser } from '../db.ts';
import {
  createSessionForUser,
  generateTotpSecret,
  getOrCreateAdminBootstrapToken,
  hashPassword,
  invalidateAdminBootstrapToken,
  isBootstrapTokenRequired,
  logAudit,
  rateLimit,
  requireAdmin,
  requireAuth,
  resolveEntitlements,
  validatePasswordStrength,
  verifyPassword,
  verifyTotpCode,
  type AuthenticatedRequest,
} from '../security.ts';
import type { CouponRecord, PlanId, StudioTemplate, SubscriptionRecord } from '../../shared/types.ts';

export const adminRouter = Router();

const adminBootstrapLimit = rateLimit('admin_bootstrap', 10, 15 * 60 * 1000);

// Public check only reveals whether an initial admin exists yet (never exposes setup token)
adminRouter.get('/bootstrap-status', async (_req, res) => {
  const adminCount = await db.countAdmins();
  const needsSetup = adminCount === 0;
  res.json({
    needsSetup,
    requiresToken: needsSetup && isBootstrapTokenRequired(),
  });
});

// Secure one-time initial administrator provisioning (no hardcoded passwords)
adminRouter.post('/bootstrap', adminBootstrapLimit, async (req, res) => {
  const adminCount = await db.countAdmins();
  if (adminCount > 0) {
    res.status(410).json({ error: 'Initial administrator provisioning has already been completed.' });
    return;
  }

  const { setupToken, name, email, password } = req.body ?? {};
  const expectedToken = getOrCreateAdminBootstrapToken();
  if (expectedToken) {
    if (typeof setupToken !== 'string' || !setupToken.trim()) {
      res.status(403).json({ error: 'Invalid provisioning token.' });
      return;
    }
    const a = Buffer.from(setupToken.trim());
    const b = Buffer.from(expectedToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(403).json({ error: 'Invalid provisioning token.' });
      return;
    }
  }

  if (typeof name !== 'string' || name.trim().length < 2) {
    res.status(400).json({ error: 'Administrator name is required (at least 2 characters).' });
    return;
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  const pwError = validatePasswordStrength(password, true);
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.findUserByEmail(normalizedEmail);
  if (existing) {
    if (!verifyPassword(password, existing.passwordHash)) {
      res.status(409).json({
        error: 'An account with this email already exists. Enter its matching strong password or use a different email.',
      });
      return;
    }
    await db.updateUser(existing.id, {
      name: name.trim(),
      role: 'admin',
      emailVerified: true,
      status: 'active',
    });
    const promoted = (await db.findUserById(existing.id))!;
    await resolveEntitlements(promoted);
    invalidateAdminBootstrapToken();
    await createSessionForUser(promoted.id, req, res);
    await logAudit({ id: promoted.id, email: promoted.email }, 'ADMIN_BOOTSTRAP', 'user', promoted.id, { promoted: true }, req);
    res.status(201).json({ user: toPublicUser(promoted) });
    return;
  }

  const now = new Date().toISOString();
  const adminUser = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    emailVerified: true,
    verificationToken: null,
    verificationExpiresAt: null,
    resetToken: null,
    resetExpiresAt: null,
    role: 'admin' as const,
    status: 'active' as const,
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.createUser(adminUser);
  await resolveEntitlements(adminUser);
  invalidateAdminBootstrapToken();
  await createSessionForUser(adminUser.id, req, res);
  await logAudit({ id: adminUser.id, email: adminUser.email }, 'ADMIN_BOOTSTRAP', 'user', adminUser.id, {}, req);

  res.status(201).json({ user: toPublicUser(adminUser) });
});

// All routes below require authenticated Admin role
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/overview', async (_req, res) => {
  const [users, subs, payments, templates, support, exportsThisMonth, settings, coupons] = await Promise.all([
    db.listUsers(),
    db.listSubscriptions(),
    db.listAllPayments(),
    db.listTemplates(),
    db.listSupportRequests(),
    db.sumMonthlyExports(),
    db.getAppSettings(),
    db.listCoupons(),
  ]);

  const activeByPlan: Record<PlanId, number> = { free: 0, creator: 0, pro_studio: 0, business: 0 };
  for (const s of subs) {
    if (s.status === 'active' && activeByPlan[s.planId] !== undefined) {
      activeByPlan[s.planId] += 1;
    }
  }

  const verifiedRevenueUsd = payments
    .filter((p) => p.status === 'success')
    .reduce((sum, p) => sum + Number(p.amountUsd || 0), 0);

  res.json({
    metrics: {
      totalUsers: users.length,
      verifiedUsers: users.filter((u) => u.emailVerified).length,
      activeByPlan,
      totalTemplates: templates.length,
      availableTemplates: templates.filter((t) => t.isAvailable).length,
      exportsThisMonth,
      openSupportTickets: support.filter((t) => t.status !== 'resolved').length,
      verifiedPaymentsCount: payments.filter((p) => p.status === 'success').length,
      verifiedRevenueUsd,
      activeCouponsCount: coupons.filter((c) => c.active).length,
    },
    settings,
  });
});

adminRouter.get('/users', async (_req, res) => {
  const [users, subs] = await Promise.all([db.listUsers(), db.listSubscriptions()]);
  const subMap = new Map(subs.map((s) => [s.userId, s]));
  res.json({
    users: users.map((u) => ({
      ...u,
      subscription: subMap.get(u.id) || null,
    })),
  });
});

adminRouter.patch('/users/:id', async (req: AuthenticatedRequest, res) => {
  const target = await db.findUserById(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  const { status, role, emailVerified } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (status === 'active' || status === 'suspended') {
    if (target.id === req.authUser!.id && status === 'suspended') {
      res.status(400).json({ error: 'You cannot suspend your own administrator account.' });
      return;
    }
    patch.status = status;
  }
  if (role && ['free', 'creator', 'pro_studio', 'business', 'admin'].includes(role)) {
    patch.role = role;
  }
  if (typeof emailVerified === 'boolean') {
    patch.emailVerified = emailVerified;
  }

  await db.updateUser(target.id, patch);
  if (patch.status === 'suspended') {
    await db.deleteSessionsByUserId(target.id);
  }
  await logAudit(
    { id: req.authUser!.id, email: req.authUser!.email },
    'USER_UPDATED',
    'user',
    target.id,
    patch,
    req
  );
  const updated = await db.findUserById(target.id);
  res.json({ user: updated ? toPublicUser(updated) : null });
});

adminRouter.get('/plans', async (_req, res) => {
  const plans = await db.listPlans();
  res.json({ plans });
});

// Switch the signed-in admin's workspace entitlement between 'all' (full unlocked) or previewing a specific tier
adminRouter.post('/set-my-plan', async (req: AuthenticatedRequest, res) => {
  const { planId } = req.body ?? {};
  const validTargets = ['all', 'free', 'creator', 'pro_studio', 'business'];
  if (!validTargets.includes(planId)) {
    res.status(400).json({ error: 'Select a valid plan mode (all, free, creator, pro_studio, or business).' });
    return;
  }

  const now = new Date();
  const current = await db.getSubscriptionByUserId(req.authUser!.id);
  const sub: SubscriptionRecord = {
    id: current?.id || crypto.randomUUID(),
    userId: req.authUser!.id,
    planId: planId === 'all' ? 'business' : (planId as PlanId),
    billingCycle: planId === 'all' ? 'none' : 'admin_preview',
    status: 'active',
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365 * 10).toISOString(),
    autoRenew: false,
    updatedAt: now.toISOString(),
  };
  await db.upsertSubscription(sub);
  const ent = await resolveEntitlements(req.authUser!);
  await logAudit(
    { id: req.authUser!.id, email: req.authUser!.email },
    'ADMIN_PLAN_MODE_CHANGED',
    'subscription',
    req.authUser!.id,
    { mode: planId },
    req
  );
  res.json({ subscription: ent.subscription, plan: ent.plan });
});

// Grant any plan directly to any user
adminRouter.post('/users/:id/grant-plan', async (req: AuthenticatedRequest, res) => {
  const target = await db.findUserById(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  const { planId, durationDays } = req.body ?? {};
  const validPlanIds: PlanId[] = ['free', 'creator', 'pro_studio', 'business'];
  if (!validPlanIds.includes(planId)) {
    res.status(400).json({ error: 'Select a valid plan ID.' });
    return;
  }

  const days = typeof durationDays === 'number' && durationDays > 0 ? Math.min(3650, durationDays) : 30;
  const now = new Date();
  const current = await db.getSubscriptionByUserId(target.id);
  const sub: SubscriptionRecord = {
    id: current?.id || crypto.randomUUID(),
    userId: target.id,
    planId,
    billingCycle: planId === 'free' ? 'none' : 'monthly',
    status: 'active',
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    autoRenew: false,
    updatedAt: now.toISOString(),
  };
  await db.upsertSubscription(sub);
  if (target.role !== 'admin') {
    await db.updateUser(target.id, { role: planId });
  }
  await logAudit(
    { id: req.authUser!.id, email: req.authUser!.email },
    'USER_PLAN_GRANTED',
    'user',
    target.id,
    { planId, durationDays: days },
    req
  );
  res.json({ ok: true, subscription: sub });
});

adminRouter.put('/plans/:id', async (req: AuthenticatedRequest, res) => {
  const planId = req.params.id as PlanId;
  const existing = await db.findPlanById(planId);
  if (!existing) {
    res.status(404).json({ error: 'Plan not found.' });
    return;
  }
  const body = req.body ?? {};
  const updated = {
    ...existing,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name,
    tagline: typeof body.tagline === 'string' ? body.tagline.trim() : existing.tagline,
    monthlyPriceUsd: typeof body.monthlyPriceUsd === 'number' && body.monthlyPriceUsd >= 0 ? body.monthlyPriceUsd : existing.monthlyPriceUsd,
    annualPriceUsd: typeof body.annualPriceUsd === 'number' && body.annualPriceUsd >= 0 ? body.annualPriceUsd : existing.annualPriceUsd,
    limits: body.limits ? { ...existing.limits, ...body.limits } : existing.limits,
    active: typeof body.active === 'boolean' ? body.active : existing.active,
    updatedAt: new Date().toISOString(),
  };
  await db.upsertPlan(updated);
  await logAudit(
    { id: req.authUser!.id, email: req.authUser!.email },
    'PLAN_UPDATED',
    'plan',
    planId,
    { monthlyPriceUsd: updated.monthlyPriceUsd, annualPriceUsd: updated.annualPriceUsd },
    req
  );
  res.json({ plan: updated });
});

adminRouter.get('/templates', async (_req, res) => {
  const templates = await db.listTemplates();
  res.json({ templates });
});

adminRouter.post('/templates', async (req: AuthenticatedRequest, res) => {
  const body = req.body ?? {};
  if (typeof body.name !== 'string' || body.name.trim().length < 2) {
    res.status(400).json({ error: 'Template name is required.' });
    return;
  }
  const tpl: StudioTemplate = {
    id: `tpl_${crypto.randomBytes(6).toString('hex')}`,
    name: body.name.trim(),
    category: body.category || 'Corporate Presentation Studios',
    description: typeof body.description === 'string' ? body.description.trim() : '',
    thumbnailUrl: body.thumbnailUrl || body.backgroundUrl || '',
    backgroundUrl: body.backgroundUrl || '',
    studioType: body.studioType || 'layered_2_5d',
    foregroundMaskConfig: body.foregroundMaskConfig || {
      enabled: true,
      deskHeightRatio: 0.25,
      deskStyle: 'minimal_slate',
      perspectiveTilt: 0,
      deskOpacity: 0.96,
    },
    defaultSubjectConfig: body.defaultSubjectConfig || {
      scale: 0.95,
      offsetX: 0,
      offsetY: 0.05,
      colorTemp: 0,
      brightness: 1,
      contrast: 1,
      saturation: 1,
      bgBlur: 2,
      edgeSoftness: 3,
      shadowIntensity: 0.35,
      chromaKeyEnabled: false,
      chromaKeyColor: '#00b140',
      chromaSimilarity: 0.24,
      chromaSmoothness: 0.08,
    },
    defaultBrandingConfig: body.defaultBrandingConfig || {
      logoPosition: 'top-right',
      primaryColor: '#6366F1',
      secondaryColor: '#06B6D4',
      screenText: '',
      showScreenGraphic: false,
      lowerThirdTitle: '',
      lowerThirdSubtitle: '',
      showLowerThird: false,
    },
    recommendedFraming: body.recommendedFraming || 'medium',
    lightingPreset: body.lightingPreset || 'neutral',
    supportedAspectRatios: Array.isArray(body.supportedAspectRatios) ? body.supportedAspectRatios : ['16:9'],
    requiredPlan: body.requiredPlan || 'creator',
    isAvailable: Boolean(body.backgroundUrl),
    availabilityNote: body.backgroundUrl ? undefined : 'Background asset not uploaded yet.',
    sortOrder: Number(body.sortOrder || 99),
    createdAt: new Date().toISOString(),
  };
  await db.upsertTemplate(tpl);
  await logAudit({ id: req.authUser!.id, email: req.authUser!.email }, 'TEMPLATE_CREATED', 'template', tpl.id, { name: tpl.name }, req);
  res.status(201).json({ template: tpl });
});

adminRouter.put('/templates/:id', async (req: AuthenticatedRequest, res) => {
  const templates = await db.listTemplates();
  const existing = templates.find((t) => t.id === req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Template not found.' });
    return;
  }
  const body = req.body ?? {};
  const updated: StudioTemplate = {
    ...existing,
    ...body,
    id: existing.id,
    createdAt: existing.createdAt,
  };
  await db.upsertTemplate(updated);
  await logAudit({ id: req.authUser!.id, email: req.authUser!.email }, 'TEMPLATE_UPDATED', 'template', existing.id, { name: updated.name }, req);
  res.json({ template: updated });
});

adminRouter.delete('/templates/:id', async (req: AuthenticatedRequest, res) => {
  await db.deleteTemplate(req.params.id);
  await logAudit({ id: req.authUser!.id, email: req.authUser!.email }, 'TEMPLATE_DELETED', 'template', req.params.id, {}, req);
  res.json({ ok: true });
});

adminRouter.get('/payments', async (_req, res) => {
  const payments = await db.listAllPayments();
  res.json({ payments });
});

adminRouter.get('/support', async (_req, res) => {
  const tickets = await db.listSupportRequests();
  res.json({ tickets });
});

adminRouter.patch('/support/:id', async (req: AuthenticatedRequest, res) => {
  const { status, adminNotes } = req.body ?? {};
  await db.updateSupportRequest(req.params.id, { status, adminNotes });
  await logAudit({ id: req.authUser!.id, email: req.authUser!.email }, 'SUPPORT_UPDATED', 'support', req.params.id, { status }, req);
  res.json({ ok: true });
});

adminRouter.get('/audit-logs', async (_req, res) => {
  const logs = await db.listAuditLogs(150);
  res.json({ logs });
});

adminRouter.get('/settings', async (_req, res) => {
  const settings = await db.getAppSettings();
  res.json({ settings });
});

adminRouter.put('/settings', async (req: AuthenticatedRequest, res) => {
  const current = await db.getAppSettings();
  const body = req.body ?? {};
  const next = {
    ...current,
    settlementCurrency: body.settlementCurrency === 'USD' ? ('USD' as const) : ('GHS' as const),
    usdToGhsRate:
      typeof body.usdToGhsRate === 'number' && body.usdToGhsRate > 0 ? Number(body.usdToGhsRate.toFixed(4)) : current.usdToGhsRate,
    exchangeRateSource:
      typeof body.usdToGhsRate === 'number' && body.usdToGhsRate > 0
        ? `Admin-configured (${req.authUser!.email})`
        : current.exchangeRateSource,
    exchangeRateUpdatedAt:
      typeof body.usdToGhsRate === 'number' && body.usdToGhsRate > 0 ? new Date().toISOString() : current.exchangeRateUpdatedAt,
    directStreamingEnabled:
      typeof body.directStreamingEnabled === 'boolean' ? body.directStreamingEnabled : current.directStreamingEnabled,
    cloudStorageEnabled: typeof body.cloudStorageEnabled === 'boolean' ? body.cloudStorageEnabled : current.cloudStorageEnabled,
    autoCaptionsEnabled: typeof body.autoCaptionsEnabled === 'boolean' ? body.autoCaptionsEnabled : current.autoCaptionsEnabled,
    maintenanceMode: typeof body.maintenanceMode === 'boolean' ? body.maintenanceMode : current.maintenanceMode,
  };
  await db.saveAppSettings(next);
  await logAudit({ id: req.authUser!.id, email: req.authUser!.email }, 'SETTINGS_UPDATED', 'settings', 'global', next, req);
  res.json({ settings: next });
});

// Explicit verified exchange rate sync via open.er-api.com (no API key, $0)
adminRouter.post('/settings/sync-exchange-rate', async (req: AuthenticatedRequest, res) => {
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = (await resp.json()) as { result?: string; rates?: Record<string, number> };
    const ghs = data?.rates?.GHS;
    if (data?.result !== 'success' || typeof ghs !== 'number' || ghs <= 0) {
      res.status(502).json({ error: 'Exchange rate provider returned an invalid response.' });
      return;
    }
    const current = await db.getAppSettings();
    const next = {
      ...current,
      usdToGhsRate: Number(ghs.toFixed(4)),
      exchangeRateSource: 'open.er-api.com (Verified reference rate)',
      exchangeRateUpdatedAt: new Date().toISOString(),
    };
    await db.saveAppSettings(next);
    await logAudit(
      { id: req.authUser!.id, email: req.authUser!.email },
      'EXCHANGE_RATE_SYNCED',
      'settings',
      'global',
      { usdToGhsRate: next.usdToGhsRate },
      req
    );
    res.json({ settings: next });
  } catch {
    res.status(502).json({ error: 'Unable to reach exchange rate service. You may configure an admin-approved rate manually.' });
  }
});

// Admin TOTP MFA enrollment
adminRouter.post('/mfa/setup', async (req: AuthenticatedRequest, res) => {
  const secret = generateTotpSecret();
  await db.updateUser(req.authUser!.id, { mfaSecret: secret });
  const issuer = encodeURIComponent('NexaFlow AI Studio');
  const label = encodeURIComponent(req.authUser!.email);
  const otpauthUrl = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}`;
  res.json({ secret, otpauthUrl });
});

adminRouter.post('/mfa/enable', async (req: AuthenticatedRequest, res) => {
  const { code } = req.body ?? {};
  const user = await db.findUserById(req.authUser!.id);
  if (!user?.mfaSecret || typeof code !== 'string' || !verifyTotpCode(user.mfaSecret, code)) {
    res.status(400).json({ error: 'Invalid 6-digit authenticator code.' });
    return;
  }
  await db.updateUser(user.id, { mfaEnabled: true });
  await logAudit({ id: user.id, email: user.email }, 'ADMIN_MFA_ENABLED', 'user', user.id, {}, req);
  res.json({ mfaEnabled: true });
});

// ---- Discount Coupons Management ----
adminRouter.get('/coupons', async (_req, res) => {
  const coupons = await db.listCoupons();
  res.json({ coupons });
});

adminRouter.post('/coupons', async (req: AuthenticatedRequest, res) => {
  const body = req.body ?? {};
  const rawCode = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{3,32}$/.test(rawCode)) {
    res.status(400).json({ error: 'Coupon code must be 3–32 characters (letters, numbers, dashes, underscores).' });
    return;
  }
  const existing = await db.findCouponByCode(rawCode);
  if (existing) {
    res.status(409).json({ error: `Coupon code "${rawCode}" already exists.` });
    return;
  }

  const discountType = body.discountType === 'fixed_usd' ? 'fixed_usd' : 'percent';
  const discountValue = Number(body.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    res.status(400).json({ error: 'Discount value must be greater than zero.' });
    return;
  }
  if (discountType === 'percent' && discountValue > 100) {
    res.status(400).json({ error: 'Percentage discount cannot exceed 100%.' });
    return;
  }

  const validPaidPlans: PlanId[] = ['creator', 'pro_studio', 'business'];
  const applicablePlans: PlanId[] = Array.isArray(body.applicablePlans)
    ? body.applicablePlans.filter((p: unknown): p is PlanId => validPaidPlans.includes(p as PlanId))
    : [];

  const maxRedemptionsRaw =
    body.maxRedemptions === null || body.maxRedemptions === '' || body.maxRedemptions === undefined
      ? null
      : Number(body.maxRedemptions);
  const maxRedemptions =
    maxRedemptionsRaw !== null && Number.isFinite(maxRedemptionsRaw) && maxRedemptionsRaw > 0
      ? Math.floor(maxRedemptionsRaw)
      : null;

  const expiresAt =
    typeof body.expiresAt === 'string' && body.expiresAt.trim()
      ? new Date(body.expiresAt.trim()).toISOString()
      : null;

  const now = new Date().toISOString();
  const coupon: CouponRecord = {
    id: crypto.randomUUID(),
    code: rawCode,
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 140) : '',
    discountType,
    discountValue: Number(discountValue.toFixed(2)),
    applicablePlans,
    maxRedemptions,
    redemptionsCount: 0,
    expiresAt,
    active: body.active !== false,
    createdByEmail: req.authUser!.email,
    createdAt: now,
    updatedAt: now,
  };

  await db.upsertCoupon(coupon);
  await logAudit(
    { id: req.authUser!.id, email: req.authUser!.email },
    'COUPON_CREATED',
    'coupon',
    coupon.id,
    { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue },
    req
  );
  res.status(201).json({ coupon });
});

adminRouter.patch('/coupons/:id', async (req: AuthenticatedRequest, res) => {
  const existing = await db.findCouponById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Coupon not found.' });
    return;
  }
  const body = req.body ?? {};
  const updated: CouponRecord = {
    ...existing,
    active: typeof body.active === 'boolean' ? body.active : existing.active,
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 140) : existing.description,
    maxRedemptions:
      body.maxRedemptions === null || body.maxRedemptions === ''
        ? null
        : typeof body.maxRedemptions === 'number' && body.maxRedemptions > 0
        ? Math.floor(body.maxRedemptions)
        : existing.maxRedemptions,
    expiresAt:
      body.expiresAt === null || body.expiresAt === ''
        ? null
        : typeof body.expiresAt === 'string'
        ? new Date(body.expiresAt).toISOString()
        : existing.expiresAt,
    updatedAt: new Date().toISOString(),
  };
  await db.upsertCoupon(updated);
  await logAudit(
    { id: req.authUser!.id, email: req.authUser!.email },
    'COUPON_UPDATED',
    'coupon',
    existing.id,
    { code: existing.code, active: updated.active },
    req
  );
  res.json({ coupon: updated });
});

adminRouter.delete('/coupons/:id', async (req: AuthenticatedRequest, res) => {
  const existing = await db.findCouponById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Coupon not found.' });
    return;
  }
  await db.deleteCoupon(existing.id);
  await logAudit(
    { id: req.authUser!.id, email: req.authUser!.email },
    'COUPON_DELETED',
    'coupon',
    existing.id,
    { code: existing.code },
    req
  );
  res.json({ ok: true });
});
