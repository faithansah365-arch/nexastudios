import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';

function isAllowedOAuthOrigin(origin: string): boolean {
  if (!origin) return false;
  if (typeof window !== 'undefined' && origin === window.location.origin) return true;
  return (
    origin.endsWith('.run.app') ||
    origin.endsWith('.vercel.app') ||
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1')
  );
}

function GoogleSignInButton({
  label,
  onError,
  onComplete,
}: {
  label: string;
  onError: (msg: string) => void;
  onComplete: (role?: string) => void;
}) {
  const { refreshAuth } = useAuth();
  const [loading, setLoading] = useState(false);

  const completeWithExchangeCode = useCallback(
    async (exchangeCode: string) => {
      setLoading(true);
      try {
        const res = await apiRequest<{ user?: { role: string } }>('/api/auth/google/complete', {
          method: 'POST',
          body: JSON.stringify({ exchangeCode }),
        });
        await refreshAuth();
        onComplete(res.user?.role);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Unable to complete Google sign-in.');
      } finally {
        setLoading(false);
      }
    },
    [onComplete, onError, refreshAuth]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isAllowedOAuthOrigin(event.origin)) return;
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS' && typeof event.data.exchangeCode === 'string') {
        void completeWithExchangeCode(event.data.exchangeCode);
      } else if (event.data?.type === 'GOOGLE_AUTH_ERROR') {
        setLoading(false);
        onError(typeof event.data.error === 'string' ? event.data.error : 'Google sign-in failed.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [completeWithExchangeCode, onError]);

  const handleClick = async () => {
    onError('');
    setLoading(true);
    try {
      const originParam = encodeURIComponent(window.location.origin);
      const { url } = await apiRequest<{ url: string }>(`/api/auth/google/url?origin=${originParam}`);
      const popup = window.open(url, 'nexastudios_google_oauth', 'width=520,height=640');
      if (!popup) {
        setLoading(false);
        onError('Popup was blocked by your browser. Please allow popups for this site and try again.');
      }
    } catch (err) {
      setLoading(false);
      onError(err instanceof Error ? err.message : 'Unable to start Google sign-in.');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="w-full py-2.5 px-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#080B14] hover:bg-slate-50 dark:hover:bg-slate-800/80 text-slate-800 dark:text-slate-100 text-sm font-medium flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60"
    >
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.37 24 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
        />
      </svg>
      <span>{loading ? 'Connecting to Google...' : label}</span>
    </button>
  );
}

export function SignInPage() {
  const { refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiRequest<{ needsSetup?: boolean }>('/api/admin/bootstrap-status')
      .then((d) => setNeedsAdminSetup(Boolean(d.needsSetup)))
      .catch(() => setNeedsAdminSetup(false));
  }, []);

  const navigateAfterAuth = useCallback(
    (role?: string) => {
      const rawNext = searchParams.get('next');
      const safeNext = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;
      if (safeNext) {
        navigate(safeNext);
      } else {
        navigate(role === 'admin' ? '/admin' : '/dashboard');
      }
    },
    [navigate, searchParams]
  );

  // Handle top-level Google redirect fallback when popup opener wasn't available
  useEffect(() => {
    const googleErr = searchParams.get('google_error');
    const googleCode = searchParams.get('google_code');
    if (googleErr) {
      setError(googleErr);
      return;
    }
    if (googleCode) {
      setSubmitting(true);
      apiRequest<{ user?: { role: string } }>('/api/auth/google/complete', {
        method: 'POST',
        body: JSON.stringify({ exchangeCode: googleCode }),
      })
        .then(async (res) => {
          await refreshAuth();
          navigateAfterAuth(res.user?.role);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Unable to complete Google sign-in.');
        })
        .finally(() => setSubmitting(false));
    }
  }, [navigateAfterAuth, refreshAuth, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ mfaRequired?: boolean; user?: { role: string } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, totpCode: mfaRequired ? totpCode : undefined }),
      });
      if (res.mfaRequired) {
        setMfaRequired(true);
        setSubmitting(false);
        return;
      }
      await refreshAuth();
      const rawNext = searchParams.get('next');
      const safeNext = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;
      if (safeNext) {
        navigate(safeNext);
      } else {
        navigate(res.user?.role === 'admin' ? '/admin' : '/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="p-7 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">Sign in to NexaStudios</h1>
            <p className="text-sm text-slate-600 dark:text-[#94A3B8] mt-1">
              Access your virtual studios, recordings, and subscription entitlements.
            </p>
          </div>

          {needsAdminSetup && (
            <div className="p-3.5 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 space-y-2 text-xs text-slate-700 dark:text-slate-200">
              <div className="flex items-center gap-2 font-semibold text-[#06B6D4]">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Initial Administrator Setup Required</span>
              </div>
              <p className="text-slate-600 dark:text-[#94A3B8] leading-relaxed">
                No administrator account has been created on this workspace yet. Create the first administrator account before signing in as admin.
              </p>
              <Link to="/admin" className="inline-block font-semibold text-[#06B6D4] hover:underline">
                Provision Administrator Account →
              </Link>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email Address</label>
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Password</label>
                <Link to="/forgot-password" className="text-xs text-[#6366F1] hover:underline">
                  Forgot password?
                </Link>
              </div>
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
              />
            </div>

            {mfaRequired && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  6-Digit Authenticator Code
                </label>
                <input
                  required
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm font-mono tracking-widest"
                  placeholder="000000"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-[#6366F1] text-white text-sm font-semibold hover:bg-[#5558E6] disabled:opacity-60"
            >
              {submitting ? 'Signing in...' : mfaRequired ? 'Verify Code & Sign In' : 'Sign In'}
            </button>
          </form>

          <div className="relative flex items-center py-0.5">
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            <span className="px-3 text-xs text-slate-500 dark:text-[#94A3B8]">or</span>
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
          </div>

          <GoogleSignInButton
            label="Continue with Google"
            onError={(msg) => setError(msg || null)}
            onComplete={(role) => navigateAfterAuth(role)}
          />

          <p className="text-xs text-center text-slate-600 dark:text-[#94A3B8]">
            New to NexaStudios?{' '}
            <Link to="/signup" className="text-[#6366F1] font-semibold hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}

export function SignUpPage() {
  const { refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [verifying, setVerifying] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ verificationToken?: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      await refreshAuth();
      if (res.verificationToken) {
        setVerificationToken(res.verificationToken);
        setManualToken(res.verificationToken);
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      await apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: manualToken }),
      });
      await refreshAuth();
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="p-7 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-6">
          {verificationToken ? (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="flex items-center gap-2 text-[#06B6D4]">
                <MailCheck className="w-5 h-5" />
                <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">Verify Your Email</h1>
              </div>
              <p className="text-xs text-slate-600 dark:text-[#94A3B8] leading-relaxed">
                Email verification is required before exporting productions. Because this deployment runs in zero-budget
                local mode without an external SMTP relay, confirm your generated verification token below:
              </p>
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Verification Token
                </label>
                <input
                  required
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-xs font-mono"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={verifying}
                  className="flex-1 py-2.5 px-4 rounded-lg bg-[#10B981] text-white text-sm font-semibold hover:bg-emerald-600"
                >
                  {verifying ? 'Verifying...' : 'Verify Email & Continue'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  className="py-2.5 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
                >
                  Skip for now
                </button>
              </div>
            </form>
          ) : (
            <>
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                  Create Your Studio Account
                </h1>
                <p className="text-sm text-slate-600 dark:text-[#94A3B8] mt-1">
                  Start on the Free plan with 2 active virtual studios and local browser processing.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-sm text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Full Name</label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                    placeholder="Ama Boateng"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email Address</label>
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                    placeholder="creator@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Password (minimum 8 characters)
                  </label>
                  <input
                    required
                    minLength={8}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#6366F1] text-white text-sm font-semibold hover:bg-[#5558E6] disabled:opacity-60"
                >
                  {submitting ? 'Creating Account...' : 'Create Free Account'}
                </button>
              </form>

              <div className="relative flex items-center py-0.5">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="px-3 text-xs text-slate-500 dark:text-[#94A3B8]">or</span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

              <GoogleSignInButton
                label="Continue with Google"
                onError={(msg) => setError(msg || null)}
                onComplete={(role) => navigate(role === 'admin' ? '/admin' : '/dashboard')}
              />

              <p className="text-xs text-center text-slate-600 dark:text-[#94A3B8]">
                Already have an account?{' '}
                <Link to="/signin" className="text-[#6366F1] font-semibold hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSentMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process request.');
    }
  };

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="p-7 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#6366F1]" />
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">Reset Password</h1>
          </div>
          {sentMessage ? (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400">
                {sentMessage}
              </div>
              <Link to="/reset-password" className="block text-center text-sm font-semibold text-[#6366F1] hover:underline">
                Have a reset token? Enter it here
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="p-3 rounded-lg bg-red-500/10 text-sm text-red-400">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Account Email</label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                />
              </div>
              <button type="submit" className="w-full py-2.5 px-4 rounded-lg bg-[#6366F1] text-white text-sm font-semibold">
                Request Password Reset
              </button>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') || '');
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.');
    }
  };

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="p-7 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-5">
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">Set New Password</h1>
          {done ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-500 text-sm font-medium">
                <CheckCircle2 className="w-5 h-5" />
                <span>Password updated successfully.</span>
              </div>
              <Link to="/signin" className="block w-full py-2.5 text-center rounded-lg bg-[#6366F1] text-white text-sm font-semibold">
                Proceed to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="p-3 rounded-lg bg-red-500/10 text-sm text-red-400">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Reset Token</label>
                <input
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">New Password</label>
                <input
                  required
                  minLength={8}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                />
              </div>
              <button type="submit" className="w-full py-2.5 px-4 rounded-lg bg-[#6366F1] text-white text-sm font-semibold">
                Update Password
              </button>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
