import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { db } from '../db.ts';
import { requireAuth, type AuthenticatedRequest } from '../security.ts';
import type { BillingCycle, CouponRecord, PaymentRecord, PlanId, PlanRecord, SubscriptionRecord } from '../../shared/types.ts';

export const billingRouter = Router();

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

async function activateSubscriptionFromPayment(payment: PaymentRecord): Promise<void> {
  const now = new Date();
  const durationDays = payment.billingCycle === 'annual' ? 365 : 30;
  const current = await db.getSubscriptionByUserId(payment.userId);
  const startBase =
    current && current.status === 'active' && current.planId === payment.planId && new Date(current.currentPeriodEnd) > now
      ? new Date(current.currentPeriodEnd)
      : now;
  const periodEnd = new Date(startBase.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const sub: SubscriptionRecord = {
    id: current?.id || crypto.randomUUID(),
    userId: payment.userId,
    planId: payment.planId,
    billingCycle: payment.billingCycle,
    status: 'active',
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    autoRenew: false, // Honest manual renewal default unless Paystack recurring subscription is explicitly attached
    updatedAt: now.toISOString(),
  };
  await db.upsertSubscription(sub);

  const user = await db.findUserById(payment.userId);
  if (user && user.role !== 'admin') {
    await db.updateUser(user.id, { role: payment.planId });
  }
}

billingRouter.get('/plans', async (_req, res) => {
  const [plans, settings] = await Promise.all([db.listPlans(), db.getAppSettings()]);
  res.json({
    plans,
    currencyInfo: {
      primaryCurrency: 'USD',
      settlementCurrency: settings.settlementCurrency,
      usdToGhsRate: settings.usdToGhsRate,
      exchangeRateSource: settings.exchangeRateSource,
      exchangeRateUpdatedAt: settings.exchangeRateUpdatedAt,
      paystackConfigured: settings.paystackConfigured,
      paystackMode: settings.paystackMode,
    },
    featureAvailability: {
      directStreamingEnabled: settings.directStreamingEnabled,
      cloudStorageEnabled: settings.cloudStorageEnabled,
      autoCaptionsEnabled: settings.autoCaptionsEnabled,
    },
  });
});

billingRouter.get('/billing/summary', requireAuth, async (req: AuthenticatedRequest, res) => {
  const payments = await db.listPaymentsByUser(req.authUser!.id);
  const settings = await db.getAppSettings();
  res.json({
    subscription: req.subscription,
    plan: req.activePlan,
    usage: req.usage,
    payments,
    currencyInfo: {
      settlementCurrency: settings.settlementCurrency,
      usdToGhsRate: settings.usdToGhsRate,
      exchangeRateSource: settings.exchangeRateSource,
      paystackConfigured: settings.paystackConfigured,
      paystackMode: settings.paystackMode,
    },
  });
});

export async function evaluateCouponForPlan(
  rawCode: string,
  plan: PlanRecord,
  cycle: BillingCycle
): Promise<
  | {
      valid: true;
      coupon: CouponRecord;
      originalAmountUsd: number;
      discountUsd: number;
      finalAmountUsd: number;
    }
  | { valid: false; error: string }
> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { valid: false, error: 'Enter a coupon code.' };
  const coupon = await db.findCouponByCode(code);
  if (!coupon || !coupon.active) {
    return { valid: false, error: `Coupon "${code}" is invalid or inactive.` };
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= new Date()) {
    return { valid: false, error: `Coupon "${code}" has expired.` };
  }
  if (coupon.maxRedemptions !== null && coupon.redemptionsCount >= coupon.maxRedemptions) {
    return { valid: false, error: `Coupon "${code}" has reached its redemption limit.` };
  }
  if (coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(plan.id)) {
    return { valid: false, error: `Coupon "${code}" does not apply to the ${plan.name} plan.` };
  }

  const originalAmountUsd = cycle === 'annual' ? plan.annualPriceUsd : plan.monthlyPriceUsd;
  const rawDiscount =
    coupon.discountType === 'percent'
      ? (originalAmountUsd * coupon.discountValue) / 100
      : coupon.discountValue;
  const discountUsd = Number(Math.min(originalAmountUsd, Math.max(0, rawDiscount)).toFixed(2));
  const finalAmountUsd = Number(Math.max(0, originalAmountUsd - discountUsd).toFixed(2));
  return {
    valid: true,
    coupon,
    originalAmountUsd,
    discountUsd,
    finalAmountUsd,
  };
}

