import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Layers, MonitorPlay, Radio, Sliders, Video } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { apiRequest } from '../lib/api';
import type { PlanRecord, StudioTemplate } from '../../shared/types';

export function PublicHome() {
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);

  useEffect(() => {
    apiRequest<{ templates: StudioTemplate[] }>('/api/templates')
      .then((d) => setTemplates(d.templates.filter((t) => t.isAvailable)))
      .catch(() => {});
    apiRequest<{ plans: PlanRecord[] }>('/api/plans')
      .then((d) => setPlans(d.plans))
      .catch(() => {});
  }, []);

  const comparisonRows = [
    {
      factor: 'Studio Build & Set Construction',
      traditional: 'Physical sets, acoustic buildout, dedicated room lighting',
      nexaflow: 'Layered 2.5D virtual backdrops and foreground desks in the browser',
    },
    {
      factor: 'Hardware Requirements',
      traditional: 'Hardware switchers, capture cards, physical green screen rigs',
      nexaflow: 'Standard webcam or uploaded video, processed locally via WebGL/WASM',
    },
    {
      factor: 'Rebranding Between Shows',
      traditional: 'Manual set swaps and physical banner replacements',
      nexaflow: 'Instant logo, lower-third, wall screen, and color preset switching',
    },
    {
      factor: 'Streaming Integration',
      traditional: 'Dedicated broadcast rack for scene composition',
      nexaflow: 'Clean OBS Browser Source scene output ready for YouTube Live & RTMP',
    },
  ];

  const faqs = [
    {
      q: 'How does NexaFlow AI Studio process my camera video?',
      a: 'Person segmentation and layered scene compositing run directly inside your browser using local WebAssembly/WebGL (MediaPipe SelfieSegmenter) or Chroma Key. Your raw camera feed is never uploaded to external AI servers.',
    },
    {
      q: 'Can I place myself behind a virtual desk?',
      a: 'Yes. NexaFlow uses a layered 2.5D composition architecture: Background Layer, Subject Layer, Foreground Desk/Mask Layer, and Branding Graphics. You adjust subject scale and vertical offset to sit naturally behind the desk.',
    },
    {
      q: 'Can I upload a photograph of my own church or office?',
      a: 'Yes. In the AI Studio Generator, you can upload JPG, PNG, or WebP studio photos, configure camera framing and foreground desk layers, and save them as reusable 2.5D studio templates. Single photos are treated honestly as layered 2.5D backdrops rather than full 3D geometry.',
    },
    {
      q: 'How does live broadcasting to YouTube or Facebook work?',
      a: 'Creator and higher plans include an OBS-compatible workflow with a dedicated clean-output browser view (no account UI exposed) that captures cleanly into OBS Studio for broadcasting to YouTube Live, Twitch, or custom RTMP.',
    },
  ];

  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-16 lg:pt-20 lg:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <div className="text-sm font-medium text-[#06B6D4]">
              NexaFlow Technologies · Virtual Production Platform
            </div>
            <h1
              className="font-display font-bold tracking-tight text-slate-900 dark:text-white leading-[1.08]"
              style={{ fontSize: 'clamp(2.25rem, 4vw, 3.75rem)', textWrap: 'balance' }}
            >
              Your Studio. Anywhere.
            </h1>
            <p className="text-base sm:text-lg text-slate-600 dark:text-[#94A3B8] max-w-xl leading-relaxed">
              Create professional videos, design realistic virtual studios, and prepare live broadcasts from any
              standard camera—without expensive physical studio equipment.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                to="/signup"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#6366F1] text-white font-semibold text-sm hover:bg-[#5558E6] transition-colors whitespace-nowrap shrink-0"
              >
                <span>Start Free Production</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/virtual-studios"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium text-sm hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Browse Studio Library</span>
              </Link>
            </div>
            <div className="pt-2 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
              <span>Browser-local WebGL &amp; WASM processing</span>
              <span aria-hidden="true">·</span>
              <span>Free plan with 2 active studio templates</span>
              <span aria-hidden="true">·</span>
              <span>OBS-compatible broadcast workflow</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[280px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#111827]">
              <img
                src="/src/assets/images/hero_virtual_studio_1795011533022.jpg"
                alt="NexaFlow AI Studio virtual broadcast stage with curved LED backdrop and foreground anchor desk"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-[#080B14]/90 via-[#080B14]/50 to-transparent">
                <div className="text-sm font-semibold text-white">Layered 2.5D Virtual Production Stage</div>
                <div className="text-xs text-slate-300 mt-0.5">
                  Background · Segmented Subject · Foreground Desk · Brand Lower Thirds
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Capabilities (Asymmetric Grid) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 border-t border-slate-200 dark:border-slate-800/80">
        <div className="max-w-2xl mb-10">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            Built for complete video production workflows
          </h2>
          <p className="mt-2 text-slate-600 dark:text-[#94A3B8]">
            Every tool runs directly inside a unified browser workspace—from real-time camera segmentation to exported
            recordings and OBS broadcast preparation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="text-xs font-medium text-[#6366F1]">01. Live AI Virtual Studio</div>
              <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                Real-Time Camera Segmentation Behind Virtual Desks
              </h3>
              <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed max-w-2xl">
                Connect any webcam or capture card, separate yourself from your room using local MediaPipe
                SelfieSegmenter or Chroma Key, adjust edge softness and color temperature, and record the final
                composited scene with synchronized audio.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2"><Video className="w-4 h-4 text-[#06B6D4]" /> <span>Webcam &amp; Mic Selection</span></div>
              <div className="flex items-center gap-2"><Layers className="w-4 h-4 text-[#06B6D4]" /> <span>Foreground Desk Layer</span></div>
              <div className="flex items-center gap-2"><Sliders className="w-4 h-4 text-[#06B6D4]" /> <span>Color &amp; Edge Controls</span></div>
              <div className="flex items-center gap-2"><MonitorPlay className="w-4 h-4 text-[#06B6D4]" /> <span>Adaptive FPS Mode</span></div>
            </div>
          </div>

          <div className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="text-xs font-medium text-[#06B6D4]">02. Video Transformation</div>
            <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
              Transform Existing Footage
            </h3>
            <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">
              Upload browser-supported MP4 or WebM videos, trim timelines, switch aspect ratios (16:9, 9:16, 1:1), add
              logos and lower thirds, and re-composite subjects into any saved studio.
            </p>
          </div>

          <div className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="text-xs font-medium text-[#6366F1]">03. AI Studio Generator &amp; Designer</div>
            <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
              Convert Studio Photos into 2.5D Sets
            </h3>
            <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">
              Upload JPG, PNG, or WebP backgrounds, pair them with foreground desk masks, customize wall screen text and
              brand colors, and inspect Z-depth layers in an interactive Three.js 2.5D stage view.
            </p>
          </div>

          <div className="md:col-span-2 p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="space-y-2 max-w-xl">
              <div className="text-xs font-medium text-[#06B6D4]">04. Live Broadcast Workflow</div>
              <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                Clean OBS Scene Output for YouTube &amp; RTMP
              </h3>
              <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">
                Launch a clean, account-free OBS Browser Source output URL with optional transparent background keying
                and follow step-by-step OBS and YouTube Live setup checklists.
              </p>
            </div>
            <Link
              to="/features"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-[#172033] text-white text-sm font-medium border border-slate-700 hover:border-[#6366F1] transition-colors whitespace-nowrap shrink-0"
            >
              <Radio className="w-4 h-4 text-[#06B6D4]" />
              <span>Explore All Features</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Studio Library Preview */}
      {templates.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 border-t border-slate-200 dark:border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                Virtual Studio Library
              </h2>
              <p className="mt-1 text-slate-600 dark:text-[#94A3B8]">
                Ready-to-record studio environments with configured camera framing and foreground desk layers.
              </p>
            </div>
            <Link to="/virtual-studios" className="text-sm font-medium text-[#6366F1] hover:underline whitespace-nowrap">
              View all templates
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {templates.slice(0, 4).map((tpl) => (
              <div
                key={tpl.id}
                className="rounded-xl overflow-hidden bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col"
              >
                <div className="aspect-video bg-slate-900 overflow-hidden">
                  <img
                    src={tpl.thumbnailUrl}
                    alt={tpl.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-[#94A3B8]">
                      {tpl.category} · {tpl.requiredPlan === 'free' ? 'Free Plan' : 'Creator+'}
                    </div>
                    <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white mt-1">
                      {tpl.name}
                    </h3>
                  </div>
                  <Link
                    to={`/dashboard/live-studio?template=${encodeURIComponent(tpl.id)}`}
                    className="text-xs font-semibold text-[#6366F1] hover:text-[#06B6D4] transition-colors"
                  >
                    Open in Live Studio
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Traditional vs Virtual Comparison */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 border-t border-slate-200 dark:border-slate-800/80">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-8">
          Traditional Studio Production vs. NexaFlow AI Studio
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-[#94A3B8]">
                <th className="py-3.5 px-5 font-semibold">Production Requirement</th>
                <th className="py-3.5 px-5 font-semibold">Traditional Physical Studio</th>
                <th className="py-3.5 px-5 font-semibold text-[#6366F1]">NexaFlow AI Studio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {comparisonRows.map((row) => (
                <tr key={row.factor}>
                  <td className="py-4 px-5 font-medium text-slate-900 dark:text-white">{row.factor}</td>
                  <td className="py-4 px-5 text-slate-600 dark:text-[#94A3B8]">{row.traditional}</td>
                  <td className="py-4 px-5 text-slate-900 dark:text-slate-100">{row.nexaflow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing Summary */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 border-t border-slate-200 dark:border-slate-800/80">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              Transparent USD Subscription Plans
            </h2>
            <p className="mt-1 text-slate-600 dark:text-[#94A3B8]">
              Start free in the browser. Upgrade for higher resolution, watermark removal, and team capacity.
            </p>
          </div>
          <Link to="/pricing" className="text-sm font-medium text-[#6366F1] hover:underline whitespace-nowrap">
            Compare all plan limits
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((p) => (
            <div
              key={p.id}
              className={`p-6 rounded-xl bg-white dark:bg-[#111827] border flex flex-col justify-between ${
                p.id === 'creator'
                  ? 'border-[#6366F1]'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="space-y-4">
                <div>
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">{p.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-1">{p.tagline}</p>
                </div>
                <div className="font-mono tabular-nums text-3xl font-bold text-slate-900 dark:text-white">
                  ${p.monthlyPriceUsd}
                  <span className="text-sm font-normal text-slate-500 dark:text-[#94A3B8]">/mo</span>
                </div>
                <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                    <span>{p.limits.maxExportsPerMonth} exports / month ({p.limits.maxExportResolution})</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                    <span>{p.limits.maxRecordingMinutes} min max recording session</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                    <span>{p.limits.maxSavedStudios} saved custom studios</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                    <span>{p.limits.watermarkRequired ? 'NexaFlow watermark' : 'No watermark'}</span>
                  </li>
                </ul>
              </div>
              <Link
                to={p.id === 'free' ? '/signup' : '/pricing'}
                className={`mt-6 w-full py-2.5 px-4 rounded-lg text-center text-sm font-semibold transition-colors ${
                  p.id === 'creator'
                    ? 'bg-[#6366F1] text-white hover:bg-[#5558E6]'
                    : 'border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {p.id === 'free' ? 'Create Free Account' : 'View Plan Details'}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 border-t border-slate-200 dark:border-slate-800/80">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-8">
          Frequently Asked Questions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {faqs.map((f) => (
            <div key={f.q} className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-2">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">{f.q}</h3>
              <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
