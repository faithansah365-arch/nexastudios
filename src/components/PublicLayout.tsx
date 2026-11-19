import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from './BrandLogo';

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { user, theme, toggleTheme } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const navLinks = [
    { to: '/features', label: 'Features' },
    { to: '/virtual-studios', label: 'Virtual Studios' },
    { to: '/how-it-works', label: 'How It Works' },
    { to: '/pricing', label: 'Pricing' },
    { to: '/use-cases', label: 'Use Cases' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#080B14] dark:text-[#F8FAFC]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-[#080B14]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="inline-flex items-center whitespace-nowrap shrink-0"
          >
            <BrandLogo />
          </Link>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-[#94A3B8]">
            {navLinks.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 dark:hover:text-white ${
                    isActive ? 'text-[#6366F1] dark:text-white underline underline-offset-8 decoration-[#6366F1]' : ''
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
              title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-[#6366F1]" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigate(user ? '/dashboard' : '/signup')}
              className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-sm font-semibold rounded-lg bg-[#6366F1] text-white hover:bg-[#5558E6] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6366F1]"
            >
              {user ? 'Open Dashboard' : 'Start Free Studio'}
            </button>

            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-4 py-4 space-y-2">
            {navLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className="block py-2.5 px-3 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {item.label}
              </Link>
            ))}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
              {user ? (
                <Link
                  to="/dashboard"
                  onClick={() => setMobileOpen(false)}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#6366F1] text-white text-center text-sm font-semibold"
                >
                  Open Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    to="/signin"
                    onClick={() => setMobileOpen(false)}
                    className="w-full py-2.5 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-center text-sm font-medium"
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/signup"
                    onClick={() => setMobileOpen(false)}
                    className="w-full py-2.5 px-4 rounded-lg bg-[#6366F1] text-white text-center text-sm font-semibold"
                  >
                    Start Free Studio
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#080B14] mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-3">
            <Link to="/" className="inline-flex items-center">
              <BrandLogo size="sm" />
            </Link>
            <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">
              Your Studio. Anywhere. Built by NexaStudios for creators, churches, educators, and media teams.
            </p>
          </div>

          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Platform</div>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-[#94A3B8]">
              <li><Link to="/features" className="hover:text-slate-900 dark:hover:text-white">Features</Link></li>
              <li><Link to="/virtual-studios" className="hover:text-slate-900 dark:hover:text-white">Virtual Studios</Link></li>
              <li><Link to="/how-it-works" className="hover:text-slate-900 dark:hover:text-white">How It Works</Link></li>
              <li><Link to="/pricing" className="hover:text-slate-900 dark:hover:text-white">Pricing</Link></li>
              <li><Link to="/use-cases" className="hover:text-slate-900 dark:hover:text-white">Use Cases</Link></li>
            </ul>
          </div>

          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Company &amp; Support</div>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-[#94A3B8]">
              <li><Link to="/about" className="hover:text-slate-900 dark:hover:text-white">About NexaStudios</Link></li>
              <li><Link to="/help" className="hover:text-slate-900 dark:hover:text-white">Help Center</Link></li>
              <li><Link to="/contact" className="hover:text-slate-900 dark:hover:text-white">Contact Support</Link></li>
              <li><Link to="/signin" className="hover:text-slate-900 dark:hover:text-white">Sign In</Link></li>
              <li><Link to="/signup" className="hover:text-slate-900 dark:hover:text-white">Create Account</Link></li>
            </ul>
          </div>

          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Legal</div>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-[#94A3B8]">
              <li><Link to="/legal/privacy" className="hover:text-slate-900 dark:hover:text-white">Privacy Policy</Link></li>
              <li><Link to="/legal/terms" className="hover:text-slate-900 dark:hover:text-white">Terms of Service</Link></li>
              <li><Link to="/legal/refund" className="hover:text-slate-900 dark:hover:text-white">Refund Policy</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800/80 py-5 px-4 sm:px-6 max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>© {new Date().getFullYear()} NexaStudios. All rights reserved.</span>
          <span>Browser-first local video processing · Primary currency USD</span>
        </div>
      </footer>
    </div>
  );
}
