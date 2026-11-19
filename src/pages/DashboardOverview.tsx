import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Film, Layers, Radio, Sparkles, Video } from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import type { CustomStudio, ExportRecord, ProjectRecord } from '../../shared/types';

export function DashboardOverview() {
  const { user, plan, subscription, usage, savedStudiosCount } = useAuth();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [studios, setStudios] = useState<CustomStudio[]>([]);
  const [exportsList, setExportsList] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiRequest<{ projects: ProjectRecord[] }>('/api/projects'),
      apiRequest<{ studios: CustomStudio[] }>('/api/studios'),
      apiRequest<{ exports: ExportRecord[] }>('/api/exports'),
    ])
      .then(([p, s, e]) => {
        setProjects(p.projects);
        setStudios(s.studios);
        setExportsList(e.exports);
      })
      .finally(() => setLoading(false));
  }, []);

  const maxExports = plan?.limits.maxExportsPerMonth ?? 2;
  const usedExports = usage?.exportsCount ?? 0;
  const remainingExports = Math.max(0, maxExports - usedExports);

  return (
    <DashboardLayout title="Overview">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Account & Quota Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-[#94A3B8]">Current Subscription</div>
            <div className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {plan?.name || 'Free'} Plan
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Status: {subscription?.status || 'active'}
              {subscription && subscription.planId !== 'free'
                ? ` · Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                : ''}
            </div>
          </div>

          <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-[#94A3B8]">Monthly Exports</div>
            <div className="font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-white">
              {usedExports} / {maxExports}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {remainingExports} remaining · Max {plan?.limits.maxExportResolution || '720p'}
            </div>
          </div>

          <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-[#94A3B8]">Saved Studios</div>
            <div className="font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-white">
              {savedStudiosCount} / {plan?.limits.maxSavedStudios ?? 1}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Custom 2.5D &amp; branded configurations
            </div>
          </div>

          <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-[#94A3B8]">Account Status</div>
            <div className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {user?.emailVerified ? 'Verified' : 'Unverified'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email}</div>
          </div>
        </div>

        {/* Upgrade Notice if nearing limit */}
        {remainingExports === 0 && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-sm text-amber-400">
              You have reached your monthly export limit ({maxExports} exports). Upgrade to increase your monthly quota.
            </div>
            <Link
              to="/dashboard/subscription"
              className="px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold whitespace-nowrap shrink-0"
            >
              Upgrade Plan
            </Link>
          </div>
        )}

        {/* Quick Workspace Launchers */}
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4">
            Production Workspaces
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                to: '/dashboard/live-studio',
                icon: Video,
                title: 'Live AI Studio',
                desc: 'Record webcam video inside a layered virtual studio.',
              },
              {
                to: '/dashboard/video-transform',
                icon: Film,
                title: 'Video Transformation',
                desc: 'Replace backgrounds & trim existing uploaded videos.',
              },
              {
                to: '/dashboard/studio-generator',
                icon: Sparkles,
                title: 'AI Studio Generator',
                desc: 'Convert studio photographs into 2.5D reusable sets.',
              },
              {
                to: '/dashboard/live-broadcast',
                icon: Radio,
                title: 'Live Broadcast',
                desc: 'Prepare OBS Browser Source scenes for YouTube Live.',
              },
            ].map((w) => (
              <Link
                key={w.to}
                to={w.to}
                className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 hover:border-[#6366F1] transition-colors flex flex-col justify-between gap-4"
              >
                <div className="space-y-2">
                  <w.icon className="w-5 h-5 text-[#6366F1]" />
                  <div className="font-display text-base font-semibold text-slate-900 dark:text-white">{w.title}</div>
                  <div className="text-xs text-slate-600 dark:text-[#94A3B8]">{w.desc}</div>
                </div>
                <div className="inline-flex items-center gap-1 text-xs font-semibold text-[#6366F1]">
                  <span>Open workspace</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Real Database Lists (Empty States when zero) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">Recent Projects</h2>
              <Link to="/dashboard/projects" className="text-xs text-[#6366F1] hover:underline">
                View all
              </Link>
            </div>
            {loading ? (
              <div className="h-28 rounded-lg bg-slate-100 dark:bg-slate-800/40 animate-pulse" />
            ) : projects.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-slate-600 dark:text-[#94A3B8]">No projects recorded yet.</p>
                <Link
                  to="/dashboard/live-studio"
                  className="inline-block text-xs font-semibold text-[#6366F1] hover:underline"
                >
                  Record your first virtual studio session
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {projects.slice(0, 5).map((p) => (
                  <div key={p.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-white truncate">{p.title}</div>
                      <div className="text-xs text-slate-500 dark:text-[#94A3B8]">
                        {p.type.replace('_', ' ')} · {p.aspectRatio}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400 shrink-0">
                      {p.durationSeconds}s
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">Saved Studios &amp; Exports</h2>
              <Link to="/dashboard/studios" className="text-xs text-[#6366F1] hover:underline">
                Manage studios
              </Link>
            </div>
            {loading ? (
              <div className="h-28 rounded-lg bg-slate-100 dark:bg-slate-800/40 animate-pulse" />
            ) : studios.length === 0 && exportsList.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <Layers className="w-6 h-6 text-slate-400 mx-auto" />
                <p className="text-sm text-slate-600 dark:text-[#94A3B8]">
                  No custom studios or completed exports yet.
                </p>
                <Link
                  to="/dashboard/studio-generator"
                  className="inline-block text-xs font-semibold text-[#6366F1] hover:underline"
                >
                  Create a studio in AI Studio Generator
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {studios.slice(0, 3).map((s) => (
                  <div key={s.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-white truncate">{s.name}</div>
                      <div className="text-xs text-slate-500 dark:text-[#94A3B8]">{s.category}</div>
                    </div>
                    <Link
                      to={`/dashboard/live-studio?studio=${encodeURIComponent(s.id)}`}
                      className="text-xs font-semibold text-[#6366F1] shrink-0"
                    >
                      Open
                    </Link>
                  </div>
                ))}
                {exportsList.slice(0, 2).map((e) => (
                  <div key={e.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-white truncate">{e.title}</div>
                      <div className="text-xs text-slate-500 dark:text-[#94A3B8]">
                        Export · {e.resolution} · {e.status}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-slate-500 shrink-0">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
