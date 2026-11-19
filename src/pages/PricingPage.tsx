import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Check, CheckCircle2, Info, Percent, X } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import type { BillingCycle, PlanId, PlanRecord } from '../../shared/types';

interface CurrencyInfo {
  primaryCurrency: string;
  settlementCurrency: 'GHS' | 'USD';
  usdToGhsRate: number | null;
  exchangeRateSource: string;
  exchangeRateUpdatedAt: string | null;
  paystackConfigured: boolean;
  paystackMode: 'test' | 'live';
}

interface CouponQuote {
  code: string;
  description: string;
  discountType: 'percent' | 'fixed_usd';
  discountValue: number;
  originalAmountUsd: number;
  discountUsd: number;
  finalAmountUsd: number;
}

export function PricingPage() {
  const { user, plan: currentPlan, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [currencyInfo, setCurrencyInfo] = useState<CurrencyInfo | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<PlanId | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState<string | null>(null);

  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponQuotes, setCouponQuotes] = useState<Partial<Record<PlanId, CouponQuote>>>({});
  const [couponError, setCouponError] = useState<string | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  useEffect(() => {
    apiRequest<{ plans: PlanRecord[]; currencyInfo: CurrencyInfo }>('/api/plans')
      .then((d) => {
        setPlans(d.plans);
        setCurrencyInfo(d.currencyInfo);
      })
      .finally(() => setLoading(false));
  }, []);

  const validateCouponAcrossPlans = useCallback(async (rawCode: string, targetCycle: BillingCycle) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    setCouponError(null);
    setValidatingCoupon(true);
    try {
      const paidIds: PlanId[] = ['creator', 'pro_studio', 'business'];
      const results = await Promise.allSettled(
        paidIds.map((pid) =>
          apiRequest<CouponQuote>('/api/coupons/validate', {
            method: 'POST',
            body: JSON.stringify({ code, planId: pid, billingCycle: targetCycle }),
          }).then((quote) => ({ pid, quote }))
        )
      );

      const quotes: Partial<Record<PlanId, CouponQuote>> = {};
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

  const handleCheckout = async (planId: PlanId) => {
    setCheckoutError(null);
    setCheckoutSuccess(null);
    if (!user) {
      navigate('/signup');
      return;
    }
    if (planId === 'free') {
      navigate('/dashboard');
      return;
    }
    setCheckoutLoading(planId);
    try {
      const quoteForPlan = couponQuotes[planId];
      const res = await apiRequest<{
        authorizationUrl?: string;
        freeCouponActivated?: boolean;
        couponCode?: string;
      }>('/api/payments/initialize', {
        method: 'POST',
        body: JSON.stringify({
          planId,
          billingCycle: cycle,
          couponCode: quoteForPlan ? appliedCoupon : undefined,
        }),
      });
      if (res.freeCouponActivated) {
        await refreshAuth();
        setCheckoutSuccess(`100% discount coupon "${res.couponCode}" redeemed! Your subscription is now active.`);
        return;
      }
      if (res.authorizationUrl) {
        window.location.href = res.authorizationUrl;
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to start Paystack checkout.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const formatConverted = (usd: number) => {
    if (!currencyInfo || usd === 0) return null;
    if (currencyInfo.settlementCurrency === 'USD') return `$${usd} USD`;
    if (!currencyInfo.usdToGhsRate) return 'GHS rate pending admin setup';
    return `GH₵ ${(usd * currencyInfo.usdToGhsRate).toFixed(2)} GHS`;
  };

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div className="max-w-2xl">
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
              Subscription Plans &amp; Limits
            </h1>
            <p className="mt-2 text-slate-600 dark:text-[#94A3B8]">
              Priced in USD for global creators. Annual billing provides two months free compared to monthly billing.
            </p>
          </div>

          <div className="inline-flex items-center p-1 rounded-lg bg-slate-200 dark:bg-[#111827] border border-slate-300 dark:border-slate-800 self-start">
            <button
              type="button"
              onClick={() => setCycle('monthly')}
              className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                cycle === 'monthly'
                  ? 'bg-white dark:bg-[#172033] text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-[#94A3B8]'
              }`}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              onClick={() => setCycle('annual')}
              className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                cycle === 'annual'
                  ? 'bg-white dark:bg-[#172033] text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-[#94A3B8]'
              }`}
            >
              Annual Billing (2 months free)
            </button>
          </div>
        </div>

        {/* Promo / Discount Coupon Input */}
        <form
          onSubmit={handleApplyCoupon}
          className="mb-6 p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-medium">
            <Percent className="w-4 h-4 text-[#06B6D4] shrink-0" />
            <span>Have a discount coupon code?</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 flex-1 sm:max-w-md justify-end">
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              placeholder="Enter coupon code"
              className="flex-1 min-w-[160px] px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 font-mono uppercase"
            />
            <button
              type="submit"
              disabled={validatingCoupon || !couponInput.trim()}
              className="px-4 py-2 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E6] disabled:opacity-50"
            >
              {validatingCoupon ? 'Checking...' : 'Apply'}
            </button>
            {appliedCoupon && (
              <button
                type="button"
                onClick={handleClearCoupon}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-500 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>
        </form>

        {couponError && (
          <div className="mb-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-xs text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{couponError}</span>
          </div>
        )}

        {appliedCoupon && Object.keys(couponQuotes).length > 0 && (
          <div className="mb-6 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              Coupon <strong className="font-mono">{appliedCoupon}</strong> applied! Discounted totals are shown on eligible plans below.
            </span>
          </div>
        )}

        {currencyInfo && (
          <div className="mb-8 p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600 dark:text-[#94A3B8]">
            <div className="flex items-start sm:items-center gap-2">
              <Info className="w-4 h-4 text-[#06B6D4] shrink-0 mt-0.5 sm:mt-0" />
              <span>
                Paystack Merchant Settlement: <strong>{currencyInfo.settlementCurrency}</strong> (
                {currencyInfo.paystackMode === 'test' ? 'Test Mode' : 'Live Mode'})
                {currencyInfo.settlementCurrency === 'GHS' && currencyInfo.usdToGhsRate
                  ? ` · Configured rate: 1 USD = ${currencyInfo.usdToGhsRate} GHS (${currencyInfo.exchangeRateSource})`
                  : currencyInfo.settlementCurrency === 'GHS'
                  ? ' · Exchange rate not yet configured in Admin Settings'
                  : ''}
              </span>
            </div>
            {!currencyInfo.paystackConfigured && (
              <span className="text-amber-500 font-medium whitespace-nowrap">
                Paystack API keys required for paid checkout
              </span>
            )}
          </div>
        )}

        {checkoutSuccess && (
          <div className="mb-8 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3 text-sm text-emerald-400">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{checkoutSuccess}</span>
            </div>
            <Link to="/dashboard" className="px-4 py-1.5 rounded-lg bg-[#10B981] text-white text-xs font-semibold shrink-0">
              Open Studio Dashboard
            </Link>
          </div>
        )}

        {checkoutError && (
          <div className="mb-8 p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-sm text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{checkoutError}</span>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-96 rounded-xl bg-slate-200 dark:bg-[#111827] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((p) => {
              const baseUsd = cycle === 'annual' ? p.annualPriceUsd : p.monthlyPriceUsd;
              const quote = couponQuotes[p.id];
              const finalUsd = quote ? quote.finalAmountUsd : baseUsd;
              const converted = formatConverted(finalUsd);
              const isCurrent = currentPlan?.id === p.id;
              return (
                <div
                  key={p.id}
                  className={`p-6 rounded-xl bg-white dark:bg-[#111827] border flex flex-col justify-between ${
                    p.id === 'pro_studio'
                      ? 'border-[#6366F1]'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="space-y-4">
                    <div>
                      <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">{p.name}</h2>
                      <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-1">{p.tagline}</p>
                    </div>

                    <div>
                      <div className="font-mono tabular-nums text-3xl font-bold text-slate-900 dark:text-white flex items-baseline gap-2">
                        {quote && (
                          <span className="text-lg text-slate-400 line-through">${baseUsd}</span>
                        )}
                        <span>
                          ${finalUsd}
                          <span className="text-sm font-normal text-slate-500 dark:text-[#94A3B8]">
                            /{cycle === 'annual' ? 'yr' : 'mo'}
                          </span>
                        </span>
                      </div>
                      {quote && (
                        <div className="text-xs text-emerald-400 font-semibold mt-0.5">
                          Save ${quote.discountUsd.toFixed(2)} with {quote.code}
                        </div>
                      )}
                      {converted && (
                        <div className="text-xs font-mono tabular-nums text-[#06B6D4] mt-1">
                          Checkout total: {converted}
                        </div>
                      )}
                    </div>

                    <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 pt-3 border-t border-slate-200 dark:border-slate-800">
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                        <span>
                          {p.limits.maxTemplates === -1 ? 'All available' : p.limits.maxTemplates} studio templates
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                        <span>{p.limits.maxSavedStudios} saved custom studio(s)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                        <span>{p.limits.maxRecordingMinutes} min session limit</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                        <span>{p.limits.maxExportsPerMonth} exports/month ({p.limits.maxExportResolution})</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                        <span>{p.limits.maxUploadMb >= 1024 ? `${p.limits.maxUploadMb / 1024} GB` : `${p.limits.maxUploadMb} MB`} max upload</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                        <span>{p.limits.watermarkRequired ? 'NexaFlow watermark' : 'No watermark'}</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                        <span>{p.limits.obsWorkflow ? 'OBS streaming workflow' : 'Local preview only'}</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                        <span>{p.limits.teamMembers} team seat(s)</span>
                      </li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    disabled={isCurrent || checkoutLoading === p.id}
                    onClick={() => handleCheckout(p.id)}
                    className={`mt-6 w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 ${
                      isCurrent
                        ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-default'
                        : p.id === 'pro_studio'
                        ? 'bg-[#6366F1] text-white hover:bg-[#5558E6]'
                        : 'border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {isCurrent
                      ? 'Current Active Plan'
                      : checkoutLoading === p.id
                      ? 'Activating...'
                      : p.id === 'free'
                      ? 'Start Free'
                      : quote && finalUsd === 0
                      ? `Activate ${p.name} Free`
                      : `Subscribe to ${p.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