billingRouter.post('/coupons/validate', async (req, res) => {
  const { code, planId, billingCycle } = req.body ?? {};
  if (typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ error: 'Coupon code is required.' });
    return;
  }
  const validPlanIds: PlanId[] = ['creator', 'pro_studio', 'business'];
  if (!validPlanIds.includes(planId)) {
    res.status(400).json({ error: 'Select a valid paid subscription plan to preview this coupon.' });
    return;
  }
  const cycle: BillingCycle = billingCycle === 'annual' ? 'annual' : 'monthly';
  const plan = await db.findPlanById(planId);
  if (!plan || !plan.active) {
    res.status(404).json({ error: 'Selected plan is unavailable.' });
    return;
  }

  const evalRes = await evaluateCouponForPlan(code, plan, cycle);
  if (!evalRes.valid) {
    res.status(400).json({ error: evalRes.error });
    return;
  }

  const settings = await db.getAppSettings();
  const rate = settings.settlementCurrency === 'GHS' && settings.usdToGhsRate ? settings.usdToGhsRate : 1;
  res.json({
    valid: true,
    code: evalRes.coupon.code,
    description: evalRes.coupon.description,
    discountType: evalRes.coupon.discountType,
    discountValue: evalRes.coupon.discountValue,
    applicablePlans: evalRes.coupon.applicablePlans,
    originalAmountUsd: evalRes.originalAmountUsd,
    discountUsd: evalRes.discountUsd,
    finalAmountUsd: evalRes.finalAmountUsd,
    settlementCurrency: settings.settlementCurrency,
    convertedFinalAmount:
      settings.settlementCurrency === 'GHS' && !settings.usdToGhsRate
        ? null
        : Number((evalRes.finalAmountUsd * rate).toFixed(2)),
  });
});

