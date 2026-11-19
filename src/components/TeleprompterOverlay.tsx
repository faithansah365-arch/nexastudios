import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlipHorizontal,
  Gauge,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Type,
  X,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';
import {
  clampTeleprompterFontSize,
  clampTeleprompterSpeed,
  countScriptWords,
  DEFAULT_TELEPROMPTER_SCRIPT,
  estimateReadingSeconds,
  MAX_TELEPROMPTER_FONT_SIZE,
  MAX_TELEPROMPTER_SPEED,
  MIN_TELEPROMPTER_FONT_SIZE,
  MIN_TELEPROMPTER_SPEED,
  scrollPxPerSecToWpm,
  type TeleprompterAiMode,
  type TeleprompterAiResponse,
  type TeleprompterTone,
} from '../../shared/teleprompter';

interface TeleprompterOverlayProps {
  script: string;
  onChangeScript: (nextScript: string) => void;
  scrollSpeed: number;
  onChangeScrollSpeed: (nextSpeed: number) => void;
  fontSize: number;
  onChangeFontSize: (nextFontSize: number) => void;
  onClose: () => void;
}

const OPACITY_STEPS = [0.62, 0.78, 0.92] as const;

function formatTimer(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function TeleprompterOverlay({
  script,
  onChangeScript,
  scrollSpeed,
  onChangeScrollSpeed,
  fontSize,
  onChangeFontSize,
  onClose,
}: TeleprompterOverlayProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollFloatRef = useRef<number>(0);
  const speedRef = useRef<number>(scrollSpeed);
  speedRef.current = scrollSpeed;

  const [isPlaying, setIsPlaying] = useState(false);
  const [mirrored, setMirrored] = useState(false);
  const [opacityIdx, setOpacityIdx] = useState<number>(1);
  const [wideView, setWideView] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showControlsDrawer, setShowControlsDrawer] = useState(false);

  // AI Teleprompter Assistant state
  const [aiTopic, setAiTopic] = useState('');
  const [aiTone, setAiTone] = useState<TeleprompterTone>('conversational');
  const [aiTargetSeconds, setAiTargetSeconds] = useState(60);
  const [aiLoadingMode, setAiLoadingMode] = useState<TeleprompterAiMode | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [deliveryTip, setDeliveryTip] = useState<string | null>(null);

  const safeSpeed = clampTeleprompterSpeed(scrollSpeed);
  const safeFontSize = clampTeleprompterFontSize(fontSize);
  const estimatedWpm = useMemo(() => scrollPxPerSecToWpm(safeSpeed, safeFontSize), [safeSpeed, safeFontSize]);
  const wordCount = useMemo(() => countScriptWords(script), [script]);
  const estTotalSeconds = useMemo(() => estimateReadingSeconds(script, estimatedWpm), [script, estimatedWpm]);

  const updateProgressFromContainer = useCallback((el: HTMLDivElement) => {
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxScroll <= 1) {
      setScrollProgress(0);
      return;
    }
    setScrollProgress(Math.min(1, Math.max(0, el.scrollTop / maxScroll)));
  }, []);

  // Smooth sub-pixel requestAnimationFrame scroll loop
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let lastTs = performance.now();

    const step = (now: number) => {
      const el = scrollContainerRef.current;
      if (!el) return;

      const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;

      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 1) {
        setIsPlaying(false);
        setScrollProgress(0);
        return;
      }

      scrollFloatRef.current = Math.min(maxScroll, scrollFloatRef.current + speedRef.current * dt);
      el.scrollTop = scrollFloatRef.current;
      updateProgressFromContainer(el);

      if (scrollFloatRef.current >= maxScroll - 0.5) {
        setIsPlaying(false);
        return;
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, updateProgressFromContainer]);

  const handleManualScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Preserve manual wheel/touch adjustments cleanly without fighting RAF
    if (Math.abs(el.scrollTop - scrollFloatRef.current) > 2) {
      scrollFloatRef.current = el.scrollTop;
    }
    updateProgressFromContainer(el);
  };

  const handleResetToTop = useCallback(() => {
    setIsPlaying(false);
    scrollFloatRef.current = 0;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    setScrollProgress(0);
  }, []);

  const handleTogglePlay = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!script.trim()) {
      setShowControlsDrawer(true);
      return;
    }
    if (el) {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (!isPlaying && maxScroll > 1 && el.scrollTop >= maxScroll - 2) {
        scrollFloatRef.current = 0;
        el.scrollTop = 0;
        setScrollProgress(0);
      } else {
        scrollFloatRef.current = el.scrollTop;
      }
    }
    setIsPlaying((prev) => !prev);
  }, [isPlaying, script]);

  const runAiAssist = async (mode: TeleprompterAiMode) => {
    setAiError(null);
    setAiLoadingMode(mode);
    try {
      const result = await apiRequest<TeleprompterAiResponse>('/api/studios/teleprompter-ai', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          prompt: aiTopic,
          script,
          tone: aiTone,
          targetSeconds: aiTargetSeconds,
          fontSize: safeFontSize,
        }),
      });
      if (result.script && mode !== 'pacing') {
        onChangeScript(result.script);
        handleResetToTop();
      } else if (result.script && mode === 'pacing' && !script.trim()) {
        onChangeScript(result.script);
      }
      onChangeScrollSpeed(clampTeleprompterSpeed(result.recommendedSpeedPxPerSec));
      setDeliveryTip(result.deliveryTip);
      if (mode === 'generate') {
        setShowControlsDrawer(false);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setAiError(err.message);
      } else {
        setAiError('Unable to reach AI teleprompter assistant. Please try again.');
      }
    } finally {
      setAiLoadingMode(null);
    }
  };

  const scriptParagraphs = useMemo(() => {
    return script.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  }, [script]);

  const scrimAlpha = OPACITY_STEPS[opacityIdx];

  return (
    <div
      className={`absolute top-2 left-1/2 -translate-x-1/2 z-20 transition-[width] duration-200 ${
        wideView ? 'w-[min(95%,820px)]' : 'w-[min(92%,640px)]'
      }`}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (e.code === 'Space' && tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON') {
          e.preventDefault();
          handleTogglePlay();
        }
      }}
    >
      <div
        className="rounded-xl border border-slate-700/80 shadow-2xl overflow-hidden text-white backdrop-blur-md"
        style={{ backgroundColor: `rgba(8, 11, 20, ${scrimAlpha})` }}
      >
        {/* Top Compact Control Bar (Pinned near camera lens eyeline) */}
        <div className="px-3 py-2 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleTogglePlay}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-semibold whitespace-nowrap shrink-0 transition-colors ${
                isPlaying
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                  : 'bg-[#06B6D4] text-slate-950 hover:bg-cyan-400'
              }`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pause' : 'Start'}</span>
            </button>

            <button
              type="button"
              onClick={handleResetToTop}
              title="Reset to top"
              className="p-1.5 rounded-lg border border-white/15 text-slate-200 hover:bg-white/10"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <span className="hidden sm:inline-flex items-center gap-1.5 pl-1.5 text-[11px] text-slate-300 font-mono tabular-nums whitespace-nowrap">
              <span>{wordCount}w</span>
              <span aria-hidden="true">·</span>
              <span>{formatTimer(estTotalSeconds)}</span>
              <span aria-hidden="true">·</span>
              <span>{estimatedWpm} WPM</span>
            </span>
          </div>

          {/* Inline Speed & Font Size Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Scroll Speed */}
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
              <Gauge className="w-3 h-3 text-[#06B6D4] shrink-0" />
              <button
                type="button"
                aria-label="Decrease scroll speed"
                onClick={() => onChangeScrollSpeed(clampTeleprompterSpeed(safeSpeed - 6))}
                className="p-0.5 rounded hover:bg-white/10"
              >
                <Minus className="w-3 h-3" />
              </button>
              <input
                type="range"
                aria-label="Teleprompter scroll speed"
                min={MIN_TELEPROMPTER_SPEED}
                max={MAX_TELEPROMPTER_SPEED}
                step={2}
                value={safeSpeed}
                onChange={(e) => onChangeScrollSpeed(clampTeleprompterSpeed(Number(e.target.value)))}
                className="w-16 accent-[#06B6D4] cursor-pointer"
              />
              <button
                type="button"
                aria-label="Increase scroll speed"
                onClick={() => onChangeScrollSpeed(clampTeleprompterSpeed(safeSpeed + 6))}
                className="p-0.5 rounded hover:bg-white/10"
              >
                <Plus className="w-3 h-3" />
              </button>
              <span className="font-mono tabular-nums text-[11px] text-slate-200 w-10 text-right">
                {safeSpeed}px/s
              </span>
            </div>

            {/* Font Size */}
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
              <Type className="w-3 h-3 text-[#6366F1] shrink-0" />
              <button
                type="button"
                aria-label="Decrease font size"
                onClick={() => onChangeFontSize(clampTeleprompterFontSize(safeFontSize - 2))}
                className="px-1 rounded text-[11px] font-semibold hover:bg-white/10"
              >
                A-
              </button>
              <input
                type="range"
                aria-label="Teleprompter font size"
                min={MIN_TELEPROMPTER_FONT_SIZE}
                max={MAX_TELEPROMPTER_FONT_SIZE}
                step={1}
                value={safeFontSize}
                onChange={(e) => onChangeFontSize(clampTeleprompterFontSize(Number(e.target.value)))}
                className="w-14 accent-[#6366F1] cursor-pointer"
              />
              <button
                type="button"
                aria-label="Increase font size"
                onClick={() => onChangeFontSize(clampTeleprompterFontSize(safeFontSize + 2))}
                className="px-1 rounded text-[11px] font-semibold hover:bg-white/10"
              >
                A+
              </button>
              <span className="font-mono tabular-nums text-[11px] text-slate-200 w-8 text-right">
                {safeFontSize}px
              </span>
            </div>

            <button
              type="button"
              onClick={() => setMirrored((m) => !m)}
              title="Mirror text for physical glass rig"
              className={`p-1.5 rounded-lg border transition-colors ${
                mirrored
                  ? 'border-[#06B6D4] bg-[#06B6D4]/20 text-[#06B6D4]'
                  : 'border-white/15 text-slate-300 hover:bg-white/10'
              }`}
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setShowControlsDrawer((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-medium whitespace-nowrap shrink-0 transition-colors ${
                showControlsDrawer
                  ? 'border-[#6366F1] bg-[#6366F1] text-white'
                  : 'border-white/15 text-slate-200 hover:bg-white/10'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Script</span>
            </button>

            <button
              type="button"
              onClick={() => setOpacityIdx((idx) => (idx + 1) % OPACITY_STEPS.length)}
              title="Cycle backdrop opacity"
              className="p-1.5 rounded-lg border border-white/15 text-slate-300 hover:bg-white/10"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Hide teleprompter"
              className="p-1.5 rounded-lg border border-white/15 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Thin scroll progress hairline */}
        <div className="h-0.5 w-full bg-white/10">
          <div
            className="h-full bg-[#06B6D4] transition-[width] duration-75"
            style={{ width: `${Math.round(scrollProgress * 100)}%` }}
          />
        </div>

        {/* Expandable Script Editor & Gemini AI Script Studio */}
        {showControlsDrawer && (
          <div className="p-3 border-b border-white/10 bg-[#0B101E]/95 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-100">AI Script &amp; Delivery Studio</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWideView((w) => !w)}
                  className="px-2 py-1 rounded border border-white/15 text-[11px] text-slate-300 hover:bg-white/10"
                >
                  {wideView ? 'Compact Width' : 'Wide Width'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangeScript(DEFAULT_TELEPROMPTER_SCRIPT);
                    handleResetToTop();
                  }}
                  className="px-2 py-1 rounded border border-white/15 text-[11px] text-slate-300 hover:bg-white/10"
                >
                  Load Sample
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={aiTopic}
                onChange={(e) => setAiTopic(e.target.value)}
                placeholder="Topic or talking points for Gemini to draft (e.g. Q3 product update)..."
                className="sm:col-span-6 px-2.5 py-1.5 rounded-lg bg-[#080B14] border border-slate-700 text-white placeholder:text-slate-400 focus:outline-none focus:border-[#06B6D4]"
              />
              <select
                value={aiTone}
                onChange={(e) => setAiTone(e.target.value as TeleprompterTone)}
                aria-label="Speaking tone"
                className="sm:col-span-2 px-2 py-1.5 rounded-lg bg-[#080B14] border border-slate-700 text-white"
              >
                <option value="conversational">Conversational</option>
                <option value="broadcast">Broadcast</option>
                <option value="executive">Executive</option>
                <option value="educational">Educational</option>
                <option value="sermon">Sermon</option>
              </select>
              <select
                value={aiTargetSeconds}
                onChange={(e) => setAiTargetSeconds(Number(e.target.value))}
                aria-label="Target duration"
                className="sm:col-span-2 px-2 py-1.5 rounded-lg bg-[#080B14] border border-slate-700 text-white"
              >
                <option value={30}>30 sec</option>
                <option value={60}>1 min</option>
                <option value={120}>2 min</option>
                <option value={180}>3 min</option>
                <option value={300}>5 min</option>
              </select>
              <button
                type="button"
                disabled={aiLoadingMode !== null}
                onClick={() => runAiAssist('generate')}
                className="sm:col-span-2 px-3 py-1.5 rounded-lg bg-[#6366F1] hover:bg-[#5558E6] text-white font-semibold disabled:opacity-50 whitespace-nowrap"
              >
                {aiLoadingMode === 'generate' ? 'Drafting...' : 'AI Draft'}
              </button>
            </div>

            <textarea
              rows={4}
              value={script}
              onChange={(e) => onChangeScript(e.target.value)}
              placeholder="Write or paste your teleprompter script here, or generate one above..."
              className="w-full px-3 py-2 rounded-lg bg-[#080B14] border border-slate-700 text-white placeholder:text-slate-400 text-xs leading-relaxed focus:outline-none focus:border-[#06B6D4]"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={aiLoadingMode !== null || script.trim().length < 10}
                  onClick={() => runAiAssist('polish')}
                  className="px-2.5 py-1 rounded-lg border border-[#06B6D4]/40 bg-[#06B6D4]/15 text-[#06B6D4] font-semibold hover:bg-[#06B6D4]/25 disabled:opacity-40 whitespace-nowrap"
                >
                  {aiLoadingMode === 'polish' ? 'Polishing...' : 'Polish for Eye Contact'}
                </button>
                <button
                  type="button"
                  disabled={aiLoadingMode !== null || script.trim().length < 10}
                  onClick={() => runAiAssist('pacing')}
                  className="px-2.5 py-1 rounded-lg border border-white/20 text-slate-200 font-medium hover:bg-white/10 disabled:opacity-40 whitespace-nowrap"
                >
                  {aiLoadingMode === 'pacing' ? 'Calibrating...' : 'AI Calibrate Speed'}
                </button>
              </div>
              <span className="text-[11px] text-slate-400">
                Position sits directly under your webcam lens for natural eye contact.
              </span>
            </div>

            {aiError && (
              <div className="px-2.5 py-1.5 rounded-lg bg-red-500/15 border border-red-500/40 text-red-200 text-[11px]">
                {aiError}
              </div>
            )}
          </div>
        )}

        {/* Eye-Line Teleprompter Reading Viewport */}
        <div className="relative h-44 sm:h-52">
          {/* Fixed Eyeline Guide Band positioned near upper third close to webcam */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-[24%] h-[34%] border-y border-[#06B6D4]/45 bg-[#06B6D4]/10 z-10 flex items-center justify-between px-2"
          >
            <span className="text-[10px] text-[#06B6D4] font-bold">▶</span>
            <span className="text-[10px] text-[#06B6D4] font-bold">◀</span>
          </div>

          <div
            ref={scrollContainerRef}
            onScroll={handleManualScroll}
            className={`h-full overflow-y-auto px-8 sm:px-10 scroll-auto ${
              mirrored ? 'scale-x-[-1]' : ''
            }`}
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(148,163,184,0.35) transparent',
            }}
          >
            {scriptParagraphs.length > 0 ? (
              <div
                className="text-center font-medium tracking-wide text-slate-50 select-none"
                style={{
                  fontSize: `${safeFontSize}px`,
                  lineHeight: 1.55,
                  paddingTop: '48px',
                  paddingBottom: '120px',
                }}
              >
                {scriptParagraphs.map((paragraph, idx) => {
                  const isPauseCue = /^\[PAUSE\]$/i.test(paragraph);
                  if (isPauseCue) {
                    return (
                      <div
                        key={idx}
                        className="my-3 text-xs font-mono tracking-widest uppercase text-[#06B6D4]/90"
                      >
                        Pause · Breathe
                      </div>
                    );
                  }
                  return (
                    <p key={idx} className="mb-4 last:mb-0">
                      {paragraph}
                    </p>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2.5 px-4">
                <p className="text-xs text-slate-300">
                  Your teleprompter script is empty. Paste text or let AI draft a camera-ready script.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowControlsDrawer(true)}
                    className="px-3 py-1.5 rounded-lg bg-[#6366F1] text-white text-xs font-semibold hover:bg-[#5558E6]"
                  >
                    Write or Generate Script
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeScript(DEFAULT_TELEPROMPTER_SCRIPT);
                      handleResetToTop();
                    }}
                    className="px-3 py-1.5 rounded-lg border border-white/20 text-white text-xs hover:bg-white/10"
                  >
                    Load Sample
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Optional concise AI delivery coaching footer when available */}
        {deliveryTip && (
          <div className="px-3 py-1.5 border-t border-white/10 bg-[#080B14]/70 flex items-center justify-between gap-2 text-[11px] text-cyan-200">
            <span className="truncate">Delivery Tip: {deliveryTip}</span>
            <button
              type="button"
              onClick={() => setDeliveryTip(null)}
              className="text-slate-400 hover:text-white shrink-0"
              aria-label="Dismiss tip"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
