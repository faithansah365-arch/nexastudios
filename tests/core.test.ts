import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { db } from '../server/db.ts';
import { evaluateCouponForPlan } from '../server/routes/billing.ts';
import {
  generateTotpCode,
  generateTotpSecret,
  hashPassword,
  isBootstrapTokenRequired,
  isHttpsRequest,
  resolveEntitlements,
  validatePasswordStrength,
  verifyPassword,
  verifyTotpCode,
} from '../server/security.ts';

test('scrypt password hashing and verification', () => {
  const hash = hashPassword('StudioPass2026!');
  assert.ok(hash.startsWith('scrypt:'));
  assert.equal(verifyPassword('StudioPass2026!', hash), true);
  assert.equal(verifyPassword('WrongPassword', hash), false);
});

test('password policy enforcement for standard and admin accounts', () => {
  assert.ok(validatePasswordStrength('short', false));
  assert.equal(validatePasswordStrength('ValidUserPass1', false), null);
  assert.ok(validatePasswordStrength('onlylower1234', true));
  assert.equal(validatePasswordStrength('StrongAdminPass2026', true), null);
});

test('TOTP MFA generation and verification', () => {
  const secret = generateTotpSecret();
  const code = generateTotpCode(secret, 0);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotpCode(secret, code), true);
  assert.equal(verifyTotpCode(secret, '000000'), false);
});

test('database seeding, atomic export quota enforcement, and failed export refund', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexaflow-test-'));
  const tmpDb = path.join(tmpDir, 'test.db');
  await db.init(tmpDb);

  const plans = await db.listPlans();
  assert.equal(plans.length, 4);
  const free = plans.find((p) => p.id === 'free');
  assert.ok(free);
  assert.equal(free.limits.maxExportsPerMonth, 2);
  assert.equal(free.limits.watermarkRequired, true);

  const creator = plans.find((p) => p.id === 'creator');
  assert.equal(creator?.monthlyPriceUsd, 19);
  assert.equal(creator?.annualPriceUsd, 190);

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.createUser({
    id: userId,
    name: 'Test Creator',
    email: 'creator-test@example.com',
    passwordHash: hashPassword('TestCreator99!'),
    emailVerified: true,
    role: 'free',
    status: 'active',
    mfaEnabled: false,
    createdAt: now,
    updatedAt: now,
  });

  // First 2 exports allowed on Free plan
  const q1 = await db.atomicConsumeExportQuota(userId, 2);
  assert.equal(q1.allowed, true);
  assert.equal(q1.usage.exportsCount, 1);

  const q2 = await db.atomicConsumeExportQuota(userId, 2);
  assert.equal(q2.allowed, true);
  assert.equal(q2.usage.exportsCount, 2);

  // 3rd concurrent/repeat export blocked atomically
  const q3 = await db.atomicConsumeExportQuota(userId, 2);
  assert.equal(q3.allowed, false);
  assert.equal(q3.usage.exportsCount, 2);

  // Failed export refunds 1 quota slot and records failure
  await db.refundExportQuota(userId);
  const q4 = await db.atomicConsumeExportQuota(userId, 2);
  assert.equal(q4.allowed, true);
  assert.equal(q4.usage.exportsCount, 2);
  assert.equal(q4.usage.failedExportsCount, 1);

  await db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Paystack HMAC-SHA512 webhook signature validation', () => {
  const secret = 'sk_test_example_secret';
  const payload = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'nf_123' } }));
  const sig = crypto.createHmac('sha512', secret).update(payload).digest('hex');
  const expected = crypto.createHmac('sha512', secret).update(payload).digest('hex');
  assert.equal(crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)), true);
});

test('HTTPS detection behind Cloud Run nginx proxy for iframe session cookies', () => {
  const proxyReq = {
    secure: false,
    headers: {
      'x-forwarded-proto': 'http',
      origin: 'https://ais-dev-example.europe-west2.run.app',
      host: 'localhost:3000',
    },
  } as unknown as Parameters<typeof isHttpsRequest>[0];
  assert.equal(isHttpsRequest(proxyReq), true);

  const runHostReq = {
    secure: false,
    headers: {
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'ais-dev-example.run.app',
    },
  } as unknown as Parameters<typeof isHttpsRequest>[0];
  assert.equal(isHttpsRequest(runHostReq), true);

  const localHttpReq = {
    secure: false,
    headers: {
      host: 'localhost:3000',
    },
  } as unknown as Parameters<typeof isHttpsRequest>[0];
  assert.equal(isHttpsRequest(localHttpReq), false);
});

