import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Building2, CheckCircle2, Church, Film, GraduationCap, Layers, Mic, MonitorPlay, Radio, ShieldCheck, Sliders, Users } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { apiRequest } from '../lib/api';
import type { StudioCategory, StudioTemplate } from '../../shared/types';

export function FeaturesPage() {
  const sections = [
    {
      icon: MonitorPlay,
      title: 'Live AI Virtual Studio',
      desc: 'Select cameras and microphones, toggle mirroring, monitor audio levels, run MediaPipe SelfieSegmenter or Chroma Key locally in your browser, and record the final composited canvas with synchronized audio.',
    },
    {
      icon: Layers,
      title: 'Layered 2.5D Studio Engine',
      desc: 'Compose up to six deterministic layers: studio background, wall screen graphics, color-graded subject cutout, foreground desks/pulpits, custom logos/lower thirds, and plan-aware export watermarks.',
    },
    {
      icon: Film,
      title: 'Video Upload & Transformation',
      desc: 'Upload browser-decodable MP4 or WebM videos, trim start/end points, switch between 16:9, 9:16, and 1:1 aspect ratios, adjust brightness/contrast/saturation/volume, and export cleanly.',
    },
    {
      icon: Sliders,
      title: 'AI Studio Generator & Studio Designer',
      desc: 'Upload a JPG, PNG, or WebP studio photograph, configure foreground desk height and perspective, customize brand colors and lower thirds, inspect 2.5D depth planes in Three.js, and save reusable templates.',
    },
    {
      icon: Radio,
      title: 'OBS-Compatible Broadcast Workflow',
      desc: 'Open a clean, account-free OBS Browser Source scene URL with optional transparent keying, manage broadcast titles and lower thirds live, and follow step-by-step YouTube Live setup checklists.',
    },
    {
      icon: ShieldCheck,
      title: 'Privacy-First Local Processing',
      desc: 'Your camera feed and uploaded videos stay in your browser session. Server databases store only account metadata, studio configurations, and export quota records.',
    },
  ];

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="max-w-3xl mb-12">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
            Platform Features Built for Real Production
          </h1>
          <p className="mt-3 text-base text-slate-600 dark:text-[#94A3B8]">
            Every capability in NexaFlow AI Studio runs on open web standards—Canvas, WebGL, Three.js, MediaPipe WASM,
            Web Audio API, and MediaRecorder—with honest server-enforced account limits.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sections.map((s) => (
            <div key={s.title} className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3">
              <s.icon className="w-6 h-6 text-[#6366F1]" />
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">{s.title}</h2>
              <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}

export function VirtualStudiosPage() {
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [category, setCategory] = useState<string>('All');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ templates: StudioTemplate[] }>('/api/templates')
      .then((d) => setTemplates(d.templates))
      .finally(() => setLoading(false));
  }, []);

  const categories: ('All' | StudioCategory)[] = [
    'All',
    'Church Broadcasting Studios',
    'Television News Studios',
    'Podcast Studios',
    'Educational Studios',
    'Corporate Presentation Studios',
  ];

  const filtered = category === 'All' ? templates : templates.filter((t) => t.category === category);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="max-w-3xl mb-8">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
            Virtual Studio Library
          </h1>
          <p className="mt-2 text-slate-600 dark:text-[#94A3B8]">
            Two ready-to-use free templates are available immediately, alongside premium creator templates and
            administrator-managed studio packs.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                category === cat
                  ? 'bg-[#6366F1] text-white'
                  : 'bg-white dark:bg-[#111827] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-[#6366F1]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-72 rounded-xl bg-slate-200 dark:bg-[#111827] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((tpl) => (
              <div
                key={tpl.id}
                className="rounded-xl overflow-hidden bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col"
              >
                <div className="aspect-video bg-slate-900 flex items-center justify-center overflow-hidden">
                  {tpl.isAvailable && tpl.thumbnailUrl ? (
                    <img
                      src={tpl.thumbnailUrl}
                      alt={tpl.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="p-6 text-center text-xs text-slate-400">
                      {tpl.availabilityNote || 'Asset pending administrator upload'}
                    </div>
                  )}
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-[#94A3B8]">
                      {tpl.category} · {tpl.requiredPlan.replace('_', ' ')} · {tpl.studioType === 'layered_2_5d' ? 'Layered 2.5D' : '2D Backdrop'}
                    </div>
                    <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mt-1">
                      {tpl.name}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-[#94A3B8] mt-1.5">{tpl.description}</p>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
                    <span className="text-slate-500 dark:text-slate-400">
                      Ratios: {tpl.supportedAspectRatios.join(', ')}
                    </span>
                    {tpl.isAvailable ? (
                      <Link
                        to={`/dashboard/live-studio?template=${encodeURIComponent(tpl.id)}`}
                        className="font-semibold text-[#6366F1] hover:text-[#06B6D4]"
                      >
                        Launch Studio
                      </Link>
                    ) : (
                      <span className="text-amber-500 font-medium">Unavailable</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

export function HowItWorksPage() {
  const steps = [
    {
      num: '01',
      title: 'Choose or Design Your Studio',
      desc: 'Pick a template from the Virtual Studio Library or upload a JPG, PNG, or WebP studio photo in the AI Studio Generator. Add a foreground desk layer, lower third, and brand colors.',
    },
    {
      num: '02',
      title: 'Connect Camera or Upload Video',
      desc: 'Grant browser camera and microphone permissions in the Live AI Studio, or load an existing MP4/WebM file into Video Transformation.',
    },
    {
      num: '03',
      title: 'Segment & Composite Locally',
      desc: 'Enable MediaPipe SelfieSegmenter or Chroma Key. Adjust scale, vertical placement behind the desk, color temperature, brightness, contrast, and edge softness.',
    },
    {
      num: '04',
      title: 'Record, Export, or Capture in OBS',
      desc: 'Record the composited scene with synchronized audio, export within your verified account quota, or open the clean OBS Browser Source URL for YouTube Live streaming.',
    },
  ];

  return (
    <PublicLayout>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight mb-4">
          How NexaFlow AI Studio Works
        </h1>
        <p className="text-slate-600 dark:text-[#94A3B8] mb-12">
          A four-stage virtual production pipeline designed to run in standard desktop browsers without external video
          servers.
        </p>

        <div className="space-y-6">
          {steps.map((s) => (
            <div
              key={s.num}
              className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-6 items-start"
            >
              <div className="font-mono text-2xl font-bold text-[#6366F1] shrink-0">{s.num}</div>
              <div>
                <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">{s.title}</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}

export function UseCasesPage() {
  const cases = [
    {
      icon: Church,
      name: 'Churches & Ministries',
      detail: 'Broadcast midweek devotionals, announcements, and pastor messages from behind a clean sanctuary pulpit without rigging physical cameras in the main hall.',
    },
    {
      icon: Mic,
      name: 'Podcasters & Talk Shows',
      detail: 'Turn a spare desk and webcam into an acoustic-paneled podcast set with episode wall graphics and lower-third guest names.',
    },
    {
      icon: GraduationCap,
      name: 'Online Tutors & Educators',
      detail: 'Record structured 16:9 lessons or 9:16 study clips with clean studio framing, teleprompter scripts, and consistent brand colors.',
    },
    {
      icon: Building2,
      name: 'Corporate & Agency Teams',
      detail: 'Standardize executive updates, product briefings, and client explainers across distributed teams using saved custom studio templates.',
    },
    {
      icon: Users,
      name: 'YouTubers & Social Creators',
      detail: 'Switch studio sets between series, re-frame recordings for Shorts (9:16) or square posts (1:1), and export directly from the browser.',
    },
  ];

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="max-w-3xl mb-12">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
            Built for Global Creators and Organizations
          </h1>
          <p className="mt-3 text-slate-600 dark:text-[#94A3B8]">
            Designed for teams and solo presenters who need consistent broadcast framing from ordinary rooms.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cases.map((c) => (
            <div key={c.name} className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3">
              <c.icon className="w-6 h-6 text-[#06B6D4]" />
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">{c.name}</h2>
              <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">{c.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}

export function AboutPage() {
  return (
    <PublicLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-16 space-y-8">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
            About NexaFlow Technologies
          </h1>
          <p className="mt-4 text-base text-slate-600 dark:text-[#94A3B8] leading-relaxed">
            NexaFlow AI Studio is developed by NexaFlow Technologies to make layered virtual production accessible
            globally without specialized studio construction, expensive hardware switchers, or mandatory cloud render
            fees.
          </p>
        </div>
        <div className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3">
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">Engineering Transparency</h2>
          <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">
            We believe creators deserve honest software. Where a capability runs locally in the browser (such as
            MediaPipe segmentation, Chroma Key, Canvas recording, and OBS clean output), we state its hardware limits
            clearly. Where an advanced service requires external streaming pipelines or third-party credentials (such as
            direct multi-destination RTMP encoding or live Paystack billing), we keep those features transparently marked
            until configured.
          </p>
        </div>
      </section>
    </PublicLayout>
  );
}

export function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('General Inquiry');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ticket: { id: string } }>('/api/support', {
        method: 'POST',
        body: JSON.stringify({ name, email, subject, category, message }),
      });
      setSubmittedId(res.ticket.id);
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit support request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
          Contact NexaFlow Support
        </h1>
        <p className="mt-2 text-slate-600 dark:text-[#94A3B8] mb-8">
          Submit a technical question, billing inquiry, or studio template request directly to our support queue.
        </p>

        {submittedId ? (
          <div className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-emerald-500/40 space-y-3">
            <div className="flex items-center gap-2 text-emerald-500 font-semibold">
              <CheckCircle2 className="w-5 h-5" />
              <span>Support request received</span>
            </div>
            <p className="text-sm text-slate-600 dark:text-[#94A3B8]">
              Ticket reference: <span className="font-mono text-slate-900 dark:text-white">{submittedId}</span>. Our team
              reviews submissions directly in the support queue.
            </p>
            <button
              type="button"
              onClick={() => setSubmittedId(null)}
              className="text-sm font-medium text-[#6366F1] hover:underline"
            >
              Send another inquiry
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Full Name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                  placeholder="Kwame Mensah"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email Address</label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                  placeholder="you@example.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                >
                  <option>General Inquiry</option>
                  <option>Technical Support</option>
                  <option>Billing &amp; Paystack</option>
                  <option>Enterprise / Church Deployment</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Subject</label>
                <input
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                  placeholder="How can we help?"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Message</label>
              <textarea
                required
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                placeholder="Describe your production setup, browser, or question..."
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-lg bg-[#6366F1] text-white text-sm font-semibold hover:bg-[#5558E6] disabled:opacity-60"
            >
              {submitting ? 'Submitting...' : 'Submit Support Request'}
            </button>
          </form>
        )}
      </section>
    </PublicLayout>
  );
}

export function HelpCenterPage() {
  const guides = [
    {
      title: 'Camera & Microphone Permissions',
      body: 'If your browser blocks camera access, click the lock icon next to the address bar, allow Camera and Microphone permissions, and click Retry Camera inside the Live AI Studio.',
    },
    {
      title: 'Setting Up OBS Studio & YouTube Live',
      body: 'In Live Broadcast, enable OBS Clean Output for your studio and copy the tokenized URL. In OBS Studio, add a Browser Source (1920x1080) with that URL, or use Window Capture, then enter your YouTube Live RTMP stream key inside OBS Settings -> Stream.',
    },
    {
      title: 'Optimizing Segmentation Performance',
      body: 'On laptops without dedicated GPUs, enable Low-Performance Mode in the Live Studio toolbar or switch to 720p preview resolution. Good front lighting on your face and shoulders improves MediaPipe edge clarity.',
    },
    {
      title: 'Local Processing vs. Server Storage',
      body: 'Raw camera streams, uploaded videos, and exported WebM/MP4 files are processed locally on your device. Only account records, studio layout settings, and export usage logs are stored on NexaFlow servers.',
    },
  ];

  return (
    <PublicLayout>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16 space-y-8">
        <div className="flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-[#6366F1]" />
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
            Help Center
          </h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {guides.map((g) => (
            <div key={g.title} className="p-6 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-2">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">{g.title}</h2>
              <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">{g.body}</p>
            </div>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}

export function LegalPage({ type }: { type: 'privacy' | 'terms' | 'refund' }) {
  const content = {
    privacy: {
      title: 'Privacy Policy',
      updated: 'Effective November 2026',
      sections: [
        {
          heading: '1. Local Media Processing',
          text: 'NexaFlow AI Studio processes live webcam video, audio, and uploaded video transformations locally inside your web browser using WebGL, WebAssembly, and MediaRecorder. Raw video recordings are not uploaded to NexaFlow servers.',
        },
        {
          heading: '2. Account & Configuration Data',
          text: 'We store your name, email address, securely hashed password, subscription status, monthly export counts, saved studio layout configurations, and any studio background/logo images you explicitly upload.',
        },
        {
          heading: '3. Account & Data Deletion',
          text: 'You may permanently delete your account, saved studios, projects, and session records at any time from Account Settings inside the Creator Dashboard.',
        },
      ],
    },
    terms: {
      title: 'Terms of Service',
      updated: 'Effective November 2026',
      sections: [
        {
          heading: '1. Acceptable Use & Media Ownership',
          text: 'You retain full ownership of the videos, images, and logos you produce or upload using NexaFlow AI Studio. You must only upload studio photography or media you have legal rights to use.',
        },
        {
          heading: '2. Plan Quotas & Abuse Prevention',
          text: 'Free and paid subscription plans include monthly export, session duration, and saved studio limits enforced on the server. Automated abuse or attempts to bypass email verification may result in account suspension.',
        },
        {
          heading: '3. Service Availability',
          text: 'Browser-based rendering depends on your device hardware, operating system codecs, and browser support. We provide capability diagnostics and fallback modes without guaranteeing uniform performance on unsupported devices.',
        },
      ],
    },
    refund: {
      title: 'Refund Policy',
      updated: 'Effective November 2026',
      sections: [
        {
          heading: '1. Transparent Pre-Checkout Review',
          text: 'Before paying via Paystack, you see the exact USD plan price, applicable currency conversion rate, and final settlement amount. All plans can be tested on the Free tier prior to upgrading.',
        },
        {
          heading: '2. Subscription Cancellation',
          text: 'You may cancel a paid subscription at any time from your Billing page. Manual renewal workflows never charge your payment method automatically without explicit checkout confirmation.',
        },
        {
          heading: '3. Refund Eligibility',
          text: 'If a verified duplicate charge or technical billing error occurs, contact NexaFlow Support within 7 days with your Paystack transaction reference for review.',
        },
      ],
    },
  }[type];

  return (
    <PublicLayout>
      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-16 space-y-8">
        <div>
          <div className="text-xs text-slate-500 dark:text-[#94A3B8]">{content.updated}</div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white mt-1">
            {content.title}
          </h1>
        </div>
        <div className="space-y-6">
          {content.sections.map((s) => (
            <section key={s.heading} className="space-y-2">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">{s.heading}</h2>
              <p className="text-sm text-slate-600 dark:text-[#94A3B8] leading-relaxed">{s.text}</p>
            </section>
          ))}
        </div>
      </article>
    </PublicLayout>
  );
}
