import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Layers,
  Lock,
  LogOut,
  Percent,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Ticket,
  Trash2,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import { BrandLogo } from '../components/BrandLogo';
import type {
  AppSettings,
  AuditLog,
  CouponRecord,
  PaymentRecord,
  PlanId,
  PlanRecord,
  PublicUser,
  StudioCategory,
  StudioTemplate,
  SubscriptionRecord,
  SupportRequest,
} from '../../shared/types';

interface OverviewMetrics {
  totalUsers: number;
  verifiedUsers: number;
  activeByPlan: Record<string, number>;
  totalTemplates: number;
  availableTemplates: number;
  exportsThisMonth: number;
  openSupportTickets: number;
  verifiedPaymentsCount: number;
  verifiedRevenueUsd: number;
  activeCouponsCount?: number;
}

interface AdminUserRow extends PublicUser {
  subscription: SubscriptionRecord | null;
}

export function AdminDashboard() {
  const { user, plan: activePlan, refreshAuth, logout } = useAuth();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [requiresToken, setRequiresToken] = useState<boolean>(false);
  const [tab, setTab] = useState<'overview' | 'users' | 'plans' | 'coupons' | 'templates' | 'payments' | 'support' | 'settings' | 'audit'>('overview');

  // Bootstrap form state
  const [setupToken, setSetupToken] = useState('');
  const [bootName, setBootName] = useState('');
  const [bootEmail, setBootEmail] = useState('');
  const [bootPassword, setBootPassword] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootSubmitting, setBootSubmitting] = useState(false);

  // Direct Admin Sign-In form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTotp, setLoginTotp] = useState('');
  const [loginMfaRequired, setLoginMfaRequired] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // Admin data
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [tickets, setTickets] = useState<SupportRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [switchingPlan, setSwitchingPlan] = useState(false);

  // Coupon creation state
  const [couponCode, setCouponCode] = useState('');
  const [couponDescription, setCouponDescription] = useState('');
  const [couponType, setCouponType] = useState<'percent' | 'fixed_usd'>('percent');
  const [couponValue, setCouponValue] = useState('25');
  const [couponPlans, setCouponPlans] = useState<PlanId[]>([]);
  const [couponMaxUses, setCouponMaxUses] = useState('');
  const [couponExpiresAt, setCouponExpiresAt] = useState('');
  const [copiedCouponId, setCopiedCouponId] = useState<string | null>(null);

  // Manual exchange rate input
  const [manualRate, setManualRate] = useState('');

  // MFA enrollment
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaOtpUrl, setMfaOtpUrl] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  // New template form
  const [newTplName, setNewTplName] = useState('');
  const [newTplCategory, setNewTplCategory] = useState<StudioCategory>('Educational Studios');
  const [newTplBg, setNewTplBg] = useState('');

  const loadAllAdminData = useCallback(async () => {
    const [ov, us, pl, cp, tp, pm, sp, au] = await Promise.all([
      apiRequest<{ metrics: OverviewMetrics; settings: AppSettings }>('/api/admin/overview'),
      apiRequest<{ users: AdminUserRow[] }>('/api/admin/users'),
      apiRequest<{ plans: PlanRecord[] }>('/api/admin/plans'),
      apiRequest<{ coupons: CouponRecord[] }>('/api/admin/coupons'),
      apiRequest<{ templates: StudioTemplate[] }>('/api/admin/templates'),
      apiRequest<{ payments: PaymentRecord[] }>('/api/admin/payments'),
      apiRequest<{ tickets: SupportRequest[] }>('/api/admin/support'),
      apiRequest<{ logs: AuditLog[] }>('/api/admin/audit-logs'),
    ]);
    setMetrics(ov.metrics);
    setSettings(ov.settings);
    if (ov.settings.usdToGhsRate) setManualRate(String(ov.settings.usdToGhsRate));
    setUsersList(us.users);
    setPlans(pl.plans);
    setCoupons(cp.coupons);
    setTemplates(tp.templates);
    setPayments(pm.payments);
    setTickets(sp.tickets);
    setAuditLogs(au.logs);
  }, []);

  useEffect(() => {
    apiRequest<{ needsSetup: boolean; requiresToken?: boolean }>('/api/admin/bootstrap-status')
      .then((d) => {
        setNeedsSetup(d.needsSetup);
        setRequiresToken(Boolean(d.requiresToken));
      })
      .catch(() => setNeedsSetup(false));
  }, []);

  useEffect(() => {
    if (user?.role === 'admin' && needsSetup === false) {
      void loadAllAdminData();
    }
  }, [user, needsSetup, loadAllAdminData]);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setBootError(null);
    setBootSubmitting(true);
    try {
      await apiRequest('/api/admin/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          setupToken: requiresToken ? setupToken : undefined,
          name: bootName,
          email: bootEmail,
          password: bootPassword,
        }),
      });
      await refreshAuth();
      setNeedsSetup(false);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Provisioning failed.');
    } finally {
      setBootSubmitting(false);
    }
  };

  const handleAdminSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginSubmitting(true);
    try {
      const res = await apiRequest<{ mfaRequired?: boolean; user?: { role: string } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          totpCode: loginMfaRequired ? loginTotp : undefined,
        }),
      });
      if (res.mfaRequired) {
        setLoginMfaRequired(true);
        setLoginSubmitting(false);
        return;
      }
      if (res.user?.role !== 'admin') {
        setLoginError('Signed in, but this account does not hold administrator privileges.');
      }
      await refreshAuth();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Administrator sign in failed.');
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleUserPatch = async (id: string, patch: Record<string, unknown>) => {
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await loadAllAdminData();
      setFeedback({ type: 'success', msg: 'User account updated.' });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to update user.' });
    }
  };

  const handleSetMyPlan = async (targetPlan: 'all' | PlanId) => {
    setFeedback(null);
    setSwitchingPlan(true);
    try {
      const res = await apiRequest<{ plan: PlanRecord }>('/api/admin/set-my-plan', {
        method: 'POST',
        body: JSON.stringify({ planId: targetPlan }),
      });
      await refreshAuth();
      await loadAllAdminData();
      setFeedback({ type: 'success', msg: `Workspace access switched to: ${res.plan.name}.` });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Unable to switch admin plan access.' });
    } finally {
      setSwitchingPlan(false);
    }
  };

  const handleGrantUserPlan = async (userId: string, planId: PlanId) => {
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/users/${userId}/grant-plan`, {
        method: 'POST',
        body: JSON.stringify({ planId, durationDays: 30 }),
      });
      await loadAllAdminData();
      setFeedback({ type: 'success', msg: `Granted ${planId.replace('_', ' ')} plan to user.` });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to grant plan.' });
    }
  };

  const generateRandomCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let token = 'NEXA-';
    for (let i = 0; i < 6; i++) token += chars[Math.floor(Math.random() * chars.length)];
    setCouponCode(token);
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiRequest('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: couponCode,
          description: couponDescription,
          discountType: couponType,
          discountValue: Number(couponValue),
          applicablePlans: couponPlans,
          maxRedemptions: couponMaxUses ? Number(couponMaxUses) : null,
          expiresAt: couponExpiresAt ? couponExpiresAt : null,
        }),
      });
      setCouponCode('');
      setCouponDescription('');
      setCouponValue('25');
      setCouponPlans([]);
      setCouponMaxUses('');
      setCouponExpiresAt('');
      await loadAllAdminData();
      setFeedback({ type: 'success', msg: 'Discount coupon created and ready to share.' });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to create coupon.' });
    }
  };

  const handleToggleCoupon = async (c: CouponRecord) => {
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/coupons/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !c.active }),
      });
      await loadAllAdminData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to update coupon.' });
    }
  };

  const handleDeleteCoupon = async (id: string) => {
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/coupons/${id}`, { method: 'DELETE' });
      await loadAllAdminData();
      setFeedback({ type: 'success', msg: 'Coupon deleted.' });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to delete coupon.' });
    }
  };

  const handleSavePlan = async (plan: PlanRecord) => {
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/plans/${plan.id}`, { method: 'PUT', body: JSON.stringify(plan) });
      await loadAllAdminData();
      setFeedback({ type: 'success', msg: `Plan "${plan.name}" saved.` });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save plan.' });
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiRequest('/api/admin/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: newTplName,
          category: newTplCategory,
          backgroundUrl: newTplBg,
          thumbnailUrl: newTplBg,
        }),
      });
      setNewTplName('');
      setNewTplBg('');
      await loadAllAdminData();
      setFeedback({ type: 'success', msg: 'Studio template created.' });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to create template.' });
    }
  };

  const handleToggleTemplate = async (tpl: StudioTemplate) => {
    await apiRequest(`/api/admin/templates/${tpl.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isAvailable: !tpl.isAvailable }),
    });
    await loadAllAdminData();
  };

  const handleDeleteTemplate = async (id: string) => {
    await apiRequest(`/api/admin/templates/${id}`, { method: 'DELETE' });
    await loadAllAdminData();
  };

  const handleTicketStatus = async (id: string, status: SupportRequest['status']) => {
    await apiRequest(`/api/admin/support/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await loadAllAdminData();
  };

  const handleSaveSettings = async (patch: Partial<AppSettings>) => {
    setFeedback(null);
    try {
      const res = await apiRequest<{ settings: AppSettings }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      setSettings(res.settings);
      setFeedback({ type: 'success', msg: 'System settings saved.' });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save settings.' });
    }
  };

  const handleSyncRate = async () => {
    setFeedback(null);
    try {
      const res = await apiRequest<{ settings: AppSettings }>('/api/admin/settings/sync-exchange-rate', {
        method: 'POST',
      });
      setSettings(res.settings);
      if (res.settings.usdToGhsRate) setManualRate(String(res.settings.usdToGhsRate));
      setFeedback({ type: 'success', msg: `Synced USD -> GHS rate: ${res.settings.usdToGhsRate}` });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Exchange rate sync failed.' });
    }
  };

  const handleStartMfa = async () => {
    const res = await apiRequest<{ secret: string; otpauthUrl: string }>('/api/admin/mfa/setup', { method: 'POST' });
    setMfaSecret(res.secret);
    setMfaOtpUrl(res.otpauthUrl);
  };

  const handleConfirmMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiRequest('/api/admin/mfa/enable', { method: 'POST', body: JSON.stringify({ code: mfaCode }) });
      setMfaSecret(null);
      setMfaOtpUrl(null);
      setMfaCode('');
      await refreshAuth();
      setFeedback({ type: 'success', msg: 'Two-factor authentication enabled for your administrator account.' });
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Invalid MFA code.' });
    }
  };

  if (needsSetup === null) {
    return <div className="min-h-screen bg-[#080B14] text-slate-300 flex items-center justify-center text-sm">Loading administrator console...</div>;
  }

  // Initial Zero-Hardcoded-Password Administrator Provisioning
  if (needsSetup) {
    return (
      <div className="min-h-screen bg-[#080B14] text-[#F8FAFC] flex items-center justify-center p-4">
        <div className="w-full max-w-md p-7 rounded-xl bg-[#111827] border border-slate-800 space-y-5">
          <div className="flex items-center gap-2 text-[#06B6D4]">
            <ShieldCheck className="w-6 h-6" />
            <h1 className="font-display text-xl font-bold text-white">Initial Administrator Setup</h1>
          </div>
          <p className="text-xs text-[#94A3B8] leading-relaxed">
            {requiresToken
              ? 'No administrator exists in the database. Enter your configured INITIAL_ADMIN_PROVISION_TOKEN along with your administrator credentials.'
              : 'No administrator account has been created yet. Create the first administrator account below. Once provisioned, initial setup is permanently locked.'}
          </p>
          {bootError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">{bootError}</div>
          )}
          <form onSubmit={handleBootstrap} className="space-y-3.5 text-xs">
            {requiresToken && (
              <input
                required
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                placeholder="One-time provisioning token"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B14] border border-slate-700 font-mono"
              />
            )}
            <input
              required
              value={bootName}
              onChange={(e) => setBootName(e.target.value)}
              placeholder="Administrator full name"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B14] border border-slate-700"
            />
            <input
              required
              type="email"
              autoComplete="email"
              value={bootEmail}
              onChange={(e) => setBootEmail(e.target.value)}
              placeholder="Administrator email"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B14] border border-slate-700"
            />
            <input
              required
              minLength={12}
              type="password"
              autoComplete="new-password"
              value={bootPassword}
              onChange={(e) => setBootPassword(e.target.value)}
              placeholder="Strong password (12+ chars, upper/lower/number)"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B14] border border-slate-700"
            />
            <button
              type="submit"
              disabled={bootSubmitting}
              className="w-full py-2.5 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E6] disabled:opacity-60"
            >
              {bootSubmitting ? 'Creating Administrator...' : 'Create Administrator Account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-[#080B14] text-[#F8FAFC] flex items-center justify-center p-4">
        <div className="max-w-md w-full p-7 rounded-xl bg-[#111827] border border-slate-800 space-y-5">
          <div className="text-center space-y-2">
            <Lock className="w-8 h-8 text-amber-400 mx-auto" />
            <h1 className="font-display text-xl font-bold">Administrator Sign In</h1>
            <p className="text-xs text-[#94A3B8]">
              {user
                ? `Signed in as ${user.email} (${user.role}), which does not hold administrator privileges.`
                : 'Sign in with your administrator email and password to open the console.'}
            </p>
          </div>

          {loginError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleAdminSignIn} className="space-y-3.5 text-xs">
            <input
              required
              type="email"
              autoComplete="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Administrator email"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B14] border border-slate-700"
            />
            <input
              required
              type="password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Administrator password"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B14] border border-slate-700"
            />
            {loginMfaRequired && (
              <input
                required
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={loginTotp}
                onChange={(e) => setLoginTotp(e.target.value)}
                placeholder="6-digit authenticator code"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B14] border border-slate-700 font-mono tracking-widest"
              />
            )}
            <button
              type="submit"
              disabled={loginSubmitting}
              className="w-full py-2.5 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E6] disabled:opacity-60"
            >
              {loginSubmitting ? 'Signing In...' : loginMfaRequired ? 'Verify Code & Sign In' : 'Sign In as Administrator'}
            </button>
          </form>

          <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
            <Link to="/" className="text-[#94A3B8] hover:text-white">
              Return Home
            </Link>
            {user ? (
              <button type="button" onClick={() => void logout()} className="text-red-400 hover:underline">
                Sign out {user.email}
              </button>
            ) : (
              <Link to="/signin?next=/admin" className="text-[#06B6D4] hover:underline">
                Standard Sign-In Page
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080B14] text-[#F8FAFC] flex flex-col lg:flex-row">
      <aside className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-slate-800 bg-[#111827] p-4 flex flex-col justify-between shrink-0">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <BrandLogo size="sm" label="NexaStudios Admin" textClassName="text-white text-base" />
            <div className="text-xs text-[#94A3B8] truncate">{user.email}</div>
          </div>

          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
            {[
              { id: 'overview', label: 'Overview', icon: Activity },
              { id: 'users', label: 'Users', icon: Users },
              { id: 'plans', label: 'Plans & Limits', icon: Sliders },
              { id: 'coupons', label: 'Coupons & Discounts', icon: Percent },
              { id: 'templates', label: 'Studio Templates', icon: Layers },
              { id: 'payments', label: 'Payments', icon: CreditCard },
              { id: 'support', label: 'Support Requests', icon: Ticket },
              { id: 'settings', label: 'System & Security', icon: Settings },
              { id: 'audit', label: 'Audit Logs', icon: ShieldCheck },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as typeof tab)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  tab === item.id ? 'bg-[#6366F1] text-white' : 'text-[#94A3B8] hover:text-white hover:bg-[#172033]'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="hidden lg:flex flex-col gap-1 pt-4 border-t border-slate-800 text-xs">
          <Link to="/dashboard" className="px-3 py-2 rounded-lg text-[#94A3B8] hover:text-white">
            Creator Dashboard
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[#94A3B8] hover:text-red-400"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-6">
        {feedback && (
          <div
            className={`p-3.5 rounded-xl text-xs flex items-center gap-2 ${
              feedback.type === 'error'
                ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            }`}
          >
            {feedback.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{feedback.msg}</span>
          </div>
        )}

        {tab === 'overview' && metrics && (
          <div className="space-y-6">
            <h1 className="font-display text-2xl font-bold">System Overview (Live Database Metrics)</h1>

            <div className="p-5 rounded-xl bg-gradient-to-r from-[#6366F1]/15 via-[#111827] to-[#06B6D4]/15 border border-[#6366F1]/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#06B6D4]">
                  <Sparkles className="w-4 h-4" />
                  <span>Administrator Workspace Access</span>
                </div>
                <div className="font-display text-lg font-bold text-white">
                  {activePlan?.name || 'All Plans (Admin Full Access)'}
                </div>
                <p className="text-xs text-[#94A3B8]">
                  Full 4K export, unlimited templates, OBS clean browser output, and zero watermark are enabled by default for admins.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link
                  to="/dashboard/live-studio"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E6]"
                >
                  <span>Open Live Studio</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => setTab('plans')}
                  className="px-3.5 py-2 rounded-lg border border-slate-700 text-slate-200 hover:border-[#06B6D4]"
                >
                  Switch / Preview Plan
                </button>
                <button
                  type="button"
                  onClick={() => setTab('coupons')}
                  className="px-3.5 py-2 rounded-lg border border-slate-700 text-slate-200 hover:border-[#06B6D4]"
                >
                  Create Discount Coupon
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-xl bg-[#111827] border border-slate-800">
                <div className="text-xs text-[#94A3B8]">Registered Users</div>
                <div className="font-mono tabular-nums text-2xl font-bold mt-1">{metrics.totalUsers}</div>
                <div className="text-xs text-slate-400 mt-1">{metrics.verifiedUsers} email-verified</div>
              </div>
              <div className="p-5 rounded-xl bg-[#111827] border border-slate-800">
                <div className="text-xs text-[#94A3B8]">Exports This Month</div>
                <div className="font-mono tabular-nums text-2xl font-bold mt-1">{metrics.exportsThisMonth}</div>
                <div className="text-xs text-slate-400 mt-1">Server-authorized exports</div>
              </div>
              <div className="p-5 rounded-xl bg-[#111827] border border-slate-800">
                <div className="text-xs text-[#94A3B8]">Verified Revenue (USD)</div>
                <div className="font-mono tabular-nums text-2xl font-bold mt-1">${metrics.verifiedRevenueUsd.toFixed(2)}</div>
                <div className="text-xs text-slate-400 mt-1">{metrics.verifiedPaymentsCount} verified payment(s)</div>
              </div>
              <div className="p-5 rounded-xl bg-[#111827] border border-slate-800">
                <div className="text-xs text-[#94A3B8]">Active Coupons / Tickets</div>
                <div className="font-mono tabular-nums text-2xl font-bold mt-1">{metrics.activeCouponsCount ?? coupons.filter((c) => c.active).length}</div>
                <div className="text-xs text-slate-400 mt-1">{metrics.openSupportTickets} open ticket(s) · {settings?.databaseEngine}</div>
              </div>
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div className="space-y-4">
            <h1 className="font-display text-xl font-bold">User Accounts ({usersList.length})</h1>
            <div className="rounded-xl overflow-x-auto bg-[#111827] border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-[#94A3B8]">
                  <tr>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Role / Active Plan</th>
                    <th className="py-3 px-4">Grant Plan (30d)</th>
                    <th className="py-3 px-4">Verified</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {usersList.map((u) => (
                    <tr key={u.id}>
                      <td className="py-3 px-4">
                        <div className="font-medium text-white">{u.name}</div>
                        <div className="text-[#94A3B8]">{u.email}</div>
                      </td>
                      <td className="py-3 px-4 capitalize">
                        <div>{u.role.replace('_', ' ')}</div>
                        {u.subscription && (
                          <div className="text-[11px] text-[#06B6D4]">
                            Sub: {u.subscription.planId.replace('_', ' ')}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <select
                          aria-label={`Grant plan to ${u.email}`}
                          value={u.subscription?.planId || 'free'}
                          onChange={(e) => handleGrantUserPlan(u.id, e.target.value as PlanId)}
                          className="px-2.5 py-1.5 rounded bg-[#080B14] border border-slate-700 text-xs"
                        >
                          <option value="free">Free</option>
                          <option value="creator">Creator</option>
                          <option value="pro_studio">Pro Studio</option>
                          <option value="business">Business</option>
                        </select>
                      </td>
                      <td className="py-3 px-4">{u.emailVerified ? 'Yes' : 'No'}</td>
                      <td className="py-3 px-4 capitalize">{u.status}</td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {!u.emailVerified && (
                          <button
                            type="button"
                            onClick={() => handleUserPatch(u.id, { emailVerified: true })}
                            className="text-[#06B6D4] hover:underline"
                          >
                            Verify Email
                          </button>
                        )}
                        {u.id !== user.id && (
                          <button
                            type="button"
                            onClick={() =>
                              handleUserPatch(u.id, { status: u.status === 'active' ? 'suspended' : 'active' })
                            }
                            className="text-amber-400 hover:underline"
                          >
                            {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'plans' && (
          <div className="space-y-5">
            <h1 className="font-display text-xl font-bold">Subscription Plans &amp; Administrator Access</h1>

            <div className="p-5 rounded-xl bg-[#111827] border border-[#6366F1]/40 space-y-4 text-xs">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="font-display text-base font-bold text-white">
                    My Administrator Studio Plan Access:{' '}
                    <span className="text-[#06B6D4]">{activePlan?.name || 'All Plans (Admin Full Access)'}</span>
                  </div>
                  <p className="text-[#94A3B8] mt-0.5">
                    Use All Plans Unlocked for unrestricted studio access, or temporarily preview any subscription tier.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/dashboard/live-studio"
                    className="px-3 py-1.5 rounded-lg bg-[#6366F1] text-white font-semibold"
                  >
                    Live Studio
                  </Link>
                  <Link
                    to="/dashboard/video-transform"
                    className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:border-[#06B6D4]"
                  >
                    Video Transform
                  </Link>
                  <Link
                    to="/dashboard/studio-designer"
                    className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:border-[#06B6D4]"
                  >
                    Studio Designer
                  </Link>
                  <Link
                    to="/dashboard/live-broadcast"
                    className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:border-[#06B6D4]"
                  >
                    Live Broadcast
                  </Link>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                {[
                  { id: 'all' as const, label: 'All Plans Unlocked (Full Access)' },
                  { id: 'free' as const, label: 'Preview Free' },
                  { id: 'creator' as const, label: 'Preview Creator' },
                  { id: 'pro_studio' as const, label: 'Preview Pro Studio' },
                  { id: 'business' as const, label: 'Preview Business' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={switchingPlan}
                    onClick={() => handleSetMyPlan(opt.id)}
                    className={`px-3 py-2 rounded-lg font-semibold transition-colors ${
                      (opt.id === 'all' && activePlan?.name?.includes('All Plans')) ||
                      (opt.id !== 'all' && !activePlan?.name?.includes('All Plans') && activePlan?.id === opt.id)
                        ? 'bg-[#06B6D4] text-slate-950'
                        : 'bg-[#080B14] border border-slate-700 text-slate-200 hover:border-[#06B6D4]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {plans.map((p) => (
                <PlanEditorCard
                  key={p.id}
                  plan={p}
                  onSave={handleSavePlan}
                  onActivate={() => handleSetMyPlan(p.id)}
                />
              ))}
            </div>
          </div>
        )}

        {tab === 'coupons' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h1 className="font-display text-xl font-bold">Discount Coupons</h1>
                <p className="text-xs text-[#94A3B8]">
                  Create promo codes to share with clients for percentage or USD discounts on checkout (100% coupons activate plans immediately).
                </p>
              </div>
            </div>

            <form
              onSubmit={handleCreateCoupon}
              className="p-5 rounded-xl bg-[#111827] border border-slate-800 space-y-4 text-xs"
            >
              <div className="font-display text-sm font-semibold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#06B6D4]" />
                <span>Create New Discount Coupon</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[#94A3B8] mb-1">Coupon Code</label>
                  <div className="flex gap-1.5">
                    <input
                      required
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      placeholder="e.g. LAUNCH25"
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700 font-mono uppercase"
                    />
                    <button
                      type="button"
                      onClick={generateRandomCode}
                      className="px-2.5 py-2 rounded-lg border border-slate-700 hover:border-[#06B6D4] shrink-0"
                    >
                      Generate
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[#94A3B8] mb-1">Discount Type</label>
                  <select
                    value={couponType}
                    onChange={(e) => setCouponType(e.target.value as 'percent' | 'fixed_usd')}
                    className="w-full px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700"
                  >
                    <option value="percent">Percentage (% off)</option>
                    <option value="fixed_usd">Fixed Amount ($ USD off)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[#94A3B8] mb-1">
                    {couponType === 'percent' ? 'Percent (1–100)' : 'USD Off'}
                  </label>
                  <input
                    required
                    type="number"
                    min={0.01}
                    max={couponType === 'percent' ? 100 : undefined}
                    step="0.01"
                    value={couponValue}
                    onChange={(e) => setCouponValue(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#94A3B8] mb-1">Max Redemptions (optional)</label>
                  <input
                    type="number"
                    min={1}
                    value={couponMaxUses}
                    onChange={(e) => setCouponMaxUses(e.target.value)}
                    placeholder="Unlimited"
                    className="w-full px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-[#94A3B8] mb-1">Description / Client Note</label>
                  <input
                    value={couponDescription}
                    onChange={(e) => setCouponDescription(e.target.value)}
                    placeholder="e.g. Early creator partner discount"
                    className="w-full px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[#94A3B8] mb-1">Expires On (optional)</label>
                  <input
                    type="date"
                    value={couponExpiresAt}
                    onChange={(e) => setCouponExpiresAt(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700"
                  />
                </div>
                <div>
                  <div className="text-[#94A3B8] mb-1.5">Applicable Paid Plans (empty = All)</div>
                  <div className="flex flex-wrap gap-3 py-1.5">
                    {(['creator', 'pro_studio', 'business'] as PlanId[]).map((pid) => (
                      <label key={pid} className="inline-flex items-center gap-1.5 cursor-pointer capitalize">
                        <input
                          type="checkbox"
                          checked={couponPlans.includes(pid)}
                          onChange={(e) =>
                            setCouponPlans((prev) =>
                              e.target.checked ? [...prev, pid] : prev.filter((x) => x !== pid)
                            )
                          }
                        />
                        <span>{pid.replace('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E6]"
              >
                Create Discount Coupon
              </button>
            </form>

            {coupons.length === 0 ? (
              <div className="p-8 rounded-xl bg-[#111827] border border-slate-800 text-xs text-[#94A3B8]">
                No coupons created yet. Create your first code above to share discounts with clients.
              </div>
            ) : (
              <div className="rounded-xl overflow-x-auto bg-[#111827] border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 text-[#94A3B8]">
                    <tr>
                      <th className="py-3 px-4">Code</th>
                      <th className="py-3 px-4">Discount</th>
                      <th className="py-3 px-4">Plans</th>
                      <th className="py-3 px-4">Usage</th>
                      <th className="py-3 px-4">Expires</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {coupons.map((c) => (
                      <tr key={c.id}>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-white">{c.code}</span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(c.code);
                                setCopiedCouponId(c.id);
                                setTimeout(() => setCopiedCouponId(null), 1500);
                              }}
                              className="text-[#06B6D4] hover:text-cyan-300 inline-flex items-center gap-1"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>{copiedCouponId === c.id ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>
                          {c.description && <div className="text-[11px] text-[#94A3B8] mt-0.5">{c.description}</div>}
                        </td>
                        <td className="py-3 px-4 font-mono text-emerald-400">
                          {c.discountType === 'percent' ? `${c.discountValue}% OFF` : `$${c.discountValue} USD OFF`}
                        </td>
                        <td className="py-3 px-4 capitalize text-[#94A3B8]">
                          {c.applicablePlans.length === 0
                            ? 'All paid plans'
                            : c.applicablePlans.map((p) => p.replace('_', ' ')).join(', ')}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          {c.redemptionsCount} / {c.maxRedemptions ?? '∞'}
                        </td>
                        <td className="py-3 px-4 font-mono text-[#94A3B8]">
                          {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="py-3 px-4">
                          <span className={c.active ? 'text-emerald-400 font-semibold' : 'text-amber-400'}>
                            {c.active ? 'Active' : 'Paused'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right space-x-3">
                          <button
                            type="button"
                            onClick={() => handleToggleCoupon(c)}
                            className="text-[#06B6D4] hover:underline"
                          >
                            {c.active ? 'Pause' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCoupon(c.id)}
                            className="text-red-400 hover:underline inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'templates' && (
          <div className="space-y-6">
            <h1 className="font-display text-xl font-bold">Studio Template Management</h1>
            <form onSubmit={handleCreateTemplate} className="p-5 rounded-xl bg-[#111827] border border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <input
                required
                value={newTplName}
                onChange={(e) => setNewTplName(e.target.value)}
                placeholder="Template name"
                className="px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700"
              />
              <select
                value={newTplCategory}
                onChange={(e) => setNewTplCategory(e.target.value as StudioCategory)}
                className="px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700"
              >
                <option>Church Broadcasting Studios</option>
                <option>Television News Studios</option>
                <option>Podcast Studios</option>
                <option>Educational Studios</option>
                <option>Corporate Presentation Studios</option>
              </select>
              <input
                value={newTplBg}
                onChange={(e) => setNewTplBg(e.target.value)}
                placeholder="Background URL (/src/assets/... or /uploads/...)"
                className="px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700"
              />
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#6366F1] text-white font-semibold">
                Add Template
              </button>
            </form>

            <div className="rounded-xl overflow-x-auto bg-[#111827] border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-[#94A3B8]">
                  <tr>
                    <th className="py-3 px-4">Template</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Plan</th>
                    <th className="py-3 px-4">Availability</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td className="py-3 px-4 font-medium">{t.name}</td>
                      <td className="py-3 px-4 text-[#94A3B8]">{t.category}</td>
                      <td className="py-3 px-4 capitalize">{t.requiredPlan}</td>
                      <td className="py-3 px-4">{t.isAvailable ? 'Active' : 'Unavailable'}</td>
                      <td className="py-3 px-4 text-right space-x-3">
                        <button type="button" onClick={() => handleToggleTemplate(t)} className="text-[#06B6D4] hover:underline">
                          {t.isAvailable ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" onClick={() => handleDeleteTemplate(t.id)} className="text-red-400 hover:underline">
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'payments' && (
          <div className="space-y-4">
            <h1 className="font-display text-xl font-bold">Payment Records ({payments.length})</h1>
            {payments.length === 0 ? (
              <div className="p-8 rounded-xl bg-[#111827] border border-slate-800 text-xs text-[#94A3B8]">
                No Paystack payment records recorded yet.
              </div>
            ) : (
              <div className="rounded-xl overflow-x-auto bg-[#111827] border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 text-[#94A3B8]">
                    <tr>
                      <th className="py-3 px-4">Reference</th>
                      <th className="py-3 px-4">Plan</th>
                      <th className="py-3 px-4">Coupon</th>
                      <th className="py-3 px-4">USD</th>
                      <th className="py-3 px-4">Settled</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-3 px-4 font-mono">{p.reference}</td>
                        <td className="py-3 px-4">{p.planId} ({p.billingCycle})</td>
                        <td className="py-3 px-4 font-mono text-[#06B6D4]">
                          {p.couponCode ? `${p.couponCode} (-$${(p.discountUsd || 0).toFixed(2)})` : '—'}
                        </td>
                        <td className="py-3 px-4 font-mono">${p.amountUsd}</td>
                        <td className="py-3 px-4 font-mono">{(p.amountMinor / 100).toFixed(2)} {p.currency}</td>
                        <td className="py-3 px-4 capitalize">{p.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'support' && (
          <div className="space-y-4">
            <h1 className="font-display text-xl font-bold">Support Queue ({tickets.length})</h1>
            {tickets.length === 0 ? (
              <div className="p-8 rounded-xl bg-[#111827] border border-slate-800 text-xs text-[#94A3B8]">
                No support requests submitted yet.
              </div>
            ) : (
              <div className="space-y-3">
                {tickets.map((t) => (
                  <div key={t.id} className="p-4 rounded-xl bg-[#111827] border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                    <div className="space-y-1">
                      <div className="font-semibold text-white">{t.subject} ({t.priority})</div>
                      <div className="text-[#94A3B8]">{t.name} ({t.email}) · {t.category}</div>
                      <p className="text-slate-300 mt-1">{t.message}</p>
                    </div>
                    <select
                      value={t.status}
                      onChange={(e) => handleTicketStatus(t.id, e.target.value as SupportRequest['status'])}
                      className="px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700 shrink-0"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'settings' && settings && (
          <div className="space-y-6 max-w-3xl">
            <h1 className="font-display text-xl font-bold">System Configuration &amp; Security</h1>

            <div className="p-5 rounded-xl bg-[#111827] border border-slate-800 space-y-4 text-xs">
              <div className="font-display text-base font-semibold">Paystack &amp; Currency Conversion (Ghana Operations)</div>
              <div className="text-[#94A3B8]">
                Paystack API Keys: <strong>{settings.paystackConfigured ? `Configured (${settings.paystackMode})` : 'Not Configured'}</strong>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium mb-1">Settlement Currency</label>
                  <select
                    value={settings.settlementCurrency}
                    onChange={(e) => handleSaveSettings({ settlementCurrency: e.target.value as 'GHS' | 'USD' })}
                    className="w-full px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700"
                  >
                    <option value="GHS">GHS (Ghana Cedis)</option>
                    <option value="USD">USD (International Paystack Merchant)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">USD → GHS Rate</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.0001"
                      value={manualRate}
                      onChange={(e) => setManualRate(e.target.value)}
                      placeholder="e.g. 15.50"
                      className="flex-1 px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveSettings({ usdToGhsRate: Number(manualRate) })}
                      className="px-3 py-2 rounded-lg bg-[#6366F1] text-white font-semibold"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <span className="text-[#94A3B8]">Source: {settings.exchangeRateSource}</span>
                <button
                  type="button"
                  onClick={handleSyncRate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-[#06B6D4]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Sync Verified Rate (open.er-api.com)</span>
                </button>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-[#111827] border border-slate-800 space-y-3 text-xs">
              <div className="font-display text-base font-semibold">Feature Availability Flags</div>
              {[
                { key: 'directStreamingEnabled', label: 'Direct Browser RTMP Streaming (requires external ingest server)' },
                { key: 'cloudStorageEnabled', label: 'Cloud Video Storage (requires external object storage)' },
                { key: 'autoCaptionsEnabled', label: 'Automatic Captions (requires ASR pipeline)' },
                { key: 'maintenanceMode', label: 'Maintenance Mode' },
              ].map((flag) => (
                <label key={flag.key} className="flex items-center justify-between py-1">
                  <span>{flag.label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settings[flag.key as keyof AppSettings])}
                    onChange={(e) => handleSaveSettings({ [flag.key]: e.target.checked })}
                  />
                </label>
              ))}
            </div>

            <div className="p-5 rounded-xl bg-[#111827] border border-slate-800 space-y-3 text-xs">
              <div className="font-display text-base font-semibold">Administrator Two-Factor Authentication (TOTP)</div>
              {user.mfaEnabled ? (
                <div className="text-emerald-400">TOTP Authenticator MFA is active on your administrator account.</div>
              ) : mfaSecret ? (
                <form onSubmit={handleConfirmMfa} className="space-y-3">
                  <div className="p-3 rounded-lg bg-[#080B14] border border-slate-800 space-y-1">
                    <div>Add this Base32 secret to Google Authenticator / 1Password / Authy:</div>
                    <div className="font-mono text-[#06B6D4] break-all">{mfaSecret}</div>
                    {mfaOtpUrl && <div className="text-[11px] text-[#94A3B8] break-all">{mfaOtpUrl}</div>}
                  </div>
                  <div className="flex gap-2">
                    <input
                      required
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      placeholder="6-digit code"
                      className="px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700 font-mono"
                    />
                    <button type="submit" className="px-4 py-2 rounded-lg bg-[#10B981] text-white font-semibold">
                      Verify &amp; Enable MFA
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={handleStartMfa}
                  className="px-4 py-2 rounded-lg bg-[#6366F1] text-white font-semibold"
                >
                  Configure TOTP MFA
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div className="space-y-4">
            <h1 className="font-display text-xl font-bold">Administrative Audit Logs</h1>
            <div className="rounded-xl overflow-x-auto bg-[#111827] border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-[#94A3B8]">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-3 px-4 font-mono">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className="py-3 px-4">{log.actorEmail}</td>
                      <td className="py-3 px-4 font-mono text-[#06B6D4]">{log.action}</td>
                      <td className="py-3 px-4 font-mono">{log.targetType}:{log.targetId.slice(0, 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PlanEditorCard({
  plan,
  onSave,
  onActivate,
}: {
  plan: PlanRecord;
  onSave: (p: PlanRecord) => Promise<void>;
  onActivate: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(plan);
  return (
    <div className="p-5 rounded-xl bg-[#111827] border border-slate-800 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="font-display text-base font-bold text-white">{draft.name}</div>
        <button
          type="button"
          onClick={() => void onActivate()}
          className="px-2.5 py-1 rounded border border-[#06B6D4]/40 text-[#06B6D4] hover:bg-[#06B6D4]/10 font-semibold"
        >
          Preview This Plan
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[#94A3B8] mb-1">Monthly USD</label>
          <input
            type="number"
            value={draft.monthlyPriceUsd}
            onChange={(e) => setDraft({ ...draft, monthlyPriceUsd: Number(e.target.value) })}
            className="w-full px-3 py-1.5 rounded bg-[#080B14] border border-slate-700 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#94A3B8] mb-1">Annual USD</label>
          <input
            type="number"
            value={draft.annualPriceUsd}
            onChange={(e) => setDraft({ ...draft, annualPriceUsd: Number(e.target.value) })}
            className="w-full px-3 py-1.5 rounded bg-[#080B14] border border-slate-700 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#94A3B8] mb-1">Exports / Month</label>
          <input
            type="number"
            value={draft.limits.maxExportsPerMonth}
            onChange={(e) =>
              setDraft({ ...draft, limits: { ...draft.limits, maxExportsPerMonth: Number(e.target.value) } })
            }
            className="w-full px-3 py-1.5 rounded bg-[#080B14] border border-slate-700 font-mono"
          />
        </div>
        <div>
          <label className="block text-[#94A3B8] mb-1">Saved Studios Limit</label>
          <input
            type="number"
            value={draft.limits.maxSavedStudios}
            onChange={(e) =>
              setDraft({ ...draft, limits: { ...draft.limits, maxSavedStudios: Number(e.target.value) } })
            }
            className="w-full px-3 py-1.5 rounded bg-[#080B14] border border-slate-700 font-mono"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => onSave(draft)}
        className="px-4 py-2 rounded-lg bg-[#6366F1] text-white font-semibold"
      >
        Save Plan Configuration
      </button>
    </div>
  );
}
