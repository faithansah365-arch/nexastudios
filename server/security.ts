import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { db, getDataDir, toPublicUser, type StoredUser } from './db.ts';
import type { PlanRecord, PublicUser, SubscriptionRecord, UsageRecord } from '../shared/types.ts';

export const SESSION_COOKIE_NAME = 'nf_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

let cachedSessionSecret: string | null = null;

export function getSessionSecret(): string {
  if (cachedSessionSecret) return cachedSessionSecret;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    cachedSessionSecret = process.env.SESSION_SECRET;
    return cachedSessionSecret;
  }
  const secretFile = path.join(getDataDir(), '.session_secret');
  try {
    if (fs.existsSync(secretFile)) {
      cachedSessionSecret = fs.readFileSync(secretFile, 'utf8').trim();
      return cachedSessionSecret;
    }
    fs.mkdirSync(getDataDir(), { recursive: true });
    cachedSessionSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, cachedSessionSecret, { mode: 0o600 });
    return cachedSessionSecret;
  } catch {
    // Serverless read-only fallback: derive deterministically from configured DB/OAuth secret if available
    const seed = process.env.MONGODB_URI || process.env.GOOGLE_CLIENT_SECRET || process.env.PAYSTACK_SECRET_KEY;
    if (seed) {
      console.warn('[SECURITY] SESSION_SECRET env var not set; deriving fallback key from deployment config. Set SESSION_SECRET in production.');
      cachedSessionSecret = crypto.createHmac('sha256', 'nexaflow-session-fallback').update(seed).digest('hex');
    } else {
      cachedSessionSecret = crypto.randomBytes(32).toString('hex');
    }
    return cachedSessionSecret;
  }
}

export function signEphemeralPayload(payload: Record<string, unknown>, ttlMs = 10 * 60 * 1000): string {
  const data = { ...payload, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyEphemeralPayload<T extends Record<string, unknown>>(token: string): T | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T & { exp?: number };
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexHash] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hexHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

// Constant-time dummy verification to prevent timing-based account enumeration
export function dummyPasswordVerify(): void {
  const dummySalt = '00000000000000000000000000000000';
  crypto.scryptSync('dummy_timing_protection_value', dummySalt, 64);
}

export function hashToken(rawToken: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(rawToken).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function validatePasswordStrength(password: string, isAdmin = false): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (isAdmin) {
    if (password.length < 12) return 'Administrator passwords must be at least 12 characters.';
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return 'Administrator passwords must include uppercase, lowercase, and numeric characters.';
    }
    return null;
  }
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  return null;
}