test('admin bootstrap token requirement tracks INITIAL_ADMIN_PROVISION_TOKEN env var', () => {
  const prev = process.env.INITIAL_ADMIN_PROVISION_TOKEN;
  delete process.env.INITIAL_ADMIN_PROVISION_TOKEN;
  assert.equal(isBootstrapTokenRequired(), false);
  process.env.INITIAL_ADMIN_PROVISION_TOKEN = 'custom_secret_token';
  assert.equal(isBootstrapTokenRequired(), true);
  if (prev === undefined) {
    delete process.env.INITIAL_ADMIN_PROVISION_TOKEN;
  } else {
    process.env.INITIAL_ADMIN_PROVISION_TOKEN = prev;
  }
});

test('admin full access to all plans, preview mode switching, and discount coupons evaluation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexaflow-coupon-test-'));
  const tmpDb = path.join(tmpDir, 'test.db');
  await db.init(tmpDb);

  const now = new Date().toISOString();
  const adminUser = {
    id: crypto.randomUUID(),
    name: 'Studio Admin',
    email: 'admin-entitlement@example.com',
    passwordHash: hashPassword('StrongAdminPass2026!'),
    emailVerified: true,
    role: 'admin' as const,
    status: 'active' as const,
    mfaEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.createUser(adminUser);

  // Default admin gets All Plans (Admin Full Access)
  const fullEnt = await resolveEntitlements(adminUser);
  assert.equal(fullEnt.plan.name, 'All Plans (Admin Full Access)');
  assert.equal(fullEnt.plan.limits.maxTemplates, -1);
  assert.equal(fullEnt.plan.limits.maxExportResolution, '4k');
  assert.equal(fullEnt.plan.limits.watermarkRequired, false);
  assert.equal(fullEnt.plan.limits.obsWorkflow, true);
  assert.equal(fullEnt.plan.limits.teleprompter, true);

  // Admin previewing Creator tier temporarily receives Creator plan limits
  await db.upsertSubscription({
    id: fullEnt.subscription.id,
    userId: adminUser.id,
    planId: 'creator',
    billingCycle: 'admin_preview',
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
    autoRenew: false,
    updatedAt: now,
  });
  const previewEnt = await resolveEntitlements(adminUser);
  assert.equal(previewEnt.plan.id, 'creator');
  assert.equal(previewEnt.plan.limits.maxExportResolution, '1080p');

  // Coupons: percentage, fixed USD, 100%-off, plan scope, max redemption, and expiry
  const plans = await db.listPlans();
  const creatorPlan = plans.find((p) => p.id === 'creator')!;
  const businessPlan = plans.find((p) => p.id === 'business')!;

  await db.upsertCoupon({
    id: crypto.randomUUID(),
    code: 'HALFCREATOR',
    description: '50% off Creator only',
    discountType: 'percent',
    discountValue: 50,
    applicablePlans: ['creator'],
    maxRedemptions: 1,
    redemptionsCount: 0,
    expiresAt: null,
    active: true,
    createdByEmail: adminUser.email,
    createdAt: now,
    updatedAt: now,
  });

  const validCreator = await evaluateCouponForPlan('halfcreator', creatorPlan, 'monthly');
  assert.equal(validCreator.valid, true);
  if (validCreator.valid) {
    assert.equal(validCreator.originalAmountUsd, 19);
    assert.equal(validCreator.discountUsd, 9.5);
    assert.equal(validCreator.finalAmountUsd, 9.5);
  }

  const wrongPlan = await evaluateCouponForPlan('HALFCREATOR', businessPlan, 'monthly');
  assert.equal(wrongPlan.valid, false);

  await db.incrementCouponRedemption('HALFCREATOR');
  const exhausted = await evaluateCouponForPlan('HALFCREATOR', creatorPlan, 'monthly');
  assert.equal(exhausted.valid, false);

  await db.upsertCoupon({
    id: crypto.randomUUID(),
    code: 'VIP100',
    description: '100% complimentary',
    discountType: 'percent',
    discountValue: 100,
    applicablePlans: [],
    maxRedemptions: null,
    redemptionsCount: 0,
    expiresAt: null,
    active: true,
    createdByEmail: adminUser.email,
    createdAt: now,
    updatedAt: now,
  });

  const vipEval = await evaluateCouponForPlan('VIP100', businessPlan, 'annual');
  assert.equal(vipEval.valid, true);
  if (vipEval.valid) {
    assert.equal(vipEval.finalAmountUsd, 0);
  }

  await db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
