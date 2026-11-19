import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, CreditCard, Download, FolderKanban, Layers, Percent, Receipt, Settings, Trash2, X } from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import type {
  BillingCycle,
  CustomStudio,
  ExportRecord,
  PaymentRecord,
  PlanId,
  PlanRecord,
  ProjectRecord,
  SupportRequest,
} from '../../shared/types';

export function MyProjectsPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    apiRequest<{ projects: ProjectRecord[] }>('/api/projects')
      .then((d) => setProjects(d.projects))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleDelete = async (id: string) => {
    await apiRequest(`/api/projects/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <DashboardLayout title="My Projects">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-[#94A3B8]">
          Project records store production metadata (title, aspect ratio, duration, studio settings). Raw video files are
          saved directly to your device during local browser export.
        </div>

        {loading ? (
          <div className="h-40 rounded-xl bg-slate-200 dark:bg-[#111827] animate-pulse" />
        ) : projects.length === 0 ? (
          <div className="p-12 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-center space-y-3">
            <FolderKanban className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="font-display text-base font-semibold">No projects yet</div>
            <p className="text-xs text-slate-500">Record in Live AI Studio or transform a video to create a project entry.</p>
            <Link to="/dashboard/live-studio" className="inline-block px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold">
              Open Live Studio
            </Link>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="py-3 px-4">Title</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Aspect Ratio</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3 px-4 font-medium">{p.title}</td>
                    <td className="py-3 px-4 text-slate-500">{p.type.replace('_', ' ')}</td>
                    <td className="py-3 px-4 font-mono">{p.aspectRatio}</td>
                    <td className="py-3 px-4 font-mono">{p.durationSeconds}s</td>
                    <td className="py-3 px-4 font-mono">{new Date(p.createdAt).toLocaleDateString()}</td>
                    <td className="py-3 px-4 text-right">
                      <button type="button" onClick={() => handleDelete(p.id)} className="text-red-400 hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

export function MyStudiosPage() {
  const { refreshAuth } = useAuth();
  const [studios, setStudios] = useState<CustomStudio[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    apiRequest<{ studios: CustomStudio[] }>('/api/studios')
      .then((d) => setStudios(d.studios))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleDelete = async (id: string) => {
    await apiRequest(`/api/studios/${id}`, { method: 'DELETE' });
    await refreshAuth();
    load();
  };

  return (
    <DashboardLayout title="My Studios">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-600 dark:text-[#94A3B8]">Reusable custom studio configurations saved to your account.</p>
          <Link to="/dashboard/studio-generator" className="px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold">
            Create New Studio
          </Link>
        </div>

        {loading ? (
          <div className="h-44 rounded-xl bg-slate-200 dark:bg-[#111827] animate-pulse" />
        ) : studios.length === 0 ? (
          <div className="p-12 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-center space-y-3">
            <Layers className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="font-display text-base font-semibold">No saved studios</div>
            <p className="text-xs text-slate-500">Upload a studio photo or customize a template to save your first studio.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {studios.map((s) => (
              <div key={s.id} className="rounded-xl overflow-hidden bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
                <div className="aspect-video bg-slate-900">
                  <img src={s.backgroundUrl} alt={s.name} className="w-full h-full object-cover" />
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <div className="text-xs text-slate-500">{s.category} · {s.studioType === 'layered_2_5d' ? '2.5D Layered' : '2D'}</div>
                    <div className="font-display text-base font-semibold mt-0.5">{s.name}</div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                    <Link to={`/dashboard/live-studio?studio=${encodeURIComponent(s.id)}`} className="font-semibold text-[#6366F1]">
                      Use Studio
                    </Link>
                    <button type="button" onClick={() => handleDelete(s.id)} className="text-red-400 inline-flex items-center gap-1">
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

export function ExportsPage() {
  const [exportsList, setExportsList] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ exports: ExportRecord[] }>('/api/exports')
      .then((d) => setExportsList(d.exports))
      .finally(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout title="Exports">
      <div className="max-w-5xl mx-auto">
        {loading ? (
          <div className="h-40 rounded-xl bg-slate-200 dark:bg-[#111827] animate-pulse" />
        ) : exportsList.length === 0 ? (
          <div className="p-12 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-center space-y-3">
            <Download className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="font-display text-base font-semibold">No exports authorized yet</div>
            <p className="text-xs text-slate-500">Completed exports from Live AI Studio or Video Transformation appear here.</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="py-3 px-4">Production</th>
                  <th className="py-3 px-4">Resolution</th>
                  <th className="py-3 px-4">Ratio</th>
                  <th className="py-3 px-4">Watermark</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {exportsList.map((e) => (
                  <tr key={e.id}>
                    <td className="py-3 px-4 font-medium">{e.title}</td>
                    <td className="py-3 px-4 font-mono">{e.resolution}</td>
                    <td className="py-3 px-4 font-mono">{e.aspectRatio}</td>
                    <td className="py-3 px-4">{e.watermarked ? 'Yes' : 'None'}</td>
                    <td className="py-3 px-4 capitalize">{e.status}</td>
                    <td className="py-3 px-4 font-mono">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

interface SubscriptionCouponQuote {
  code: string;
  discountUsd: number;
  finalAmountUsd: number;
  originalAmountUsd: number;
}

export function SubscriptionPage() {
  const { plan, subscription, refreshAuth } = useAuth();
  const [params] = useSearchParams();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [currencyInfo, setCurrencyInfo] = useState<{
    settlementCurrency: string;
    usdToGhsRate: number | null;
    paystackConfigured: boolean;
    paystackMode: string;
  } | null>(null);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);

  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponQuotes, setCouponQuotes] = useState<Partial<Record<PlanId, SubscriptionCouponQuote>>>({});
  const [couponError, setCouponError] = useState<string | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  useEffect(() => {
    apiRequest<{ plans: PlanRecord[]; currencyInfo: typeof currencyInfo }>('/api/plans').then((d) => {
      setPlans(d.plans);
      setCurrencyInfo(d.currencyInfo);
    });

    const ref = params.get('reference');
    if (ref) {
      apiRequest<{ status: string }>(`/api/payments/verify/${encodeURIComponent(ref)}`)
        .then(async (res) => {
          if (res.status === 'success') {
            await refreshAuth();
            setMessage({ type: 'success', msg: `Payment verified (${ref}). Subscription activated.` });
          } else {
            setMessage({ type: 'error', msg: `Payment status: ${res.status}` });
          }
        })
        .catch((err) => setMessage({ type: 'error', msg: err instanceof Error ? err.message : 'Verification failed.' }));
    }
  }, [params, refreshAuth]);

  const validateCouponAcrossPlans = useCallback(async (rawCode: string, targetCycle: BillingCycle) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    setCouponError(null);
    setValidatingCoupon(true);
    try {
      const paidIds: PlanId[] = ['creator', 'pro_studio', 'business'];
      const results = await Promise.allSettled(
        paidIds.map((pid) =>
          apiRequest<SubscriptionCouponQuote>('/api/coupons/validate', {
            method: 'POST',
            body: JSON.stringify({ code, planId: pid, billingCycle: targetCycle }),
          }).then((quote) => ({ pid, quote }))
        )
      );

      const quotes: Partial<Record<PlanId, SubscriptionCouponQuote>> = {};
      let firstError = '';
      for (const r of results) {
        if (r.status === 'fulfilled') {
          quotes[r.value.pid] = r.value.quote;
        } else if (!firstError) {
          firstError = r.reason instanceof Error ? r.reason.message : 'Coupon is invalid.';
        }
      }

      if (Object.keys(quotes).length === 0) {
        setAppliedCoupon(null);
        setCouponQuotes({});
        setCouponError(firstError || `Coupon "${code}" is invalid or expired.`);
      } else {
        setAppliedCoupon(code);
        setCouponQuotes(quotes);
      }
    } finally {
      setValidatingCoupon(false);
    }
  }, []);

  useEffect(() => {
    if (appliedCoupon) {
      void validateCouponAcrossPlans(appliedCoupon, cycle);
    }
  }, [cycle, appliedCoupon, validateCouponAcrossPlans]);

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    await validateCouponAcrossPlans(couponInput, cycle);
  };

  const handleClearCoupon = () => {
    setCouponInput('');
    setAppliedCoupon(null);
    setCouponQuotes({});
    setCouponError(null);
  };

  const handleSubscribe = async (planId: PlanId) => {
    setMessage(null);
    setLoadingPlan(planId);
    try {
      const quote = couponQuotes[planId];
      const res = await apiRequest<{
        authorizationUrl?: string;
        freeCouponActivated?: boolean;
        couponCode?: string;
      }>('/api/payments/initialize', {
        method: 'POST',
        body: JSON.stringify({
          planId,
          billingCycle: cycle,
          couponCode: quote ? appliedCoupon : undefined,
        }),
      });
      if (res.freeCouponActivated) {
        await refreshAuth();
        setMessage({
          type: 'success',
          msg: `100% discount coupon "${res.couponCode}" redeemed! Your subscription is now active.`,
        });
        return;
      }
      if (res.authorizationUrl) {
        window.location.href = res.authorizationUrl;
      }
    } catch (err) {
      setMessage({ type: 'error', msg: err instanceof Error ? err.message : 'Unable to initialize payment.' });
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleCancel = async () => {
    setMessage(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/billing/cancel', { method: 'POST' });
      await refreshAuth();
      setMessage({ type: 'success', msg: res.message });
    } catch (err) {
      setMessage({ type: 'error', msg: err instanceof Error ? err.message : 'Cancellation failed.' });
    }
  };

  return (
    <DashboardLayout title="Subscription">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-display text-lg font-bold">
              <CreditCard className="w-5 h-5 text-[#6366F1]" />
              <span>Active Plan: {plan?.name || 'Free'}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
              Status: {subscription?.status || 'active'}
              {subscription && subscription.planId !== 'free'
                ? ` · Period ends ${new Date(subscription.currentPeriodEnd).toLocaleDateString()} (Manual renewal)`
                : ''}
            </p>
          </div>
          {subscription && subscription.planId !== 'free' && subscription.status === 'active' && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 rounded-lg border border-red-500/40 text-red-400 text-xs font-semibold"
            >
              Cancel Subscription
            </button>
          )}
        </div>

        {message && (
          <div
            className={`p-4 rounded-xl text-xs flex items-center gap-2 ${
              message.type === 'error'
                ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            }`}
          >
            {message.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{message.msg}</span>
          </div>
        )}

        <form
          onSubmit={handleApplyCoupon}
          className="p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2 font-medium">
            <Percent className="w-4 h-4 text-[#06B6D4] shrink-0" />
            <span>Promo / Discount Coupon Code</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 flex-1 sm:max-w-md justify-end">
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              placeholder="Enter coupon code"
              className="flex-1 min-w-[150px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 font-mono uppercase"
            />
            <button
              type="submit"
              disabled={validatingCoupon || !couponInput.trim()}
              className="px-3.5 py-1.5 rounded-lg bg-[#6366F1] text-white font-semibold disabled:opacity-50"
            >
              {validatingCoupon ? 'Checking...' : 'Apply'}
            </button>
            {appliedCoupon && (
              <button
                type="button"
                onClick={handleClearCoupon}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-500"
              >
                <X className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </form>

        {couponError && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            {couponError}
          </div>
        )}

        {appliedCoupon && Object.keys(couponQuotes).length > 0 && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
            Coupon <strong className="font-mono">{appliedCoupon}</strong> active — discounted totals are shown below.
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-xs text-slate-500 dark:text-[#94A3B8]">
            Paystack Mode: <strong>{currencyInfo?.paystackMode || 'test'}</strong> · Settlement:{' '}
            <strong>{currencyInfo?.settlementCurrency || 'GHS'}</strong>
            {currencyInfo?.settlementCurrency === 'GHS' && currencyInfo.usdToGhsRate
              ? ` (1 USD = ${currencyInfo.usdToGhsRate} GHS)`
              : ''}
          </div>
          <div className="inline-flex p-1 rounded-lg bg-slate-200 dark:bg-[#111827] text-xs">
            <button
              type="button"
              onClick={() => setCycle('monthly')}
              className={`px-3 py-1.5 rounded font-semibold ${cycle === 'monthly' ? 'bg-white dark:bg-[#172033]' : ''}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle('annual')}
              className={`px-3 py-1.5 rounded font-semibold ${cycle === 'annual' ? 'bg-white dark:bg-[#172033]' : ''}`}
            >
              Annual (2 months free)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {plans.map((p) => {
            const baseUsd = cycle === 'annual' ? p.annualPriceUsd : p.monthlyPriceUsd;
            const quote = couponQuotes[p.id];
            const finalUsd = quote ? quote.finalAmountUsd : baseUsd;
            const isCurrent = plan?.id === p.id;
            return (
              <div key={p.id} className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="font-display text-lg font-bold">{p.name}</div>
                  <div className="font-mono text-2xl font-bold flex items-baseline gap-2">
                    {quote && <span className="text-sm text-slate-400 line-through">${baseUsd}</span>}
                    <span>
                      ${finalUsd}
                      <span className="text-xs font-normal text-slate-500">/{cycle === 'annual' ? 'yr' : 'mo'}</span>
                    </span>
                  </div>
                  {quote && (
                    <div className="text-xs font-semibold text-emerald-400">
                      Save ${quote.discountUsd.toFixed(2)} ({quote.code})
                    </div>
                  )}
                  {finalUsd > 0 && currencyInfo?.settlementCurrency === 'GHS' && currencyInfo.usdToGhsRate && (
                    <div className="text-xs font-mono text-[#06B6D4]">
                      GH₵ {(finalUsd * currencyInfo.usdToGhsRate).toFixed(2)} GHS
                    </div>
                  )}
                  <ul className="text-xs text-slate-500 dark:text-[#94A3B8] space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <li>{p.limits.maxExportsPerMonth} exports/month ({p.limits.maxExportResolution})</li>
                    <li>{p.limits.maxSavedStudios} saved studios</li>
                    <li>{p.limits.maxRecordingMinutes} min/session</li>
                    <li>{p.limits.watermarkRequired ? 'Watermark included' : 'No watermark'}</li>
                  </ul>
                </div>

                {p.id !== 'free' && (
                  <button
                    type="button"
                    disabled={loadingPlan === p.id}
                    onClick={() => handleSubscribe(p.id)}
                    className="w-full py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold hover:bg-[#5558E6] disabled:opacity-50"
                  >
                    {loadingPlan === p.id
                      ? 'Activating...'
                      : quote && finalUsd === 0
                      ? `Activate ${p.name} Free`
                      : isCurrent
                      ? 'Renew Manually'
                      : `Upgrade to ${p.name}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}

export function BillingHistoryPage() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ payments: PaymentRecord[] }>('/api/billing/summary')
      .then((d) => setPayments(d.payments))
      .finally(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout title="Billing History">
      <div className="max-w-5xl mx-auto">
        {loading ? (
          <div className="h-40 rounded-xl bg-slate-200 dark:bg-[#111827] animate-pulse" />
        ) : payments.length === 0 ? (
          <div className="p-12 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-center space-y-3">
            <Receipt className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="font-display text-base font-semibold">No billing transactions yet</div>
            <p className="text-xs text-slate-500">Paystack transaction receipts and verification records will appear here.</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4">Plan</th>
                  <th className="py-3 px-4">USD</th>
                  <th className="py-3 px-4">Settled</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3 px-4 font-mono">{p.reference}</td>
                    <td className="py-3 px-4 capitalize">{p.planId.replace('_', ' ')} ({p.billingCycle})</td>
                    <td className="py-3 px-4 font-mono">${p.amountUsd}</td>
                    <td className="py-3 px-4 font-mono">{(p.amountMinor / 100).toFixed(2)} {p.currency}</td>
                    <td className="py-3 px-4 capitalize">{p.status}</td>
                    <td className="py-3 px-4 font-mono">{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

export function AccountSettingsPage() {
  const { user, refreshAuth, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await apiRequest('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ name }) });
      await refreshAuth();
      setMsg({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setMsg({ type: 'success', text: 'Password updated.' });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Password change failed.' });
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await apiRequest('/api/auth/account', {
        method: 'DELETE',
        body: JSON.stringify({ confirmEmail }),
      });
      await logout();
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Account deletion failed.' });
    }
  };

  return (
    <DashboardLayout title="Account Settings">
      <div className="max-w-3xl mx-auto space-y-6">
        {msg && (
          <div
            className={`p-3.5 rounded-xl text-xs ${
              msg.type === 'error'
                ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            }`}
          >
            {msg.text}
          </div>
        )}

        <form onSubmit={handleProfileSave} className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="font-display text-base font-semibold flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#6366F1]" />
            <span>Profile Information</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-medium mb-1">Full Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Email</label>
              <input
                disabled
                value={user?.email || ''}
                className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-[#080B14] border border-slate-300 dark:border-slate-800 opacity-70"
              />
            </div>
          </div>
          <button type="submit" className="px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold">
            Save Profile
          </button>
        </form>

        <form onSubmit={handlePasswordChange} className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-4 text-xs">
          <div className="font-display text-base font-semibold">Change Password</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              required
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            />
            <input
              required
              minLength={8}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            />
          </div>
          <button type="submit" className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold">
            Update Password
          </button>
        </form>

        <form onSubmit={handleDeleteAccount} className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-red-500/30 space-y-3 text-xs">
          <div className="font-display text-base font-semibold text-red-400">Delete Account &amp; Data</div>
          <p className="text-slate-500 dark:text-[#94A3B8]">
            Permanently deletes your account, sessions, saved studios, projects, and export logs. Type{' '}
            <span className="font-mono text-slate-900 dark:text-white">{user?.email}</span> to confirm.
          </p>
          <div className="flex flex-wrap gap-3">
            <input
              required
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={user?.email}
              className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-red-500/30"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold">
              Permanently Delete Account
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}

export function DashboardSupportPage() {
  const { plan } = useAuth();
  const [tickets, setTickets] = useState<SupportRequest[]>([]);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('Technical Support');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const load = () => {
    apiRequest<{ tickets: SupportRequest[] }>('/api/support/mine').then((d) => setTickets(d.tickets));
  };
  useEffect(load, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    await apiRequest('/api/support', {
      method: 'POST',
      body: JSON.stringify({ subject, category, message }),
    });
    setSubject('');
    setMessage('');
    setStatus('Support ticket submitted.');
    load();
  };

  return (
    <DashboardLayout title="Help & Support">
      <div className="max-w-4xl mx-auto space-y-6">
        <form onSubmit={handleSubmit} className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">Submit Support Ticket</h2>
            <span className="text-slate-500">
              Queue Tier: {plan?.limits.prioritySupport ? 'Priority Support' : 'Standard Support'}
            </span>
          </div>
          {status && <div className="p-2.5 rounded bg-emerald-500/10 text-emerald-400">{status}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ticket subject"
              className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            >
              <option>Technical Support</option>
              <option>OBS &amp; Live Streaming</option>
              <option>Billing &amp; Paystack</option>
              <option>Feature Request</option>
            </select>
          </div>
          <textarea
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe the issue..."
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
          />
          <button type="submit" className="px-4 py-2 rounded-lg bg-[#6366F1] text-white font-semibold">
            Submit Ticket
          </button>
        </form>

        <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3">
          <h3 className="font-display text-sm font-semibold">Your Tickets</h3>
          {tickets.length === 0 ? (
            <p className="text-xs text-slate-500">No support tickets submitted yet.</p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {tickets.map((t) => (
                <div key={t.id} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">{t.subject}</div>
                    <div className="text-slate-500">{t.category} · {t.priority}</div>
                  </div>
                  <span className="capitalize font-mono">{t.status.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