// ---- TOTP MFA (RFC 6238, zero external dependencies) ----
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function decodeBase32(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, counterOffset = 0): string {
  const key = decodeBase32(secret);
  const step = Math.floor(Date.now() / 1000 / 30) + counterOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secret: string, inputCode: string): boolean {
  const clean = inputCode.trim();
  if (!/^\d{6}$/.test(clean)) return false;
  for (const offset of [-1, 0, 1]) {
    const expected = generateTotpCode(secret, offset);
    if (crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

// ---- Initial Admin Bootstrap Token ----
export function isBootstrapTokenRequired(): boolean {
  return Boolean(process.env.INITIAL_ADMIN_PROVISION_TOKEN?.trim());
}

export function getOrCreateAdminBootstrapToken(): string | null {
  const configured = process.env.INITIAL_ADMIN_PROVISION_TOKEN?.trim();
  return configured ? configured : null;
}

export function invalidateAdminBootstrapToken(): void {
  const tokenPath = path.join(getDataDir(), 'admin-bootstrap.token');
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }
}

// ---- Rate Limiting ----
interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function rateLimit(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const existing = rateBuckets.get(key);

    if (!existing || existing.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (existing.count >= maxRequests) {
      const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Too many requests. Please wait ${retryAfterSec} seconds and try again.`,
      });
      return;
    }

    existing.count += 1;
    next();
  };
}

// ---- Session Cookie & Auth Middleware ----
export function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const origin = String(req.headers.origin || '').toLowerCase();
  const referer = String(req.headers.referer || '').toLowerCase();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const appUrl = String(process.env.APP_URL || '').toLowerCase();
  const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return (
    req.secure ||
    proto === 'https' ||
    origin.startsWith('https://') ||
    referer.startsWith('https://') ||
    host.includes('.run.app') ||
    host.includes('.vercel.app') ||
    (!isLocalHost && appUrl.startsWith('https://'))
  );
}

function applyCookie(
  res: Response,
  name: string,
  value: string,
  options: CookieOptions,
  partitioned: boolean
): void {
  res.cookie(name, value, options);
  if (partitioned) {
    const current = res.getHeader('Set-Cookie');
    const cookies = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
    const updated = cookies.map((c) =>
      c.startsWith(`${name}=`) && !/;\s*Partitioned\b/i.test(c) ? `${c}; Partitioned` : c
    );
    res.setHeader('Set-Cookie', updated);
  }
}

export function setSessionCookie(res: Response, rawToken: string, req: Request): void {
  const isHttps = isHttpsRequest(req);
  applyCookie(
    res,
    SESSION_COOKIE_NAME,
    rawToken,
    {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      maxAge: SESSION_TTL_MS,
      path: '/',
    },
    isHttps
  );
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isHttps = isHttpsRequest(req);
  applyCookie(
    res,
    SESSION_COOKIE_NAME,
    '',
    {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      maxAge: 0,
      expires: new Date(0),
      path: '/',
    },
    isHttps
  );
}

export async function createSessionForUser(userId: string, req: Request, res: Response): Promise<void> {
  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await db.createSession({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    ip: req.ip || req.socket.remoteAddress || 'unknown',
    userAgent: String(req.headers['user-agent'] || 'unknown').slice(0, 250),
    expiresAt,
    createdAt: now.toISOString(),
  });
  setSessionCookie(res, rawToken, req);
}

export interface AuthenticatedRequest extends Request {
  authUser?: StoredUser;
  publicUser?: PublicUser;
  activePlan?: PlanRecord;
  subscription?: SubscriptionRecord;
  usage?: UsageRecord;
}

export async function resolveEntitlements(user: StoredUser): Promise<{
  subscription: SubscriptionRecord;
  plan: PlanRecord;
  usage: UsageRecord;
}> {
  const plans = await db.listPlans();
  const freePlan = plans.find((p) => p.id === 'free')!;
  const businessPlan = plans.find((p) => p.id === 'business') ?? freePlan;
  let sub = await db.getSubscriptionByUserId(user.id);
  const now = new Date();

  if (!sub) {
    sub = {
      id: crypto.randomUUID(),
      userId: user.id,
      planId: user.role === 'admin' ? 'business' : 'free',
      billingCycle: 'none',
      status: 'active',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365 * 10).toISOString(),
      autoRenew: false,
      updatedAt: now.toISOString(),
    };
    await db.upsertSubscription(sub);
  }

  // Administrators automatically have full access to all plans unless explicitly previewing a tier
  if (user.role === 'admin') {
    const usage = await db.getOrCreateUsage(user.id);
    if (sub.billingCycle === 'admin_preview') {
      const previewPlan = plans.find((p) => p.id === sub!.planId) ?? businessPlan;
      return {
        subscription: { ...sub, status: 'active' },
        plan: previewPlan,
        usage,
      };
    }

    const adminFullPlan: PlanRecord = {
      ...businessPlan,
      name: 'All Plans (Admin Full Access)',
      tagline: 'Full administrator access across every plan capability and template',
      limits: {
        ...businessPlan.limits,
        maxTemplates: -1,
        maxSavedStudios: Math.max(businessPlan.limits.maxSavedStudios, 500),
        maxRecordingMinutes: Math.max(businessPlan.limits.maxRecordingMinutes, 480),
        maxExportsPerMonth: Math.max(businessPlan.limits.maxExportsPerMonth, 10000),
        maxExportResolution: '4k',
        watermarkRequired: false,
        maxUploadMb: Math.max(businessPlan.limits.maxUploadMb, 5120),
        customBranding: true,
        teleprompter: true,
        obsWorkflow: true,
        teamMembers: Math.max(businessPlan.limits.teamMembers, 25),
        prioritySupport: true,
        advancedBroadcast: true,
      },
    };
    return {
      subscription: { ...sub, planId: 'business', status: 'active' },
      plan: adminFullPlan,
      usage,
    };
  }

  // Expire elapsed paid subscriptions cleanly on the server
  let effectivePlanId = sub.planId;
  if (sub.planId !== 'free' && sub.status === 'active' && new Date(sub.currentPeriodEnd) < now) {
    sub = { ...sub, status: 'expired', updatedAt: now.toISOString() };
    await db.upsertSubscription(sub);
    effectivePlanId = 'free';
  } else if (sub.status !== 'active') {
    effectivePlanId = 'free';
  }

  const plan = plans.find((p) => p.id === effectivePlanId) ?? freePlan;
  const usage = await db.getOrCreateUsage(user.id);
  return { subscription: sub, plan, usage };
}

export async function attachSession(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (!rawToken || typeof rawToken !== 'string') {
      next();
      return;
    }
    const tokenHash = hashToken(rawToken);
    const session = await db.findSessionByTokenHash(tokenHash);
    if (!session) {
      next();
      return;
    }
    if (new Date(session.expiresAt) <= new Date()) {
      await db.deleteSessionByTokenHash(tokenHash);
      next();
      return;
    }
    const user = await db.findUserById(session.userId);
    if (!user || user.status === 'suspended') {
      next();
      return;
    }
    req.authUser = user;
    req.publicUser = toPublicUser(user);
    const ent = await resolveEntitlements(user);
    req.subscription = ent.subscription;
    req.activePlan = ent.plan;
    req.usage = ent.usage;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser || req.authUser.role !== 'admin') {
    res.status(403).json({ error: 'Administrator authorization required.' });
    return;
  }
  next();
}

export async function logAudit(
  actor: { id: string; email: string },
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
  req: Request
): Promise<void> {
  await db.insertAuditLog({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    actorEmail: actor.email,
    action,
    targetType,
    targetId,
    details,
    ip: req.ip || req.socket.remoteAddress || 'unknown',
    createdAt: new Date().toISOString(),
  });
}
