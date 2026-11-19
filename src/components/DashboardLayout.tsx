import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  CreditCard,
  Download,
  Film,
  FolderKanban,
  HelpCircle,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Receipt,
  Settings,
  ShieldAlert,
  Sparkles,
  Sun,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';

export function DashboardLayout({ children, title }: { children: React.ReactNode; title: string }) {
  const { user, plan, theme, toggleTheme, logout, refreshAuth } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/dashboard/live-studio', label: 'Live AI Studio', icon: Video },
    { to: '/dashboard/video-transform', label: 'Video Transformation', icon: Film },
    { to: '/dashboard/studio-generator', label: 'AI Studio Generator', icon: Sparkles },
    { to: '/dashboard/studio-designer', label: 'Studio Designer', icon: Palette },
    { to: '/dashboard/live-broadcast', label: 'Live Broadcast', icon: Radio },
    { to: '/dashboard/projects', label: 'My Projects', icon: FolderKanban },
    { to: '/dashboard/studios', label: 'My Studios', icon: Layers },
    { to: '/dashboard/exports', label: 'Exports', icon: Download },
    { to: '/dashboard/subscription', label: 'Subscription', icon: CreditCard },
    { to: '/dashboard/billing', label: 'Billing History', icon: Receipt },
    { to: '/dashboard/settings', label: 'Account Settings', icon: Settings },
    { to: '/dashboard/support', label: 'Help & Support', icon: HelpCircle },
  ];

  const handleResendVerification = async () => {
    setVerifyMessage(null);
    try {
      const res = await apiRequest<{ verificationToken?: string }>('/api/auth/resend-verification', {
        method: 'POST',
      });
      if (res.verificationToken) {
        setIssuedToken(res.verificationToken);
        setVerifyTokenInput(res.verificationToken);
      }
    } catch (err) {
      setVerifyMessage(err instanceof Error ? err.message : 'Unable to issue token.');
    }
  };

  const handleConfirmVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyMessage(null);
    try {
      await apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verifyTokenInput }),
      });
      setIssuedToken(null);
      await refreshAuth();
    } catch (err) {
      setVerifyMessage(err instanceof Error ? err.message : 'Verification failed.');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/signin');
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 dark:bg-[#080B14] dark:text-[#F8FAFC]">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shrink-0 transition-all duration-150 ${
          collapsed ? 'w-[68px]' : 'w-[256px]'
        }`}
      >
        <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          {!collapsed && (
            <Link to="/" className="font-display text-sm font-bold tracking-tight truncate">
              NexaFlow AI Studio
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#6366F1] text-white'
                    : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#172033]'
                }`
              }
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="p-2 border-t border-slate-200 dark:border-slate-800 space-y-1">
          <button
            type="button"
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-[#94A3B8] hover:bg-slate-100 dark:hover:bg-[#172033]"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
            {!collapsed && <span>{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-[#94A3B8] hover:text-red-400 hover:bg-slate-100 dark:hover:bg-[#172033]"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] bg-white dark:bg-[#111827] h-full flex flex-col border-r border-slate-200 dark:border-slate-800">
            <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="font-display text-sm font-bold">NexaFlow AI Studio</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg text-slate-500"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      isActive
                        ? 'bg-[#6366F1] text-white'
                        : 'text-slate-600 dark:text-[#94A3B8] hover:bg-slate-100 dark:hover:bg-[#172033]'
                    }`
                  }
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-1">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-400"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#080B14]/80 backdrop-blur flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-medium text-slate-500 dark:text-[#94A3B8] truncate">
              <span className="hidden sm:inline">Creator Studio / </span>
              <span className="text-slate-900 dark:text-white font-semibold">{title}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs shrink-0">
            <span className="hidden sm:inline text-slate-500 dark:text-[#94A3B8]">
              {user?.name} · {plan?.name || 'Free'} Plan
            </span>
            {user?.role === 'admin' && (
              <Link
                to="/admin"
                className="px-3 py-1.5 rounded-lg border border-[#06B6D4]/40 text-[#06B6D4] font-semibold hover:bg-[#06B6D4]/10 whitespace-nowrap shrink-0"
              >
                Admin Console
              </Link>
            )}
            {location.pathname !== '/dashboard/live-studio' && (
              <Link
                to="/dashboard/live-studio"
                className="px-3.5 py-1.5 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E6] whitespace-nowrap shrink-0"
              >
                Launch Live Studio
              </Link>
            )}
          </div>
        </header>

        {user && !user.emailVerified && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-400">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                Your email is unverified. Verify your email address to authorize video exports.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!issuedToken ? (
                <button
                  type="button"
                  onClick={handleResendVerification}
                  className="px-3 py-1.5 rounded-md bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400"
                >
                  Generate Verification Token
                </button>
              ) : (
                <form onSubmit={handleConfirmVerification} className="flex items-center gap-2">
                  <input
                    value={verifyTokenInput}
                    onChange={(e) => setVerifyTokenInput(e.target.value)}
                    className="px-2.5 py-1 rounded bg-[#080B14] border border-amber-500/40 font-mono text-white w-48"
                    placeholder="Verification token"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-md bg-[#10B981] text-white font-semibold"
                  >
                    Verify Email
                  </button>
                </form>
              )}
              {verifyMessage && <span className="text-red-400">{verifyMessage}</span>}
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