billingRouter.post('/payments/initialize', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { planId, billingCycle, couponCode } = req.body ?? {};
  const validPlanIds: PlanId[] = ['creator', 'pro_studio', 'business'];
  if (!validPlanIds.includes(planId)) {
    res.status(400).json({ error: 'Select a valid paid subscription plan.' });
    return;
  }
  const cycle: BillingCycle = billingCycle === 'annual' ? 'annual' : 'monthly';

  const plan = await db.findPlanById(planId);
  if (!plan || !plan.active) {
    res.status(404).json({ error: 'Selected plan is unavailable.' });
    return;
  }

  const settings = await db.getAppSettings();
  const originalAmountUsd = cycle === 'annual' ? plan.annualPriceUsd : plan.monthlyPriceUsd;
  let finalAmountUsd = originalAmountUsd;
  let discountUsd = 0;
  let appliedCouponCode: string | undefined;

  if (typeof couponCode === 'string' && couponCode.trim()) {
    const evalRes = await evaluateCouponForPlan(couponCode, plan, cycle);
    if (!evalRes.valid) {
      res.status(400).json({ error: evalRes.error });
      return;
    }
    appliedCouponCode = evalRes.coupon.code;
    discountUsd = evalRes.discountUsd;
    finalAmountUsd = evalRes.finalAmountUsd;
  }

  const reference = `nf_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

  // 100% discount coupon: activate subscription directly without charging Paystack
  if (finalAmountUsd <= 0 && appliedCouponCode) {
    const nowIso = new Date().toISOString();
    const payment: PaymentRecord = {
      id: crypto.randomUUID(),
      userId: req.authUser!.id,
      planId: plan.id,
      billingCycle: cycle,
      reference,
      amountUsd: 0,
      currency: settings.settlementCurrency,
      exchangeRate: settings.usdToGhsRate || 1,
      amountMinor: 0,
      status: 'success',
      provider: 'paystack',
      channel: 'coupon_100',
      gatewayResponse: `100% coupon redeemed (${appliedCouponCode})`,
      couponCode: appliedCouponCode,
      originalAmountUsd,
      discountUsd,
      verifiedAt: nowIso,
      createdAt: nowIso,
    };
    await db.createPayment(payment);
    await db.incrementCouponRedemption(appliedCouponCode);
    await activateSubscriptionFromPayment(payment);
    res.json({
      freeCouponActivated: true,
      reference,
      amountUsd: 0,
      originalAmountUsd,
      discountUsd,
      couponCode: appliedCouponCode,
      currency: settings.settlementCurrency,
      convertedAmount: 0,
    });
    return;
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY?.trim();
  if (!secretKey || !publicKey) {
    res.status(503).json({
      error: 'Paystack credentials are not configured. Set PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY in server environment variables.',
      code: 'PAYSTACK_UNCONFIGURED',
    });
    return;
  }

  let settlementCurrency = settings.settlementCurrency;
  let exchangeRate = 1;

  if (settlementCurrency === 'GHS') {
    if (!settings.usdToGhsRate || settings.usdToGhsRate <= 0) {
      res.status(503).json({
        error: 'USD to GHS exchange rate has not been configured or synced in Admin Settings yet.',
        code: 'EXCHANGE_RATE_UNCONFIGURED',
      });
      return;
    }
    exchangeRate = settings.usdToGhsRate;
  }

  const convertedMajor = Number((finalAmountUsd * exchangeRate).toFixed(2));
  const amountMinor = Math.round(convertedMajor * 100);
  const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  try {
    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: req.authUser!.email,
        amount: amountMinor,
        currency: settlementCurrency,
        reference,
        callback_url: `${appUrl}/dashboard/subscription?reference=${encodeURIComponent(reference)}`,
        metadata: {
          userId: req.authUser!.id,
          planId: plan.id,
          billingCycle: cycle,
          amountUsd: finalAmountUsd,
          originalAmountUsd,
          discountUsd,
          couponCode: appliedCouponCode,
          exchangeRate,
        },
      }),
    });

    const data = (await paystackRes.json()) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string; access_code?: string; reference?: string };
    };

    if (!paystackRes.ok || !data.status || !data.data?.authorization_url) {
      res.status(502).json({
        error: data.message || 'Paystack rejected checkout initialization.',
      });
      return;
    }

    const payment: PaymentRecord = {
      id: crypto.randomUUID(),
      userId: req.authUser!.id,
      planId: plan.id,
      billingCycle: cycle,
      reference,
      amountUsd: finalAmountUsd,
      currency: settlementCurrency,
      exchangeRate,
      amountMinor,
      status: 'pending',
      provider: 'paystack',
      couponCode: appliedCouponCode,
      originalAmountUsd,
      discountUsd,
      createdAt: new Date().toISOString(),
    };
    await db.createPayment(payment);

    res.json({
      authorizationUrl: data.data.authorization_url,
      reference,
      amountUsd: finalAmountUsd,
      originalAmountUsd,
      discountUsd,
      couponCode: appliedCouponCode,
      currency: settlementCurrency,
      convertedAmount: convertedMajor,
      exchangeRate,
      mode: settings.paystackMode,
    });
  } catch (err) {
    console.error('[Paystack] Initialize error:', err);
    res.status(502).json({ error: 'Unable to reach Paystack API. Verify network connectivity.' });
  }
});

billingRouter.get('/payments/verify/:reference', requireAuth, async (req: AuthenticatedRequest, res) => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey) {
    res.status(503).json({ error: 'Paystack credentials are not configured.' });
    return;
  }

  const reference = req.params.reference;
  const payment = await db.findPaymentByReference(reference);
  if (!payment || payment.userId !== req.authUser!.id) {
    res.status(404).json({ error: 'Payment record not found.' });
    return;
  }

  if (payment.status === 'success') {
    res.json({ status: 'success', payment, alreadyVerified: true });
    return;
  }

  try {
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const payload = (await verifyRes.json()) as {
      status?: boolean;
      data?: { status?: string; amount?: number; currency?: string; channel?: string; gateway_response?: string };
    };

    if (!verifyRes.ok || !payload.status || !payload.data) {
      res.status(502).json({ error: 'Unable to verify transaction with Paystack.' });
      return;
    }

    const tx = payload.data;
    if (tx.status === 'success' && Number(tx.amount) >= payment.amountMinor && tx.currency === payment.currency) {
      const verifiedAt = new Date().toISOString();
      await db.updatePaymentByReference(reference, {
        status: 'success',
        channel: tx.channel,
        gatewayResponse: tx.gateway_response,
        verifiedAt,
      });
      if (payment.couponCode) {
        await db.incrementCouponRedemption(payment.couponCode);
      }
      await activateSubscriptionFromPayment(payment);
      const updatedPayment = await db.findPaymentByReference(reference);
      res.json({ status: 'success', payment: updatedPayment });
      return;
    }

    if (tx.status === 'failed' || tx.status === 'abandoned') {
      await db.updatePaymentByReference(reference, {
        status: tx.status === 'failed' ? 'failed' : 'abandoned',
        gatewayResponse: tx.gateway_response,
      });
    }

    res.json({ status: tx.status || 'pending', gatewayResponse: tx.gateway_response });
  } catch (err) {
    console.error('[Paystack] Verify error:', err);
    res.status(502).json({ error: 'Failed to contact Paystack verification endpoint.' });
  }
});

billingRouter.post('/webhooks/paystack', async (req: RawBodyRequest, res) => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  const signature = req.headers['x-paystack-signature'];
  if (!secretKey || typeof signature !== 'string' || !req.rawBody) {
    res.status(400).send('Invalid webhook configuration or signature.');
    return;
  }

  const expectedHash = crypto.createHmac('sha512', secretKey).update(req.rawBody).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedHash);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    res.status(401).send('Invalid Paystack signature.');
    return;
  }

  const event = req.body as {
    event?: string;
    data?: { reference?: string; amount?: number; currency?: string; channel?: string; gateway_response?: string };
  };

  const ref = event?.data?.reference;
  if (!ref) {
    res.status(200).json({ received: true });
    return;
  }

  const payment = await db.findPaymentByReference(ref);
  if (!payment) {
    res.status(200).json({ received: true });
    return;
  }

  // Idempotent handling
  if (event.event === 'charge.success' && payment.status !== 'success') {
    if (Number(event.data?.amount) >= payment.amountMinor && event.data?.currency === payment.currency) {
      await db.updatePaymentByReference(ref, {
        status: 'success',
        channel: event.data?.channel,
        gatewayResponse: event.data?.gateway_response,
        verifiedAt: new Date().toISOString(),
      });
      if (payment.couponCode) {
        await db.incrementCouponRedemption(payment.couponCode);
      }
      await activateSubscriptionFromPayment(payment);
    }
  } else if (event.event === 'charge.failed' && payment.status === 'pending') {
    await db.updatePaymentByReference(ref, {
      status: 'failed',
      gatewayResponse: event.data?.gateway_response,
    });
  }

  res.status(200).json({ received: true });
});

billingRouter.post('/billing/cancel', requireAuth, async (req: AuthenticatedRequest, res) => {
  const sub = req.subscription!;
  if (sub.planId === 'free') {
    res.status(400).json({ error: 'You are currently on the Free plan.' });
    return;
  }
  await db.upsertSubscription({
    ...sub,
    status: 'cancelled',
    autoRenew: false,
    updatedAt: new Date().toISOString(),
  });
  if (req.authUser!.role !== 'admin') {
    await db.updateUser(req.authUser!.id, { role: 'free' });
  }
  res.json({ ok: true, message: 'Subscription cancelled. Access reverted to Free tier.' });
});
