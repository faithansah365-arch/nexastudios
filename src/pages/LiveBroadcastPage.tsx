import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Camera,
  CheckSquare,
  Copy,
  ExternalLink,
  FlipHorizontal,
  Focus,
  Gauge,
  Lock,
  Maximize2,
  Move,
  Radio,
  RotateCcw,
  Save,
  Sliders,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { AutoFrameTracker } from '../engine/autoFrame';
import { StudioSegmenter } from '../engine/segmentation';
import { getAspectDimensions, renderStudioFrame } from '../engine/studioRenderer';
import { loadImageElement } from '../engine/videoCapabilities';
import { apiRequest } from '../lib/api';
import type { CustomStudio, ExportResolution, ForegroundMaskConfig, SubjectConfig } from '../../shared/types';

function clampNum(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

const DEFAULT_BROADCAST_SUBJECT: SubjectConfig = {
  scale: 0.95,
  offsetX: 0,
  offsetY: 0,
  colorTemp: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  bgBlur: 2,
  edgeSoftness: 2,
  edgeChoke: 0.3,
  bodySensitivity: 0.6,
  lightWrap: 0.28,
  shadowIntensity: 0.12,
  chromaKeyEnabled: false,
  chromaKeyColor: '#00b140',
  chromaSimilarity: 0.24,
  chromaSmoothness: 0.08,
};

const DEFAULT_BROADCAST_FG: ForegroundMaskConfig = {
  enabled: true,
  deskHeightRatio: 0.26,
  deskStyle: 'news_glass',
  perspectiveTilt: 0,
  deskOpacity: 0.96,
};

interface QualityProfileSpec {
  id: ExportResolution;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
  recommendedBitrateKbps: number;
  uploadRequirement: string;
  stabilityNote: string;
  fpsTarget: number;
}

const QUALITY_PROFILES: Record<ExportResolution, QualityProfileSpec> = {
  '720p': {
    id: '720p',
    label: '720p HD (High Stability)',
    shortLabel: '720p HD',
    width: 1280,
    height: 720,
    recommendedBitrateKbps: 3500,
    uploadRequirement: '5+ Mbps upload',
    stabilityNote: 'Lowest CPU & bandwidth use — best for unstable connections.',
    fpsTarget: 30,
  },
  '1080p': {
    id: '1080p',
    label: '1080p Full HD (Balanced)',
    shortLabel: '1080p FHD',
    width: 1920,
    height: 1080,
    recommendedBitrateKbps: 6000,
    uploadRequirement: '10+ Mbps upload',
    stabilityNote: 'Recommended broadcast quality for YouTube, Facebook & OBS.',
    fpsTarget: 30,
  },
  '4k': {
    id: '4k',
    label: '4K UHD (Maximum Detail)',
    shortLabel: '4K UHD',
    width: 3840,
    height: 2160,
    recommendedBitrateKbps: 14000,
    uploadRequirement: '22+ Mbps upload',
    stabilityNote: 'Ultra-sharp 2160p output — requires strong GPU & fiber upload.',
    fpsTarget: 30,
  },
};

export function LiveBroadcastPage() {
  const { plan } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const segRef = useRef<StudioSegmenter | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [studios, setStudios] = useState<CustomStudio[]>([]);
  const [selectedStudioId, setSelectedStudioId] = useState('');
  const [selectedStudio, setSelectedStudio] = useState<CustomStudio | null>(null);

  const [broadcastTitle, setBroadcastTitle] = useState('Sunday Live Service');
  const [destination, setDestination] = useState<'obs_youtube' | 'obs_facebook' | 'obs_twitch' | 'direct_rtmp'>('obs_youtube');
  const [qualityProfile, setQualityProfile] = useState<ExportResolution>('1080p');
  const [transparentKey, setTransparentKey] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [fps, setFps] = useState(0);
  const [subjectConfig, setSubjectConfig] = useState<SubjectConfig>(DEFAULT_BROADCAST_SUBJECT);
  const [fgEnabled, setFgEnabled] = useState(true);
  const [mirrorCamera, setMirrorCamera] = useState(true);
  const [savingFraming, setSavingFraming] = useState(false);
  const [framingSavedMsg, setFramingSavedMsg] = useState<string | null>(null);
  const [autoFrameEnabled, setAutoFrameEnabled] = useState(false);
  const [autoFrameDetected, setAutoFrameDetected] = useState(false);
  const autoFrameTrackerRef = useRef<AutoFrameTracker | null>(null);
  if (!autoFrameTrackerRef.current) {
    autoFrameTrackerRef.current = new AutoFrameTracker();
  }
  const [isDraggingSubject, setIsDraggingSubject] = useState(false);
  const dragOriginRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  } | null>(null);

  const liveSceneRef = useRef({
    subjectConfig,
    fgEnabled,
    mirrorCamera,
    autoFrameEnabled,
    selectedStudio,
    broadcastTitle,
    transparentKey,
    watermarkRequired: plan?.limits.watermarkRequired ?? true,
  });

  useEffect(() => {
    liveSceneRef.current = {
      subjectConfig,
      fgEnabled,
      mirrorCamera,
      autoFrameEnabled,
      selectedStudio,
      broadcastTitle,
      transparentKey,
      watermarkRequired: plan?.limits.watermarkRequired ?? true,
    };
  }, [subjectConfig, fgEnabled, mirrorCamera, autoFrameEnabled, selectedStudio, broadcastTitle, transparentKey, plan]);

  const toggleAutoFrame = useCallback(() => {
    setAutoFrameEnabled((prev) => {
      const next = !prev;
      autoFrameTrackerRef.current?.reset();
      if (!next) setAutoFrameDetected(false);
      return next;
    });
  }, []);

  const [checklist, setChecklist] = useState({
    camera: false,
    audio: false,
    lighting: false,
    obsSource: false,
  });

  const maxAllowedRes = plan?.limits.maxExportResolution ?? '720p';
  const isProfileUnlocked = useCallback(
    (res: ExportResolution): boolean => {
      if (res === '720p') return true;
      if (res === '1080p') return maxAllowedRes === '1080p' || maxAllowedRes === '4k';
      return maxAllowedRes === '4k';
    },
    [maxAllowedRes]
  );

  // Clamp selected quality profile if user is on a lower tier (e.g. Free plan -> 720p)
  useEffect(() => {
    if (!isProfileUnlocked(qualityProfile)) {
      setQualityProfile(maxAllowedRes);
    }
  }, [isProfileUnlocked, maxAllowedRes, qualityProfile]);

  const activeSpec = QUALITY_PROFILES[qualityProfile];

  useEffect(() => {
    apiRequest<{ studios: CustomStudio[] }>('/api/studios').then((d) => {
      setStudios(d.studios);
      if (d.studios.length > 0) {
        setSelectedStudioId(d.studios[0].id);
        setSelectedStudio(d.studios[0]);
      }
    });

    const seg = new StudioSegmenter();
    segRef.current = seg;
    void seg.initMediaPipe();

    return () => {
      seg.dispose();
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const found = studios.find((s) => s.id === selectedStudioId) || null;
    setSelectedStudio(found);
    if (found) {
      setSubjectConfig({
        ...DEFAULT_BROADCAST_SUBJECT,
        ...found.subjectConfig,
        edgeChoke: found.subjectConfig.edgeChoke ?? 0.3,
        bodySensitivity: found.subjectConfig.bodySensitivity ?? 0.6,
        lightWrap: found.subjectConfig.lightWrap ?? 0.28,
      });
      setFgEnabled(found.foregroundMaskConfig.enabled);
    }
    if (found?.backgroundUrl) {
      loadImageElement(found.backgroundUrl).then((img) => {
        bgImgRef.current = img;
      });
    } else {
      loadImageElement('/src/assets/images/bg_news_broadcast_1795098704414.jpg').then((img) => {
        bgImgRef.current = img;
      });
    }
  }, [selectedStudioId, studios]);

  useEffect(() => {
    let rafId = 0;
    let frameCount = 0;
    let lastFpsSample = performance.now();
    let lastAutoFrameUiSync = 0;
    const dims = getAspectDimensions('16:9', qualityProfile);

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const seg = segRef.current;
      if (!canvas) return;
      if (canvas.width !== dims.width || canvas.height !== dims.height) {
        canvas.width = dims.width;
        canvas.height = dims.height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const s = liveSceneRef.current;
      const baseFg = s.selectedStudio?.foregroundMaskConfig ?? DEFAULT_BROADCAST_FG;

      let subjectCanvas: HTMLCanvasElement | null = null;
      if (cameraActive && video && video.readyState >= 2 && seg) {
        subjectCanvas = seg.extractSubjectCanvas(video, 'mediapipe', {
          lowPowerMode: qualityProfile === '720p',
          edgeSoftness: s.subjectConfig.edgeSoftness ?? 2,
          edgeChoke: s.subjectConfig.edgeChoke ?? 0.3,
          bodySensitivity: s.subjectConfig.bodySensitivity ?? 0.6,
          detectSilhouette: s.autoFrameEnabled,
          chromaColor: '#00b140',
          chromaSimilarity: 0.24,
          chromaSmoothness: 0.08,
          timestampMs: now,
        });

        if (s.autoFrameEnabled && autoFrameTrackerRef.current) {
          const tracked = autoFrameTrackerRef.current.update(
            seg.lastSilhouetteBounds,
            {
              scale: s.subjectConfig.scale,
              offsetX: s.subjectConfig.offsetX,
              offsetY: s.subjectConfig.offsetY,
            },
            {
              canvasWidth: canvas.width,
              canvasHeight: canvas.height,
              sourceWidth: video.videoWidth || canvas.width,
              sourceHeight: video.videoHeight || canvas.height,
              mirrorCamera: s.mirrorCamera,
              deskEnabled: s.fgEnabled && baseFg.deskStyle !== 'none',
              deskHeightRatio: baseFg.deskHeightRatio,
            },
            now
          );
          s.subjectConfig = { ...s.subjectConfig, ...tracked.framing };
          if (now - lastAutoFrameUiSync >= 160) {
            lastAutoFrameUiSync = now;
            setAutoFrameDetected(tracked.detected);
            setSubjectConfig((prev) => ({ ...prev, ...tracked.framing }));
          }
        }
      }

      renderStudioFrame(ctx, dims.width, dims.height, {
        backgroundImg: bgImgRef.current,
        customMaskImg: null,
        logoImg: null,
        subjectCanvas,
        subjectConfig: s.subjectConfig,
        foregroundMaskConfig: { ...baseFg, enabled: s.fgEnabled },
        brandingConfig: s.selectedStudio?.brandingConfig ?? {
          logoPosition: 'top-right',
          primaryColor: '#6366F1',
          secondaryColor: '#06B6D4',
          screenText: s.broadcastTitle,
          showScreenGraphic: true,
          lowerThirdTitle: s.broadcastTitle,
          lowerThirdSubtitle: 'OBS Broadcast Output',
          showLowerThird: true,
        },
        lightingPreset: s.selectedStudio?.lightingPreset ?? 'neutral',
        aspectRatio: '16:9',
        mirrorCamera: s.mirrorCamera,
        watermarkRequired: s.watermarkRequired,
        transparentBackground: s.transparentKey,
      });

      frameCount += 1;
      if (now - lastFpsSample >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastFpsSample = now;
      }
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [cameraActive, qualityProfile]);

  const startPreview = async (targetProfile: ExportResolution = qualityProfile) => {
    setCameraError(null);
    const spec = QUALITY_PROFILES[targetProfile];
    const captureDims = getAspectDimensions('16:9', targetProfile === '4k' ? '1080p' : targetProfile);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: captureDims.width },
          height: { ideal: captureDims.height },
          frameRate: { ideal: spec.fpsTarget },
        },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setChecklist((c) => ({ ...c, camera: true, audio: true }));
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Unable to start camera preview.');
    }
  };

  const handleQualityChange = async (nextQuality: ExportResolution) => {
    if (!isProfileUnlocked(nextQuality)) return;
    setQualityProfile(nextQuality);
    if (cameraActive && streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      const captureDims = getAspectDimensions('16:9', nextQuality === '4k' ? '1080p' : nextQuality);
      if (videoTrack) {
        try {
          await videoTrack.applyConstraints({
            width: { ideal: captureDims.width },
            height: { ideal: captureDims.height },
            frameRate: { ideal: QUALITY_PROFILES[nextQuality].fpsTarget },
          });
        } catch {
          await startPreview(nextQuality);
        }
      }
    }
  };

  const stopPreview = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    setCameraActive(false);
    setFps(0);
  };

  const toggleObsShare = async (enabled: boolean) => {
    if (!selectedStudio) return;
    const res = await apiRequest<{ studio: CustomStudio }>(`/api/studios/${selectedStudio.id}`, {
      method: 'PUT',
      body: JSON.stringify({ obsShareEnabled: enabled }),
    });
    setStudios((prev) => prev.map((s) => (s.id === res.studio.id ? res.studio : s)));
    setSelectedStudio(res.studio);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!cameraActive || !canvasRef.current) return;
    if (autoFrameEnabled) {
      setAutoFrameEnabled(false);
      setAutoFrameDetected(false);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOriginRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origOffsetX: subjectConfig.offsetX,
      origOffsetY: subjectConfig.offsetY,
    };
    setIsDraggingSubject(true);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragOriginRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    setSubjectConfig((c) => ({
      ...c,
      offsetX: clampNum(Number((drag.origOffsetX + dx).toFixed(3)), -0.6, 0.6),
      offsetY: clampNum(Number((drag.origOffsetY + dy).toFixed(3)), -0.5, 0.5),
    }));
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragOriginRef.current?.pointerId === e.pointerId) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      dragOriginRef.current = null;
      setIsDraggingSubject(false);
    }
  };

  const handleFitFullBody = () => {
    setAutoFrameEnabled(false);
    setAutoFrameDetected(false);
    setFgEnabled(false);
    setSubjectConfig((c) => ({
      ...c,
      scale: 0.72,
      offsetX: 0,
      offsetY: 0,
      bodySensitivity: Math.max(c.bodySensitivity ?? 0.6, 0.78),
    }));
  };

  const handleResetFraming = () => {
    setAutoFrameEnabled(false);
    setAutoFrameDetected(false);
    setSubjectConfig((c) => ({
      ...c,
      scale: 0.95,
      offsetX: 0,
      offsetY: 0,
    }));
  };

  const handleSaveFramingToStudio = async () => {
    if (!selectedStudio) return;
    setSavingFraming(true);
    setFramingSavedMsg(null);
    try {
      const res = await apiRequest<{ studio: CustomStudio }>(`/api/studios/${selectedStudio.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          subjectConfig,
          foregroundMaskConfig: {
            ...selectedStudio.foregroundMaskConfig,
            enabled: fgEnabled,
          },
        }),
      });
      setStudios((prev) => prev.map((s) => (s.id === res.studio.id ? res.studio : s)));
      setSelectedStudio(res.studio);
      setFramingSavedMsg('Saved to studio & OBS output.');
      setTimeout(() => setFramingSavedMsg(null), 2500);
    } finally {
      setSavingFraming(false);
    }
  };

  const obsOutputUrl =
    selectedStudio?.obsShareEnabled && selectedStudio.obsShareToken
      ? `${window.location.origin}/obs/${selectedStudio.id}?token=${selectedStudio.obsShareToken}&res=${qualityProfile}${transparentKey ? '&transparent=1' : ''}`
      : '';

  return (
    <DashboardLayout title="Live Broadcast">
      <video ref={videoRef} playsInline muted className="hidden" />
      <div className="max-w-7xl mx-auto space-y-6">
        {!plan?.limits.obsWorkflow && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-400">
              <Lock className="w-4 h-4 shrink-0" />
              <span>
                OBS Broadcast Workflow is unlocked on Creator, Pro Studio, and Business plans. You can still preview
                your broadcast layout below.
              </span>
            </div>
            <Link to="/dashboard/subscription" className="px-4 py-1.5 rounded-lg bg-[#6366F1] text-white font-semibold shrink-0">
              Upgrade Plan
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-4">
            <div className="p-3 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={() => void startPreview()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Start Broadcast Preview</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopPreview}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
                  >
                    <Square className="w-3.5 h-3.5 text-red-400" />
                    <span>Stop Preview</span>
                  </button>
                )}

                <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-[#080B14] border border-slate-200 dark:border-slate-800 text-xs">
                  {(['720p', '1080p', '4k'] as ExportResolution[]).map((resKey) => {
                    const unlocked = isProfileUnlocked(resKey);
                    const active = qualityProfile === resKey;
                    return (
                      <button
                        key={resKey}
                        type="button"
                        disabled={!unlocked}
                        title={
                          unlocked
                            ? QUALITY_PROFILES[resKey].label
                            : resKey === '1080p'
                            ? 'Requires Creator plan or higher'
                            : 'Requires Business plan'
                        }
                        onClick={() => void handleQualityChange(resKey)}
                        className={`px-2.5 py-1 rounded font-semibold transition-colors ${
                          active
                            ? 'bg-[#06B6D4] text-slate-950'
                            : unlocked
                            ? 'text-slate-600 dark:text-slate-300 hover:text-white'
                            : 'text-slate-400 dark:text-slate-600 cursor-not-allowed'
                        }`}
                      >
                        {resKey.toUpperCase()}
                      </button>
                    );
                  })}
                </div>

                <label className="inline-flex items-center gap-2 text-xs pl-1">
                  <input
                    type="checkbox"
                    checked={transparentKey}
                    onChange={(e) => setTransparentKey(e.target.checked)}
                  />
                  <span>Transparent Key Output</span>
                </label>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {activeSpec.width}×{activeSpec.height} · ~{(activeSpec.recommendedBitrateKbps / 1000).toFixed(1)} Mbps
                {cameraActive ? ` · ${fps} FPS` : ' · Standby'}
              </span>
            </div>

            {cameraActive && fps > 0 && fps < 18 && qualityProfile !== '720p' && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2 text-xs text-amber-400">
                <span>
                  Preview running at {fps} FPS on {activeSpec.shortLabel}. Drop to 720p HD for smoother frame pacing and lower bandwidth usage.
                </span>
                <button
                  type="button"
                  onClick={() => void handleQualityChange('720p')}
                  className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-semibold shrink-0"
                >
                  Switch to 720p
                </button>
              </div>
            )}

            {cameraError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">{cameraError}</div>
            )}

            <div
              className={`relative aspect-video rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 ${
                transparentKey ? 'bg-[conic-gradient(#1e293b_90deg,#0f172a_90deg_180deg,#1e293b_180deg_270deg,#0f172a_270deg)] bg-[length:24px_24px]' : 'bg-[#080B14]'
              }`}
            >
              <canvas
                ref={canvasRef}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
                className={`w-full h-full object-contain touch-none select-none ${
                  cameraActive ? (isDraggingSubject ? 'cursor-grabbing' : 'cursor-grab') : ''
                }`}
              />
              {cameraActive && autoFrameEnabled && (
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-[#080B14]/80 border border-[#06B6D4]/50 text-[11px] font-medium text-white flex items-center gap-1.5 pointer-events-none">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      autoFrameDetected ? 'bg-[#10B981] animate-pulse' : 'bg-amber-400'
                    }`}
                  />
                  <span>{autoFrameDetected ? 'AI Auto-Frame · Tracking' : 'AI Auto-Frame · Searching'}</span>
                </div>
              )}
            </div>

            {/* Direct Stage Video Adjustment Bar */}
            <div className="px-3 py-2.5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-[#94A3B8]">
                <Move className="w-3.5 h-3.5 text-[#06B6D4]" />
                <span>
                  {autoFrameEnabled
                    ? 'Auto-Frame keeps you centered'
                    : cameraActive
                    ? 'Drag video to move'
                    : 'Adjust your broadcast framing'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleAutoFrame}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-semibold transition-colors ${
                    autoFrameEnabled
                      ? 'bg-[#6366F1] text-white border-[#6366F1]'
                      : 'bg-[#6366F1]/10 text-[#6366F1] border-[#6366F1]/30 hover:bg-[#6366F1]/20'
                  }`}
                >
                  <Focus className="w-3.5 h-3.5" />
                  <span>{autoFrameEnabled ? 'Auto-Frame On' : 'Auto-Frame'}</span>
                </button>

                <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <button
                    type="button"
                    title="Zoom Out (Show More Body)"
                    onClick={() => {
                      setAutoFrameEnabled(false);
                      setAutoFrameDetected(false);
                      setSubjectConfig((c) => ({ ...c, scale: clampNum(Number((c.scale - 0.05).toFixed(2)), 0.35, 2.0) }));
                    }}
                    className="px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="px-2 py-1 font-mono tabular-nums text-[11px] bg-slate-50 dark:bg-[#080B14]">
                    {Math.round(subjectConfig.scale * 100)}%
                  </span>
                  <button
                    type="button"
                    title="Zoom In"
                    onClick={() => {
                      setAutoFrameEnabled(false);
                      setAutoFrameDetected(false);
                      setSubjectConfig((c) => ({ ...c, scale: clampNum(Number((c.scale + 0.05).toFixed(2)), 0.35, 2.0) }));
                    }}
                    className="px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleFitFullBody}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#06B6D4]/15 text-[#06B6D4] border border-[#06B6D4]/30 font-semibold hover:bg-[#06B6D4]/25"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Fit Full Body</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFgEnabled((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-lg border font-medium ${
                    fgEnabled
                      ? 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                  }`}
                >
                  {fgEnabled ? 'Desk On' : 'Desk Off'}
                </button>

                <button
                  type="button"
                  onClick={() => setMirrorCamera((m) => !m)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-medium ${
                    mirrorCamera
                      ? 'border-[#6366F1]/50 bg-[#6366F1]/10 text-[#6366F1]'
                      : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                  <span>{mirrorCamera ? 'Mirrored' : 'Normal'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetFraming}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            {/* OBS & YouTube Live Guide */}
            <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                OBS Studio &amp; YouTube Live Configuration Guide
              </h2>
              <ol className="list-decimal list-inside space-y-2 text-slate-600 dark:text-[#94A3B8]">
                <li>Save a custom studio in Studio Designer or AI Studio Generator so it appears in the Studio dropdown.</li>
                <li>Select your Output Quality Profile ({activeSpec.shortLabel}) to match your upload connection ({activeSpec.uploadRequirement}) and enable Clean OBS Browser Output.</li>
                <li>
                  In OBS Studio, add a <strong>Browser Source</strong> set to{' '}
                  <span className="font-mono text-slate-200">
                    {activeSpec.width}×{activeSpec.height}
                  </span>{' '}
                  pointing to your clean output URL, or capture this window via Window Capture.
                </li>
                <li>In OBS Settings → Output / Stream, set video bitrate around <span className="font-mono text-slate-200">{activeSpec.recommendedBitrateKbps} kbps</span>, select <strong>YouTube - RTMPS</strong> (or Twitch / Facebook Live), and enter your private stream key inside OBS.</li>
              </ol>
            </div>
          </div>

          <aside className="lg:col-span-4 space-y-4 text-xs">
            <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-4">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-[#06B6D4]" />
                <span>Broadcast Setup</span>
              </h2>

              <div>
                <label className="block font-medium mb-1">Broadcast Title</label>
                <input
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">Saved Studio</label>
                {studios.length === 0 ? (
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-200 dark:border-slate-800">
                    No saved studios yet.{' '}
                    <Link to="/dashboard/studio-designer" className="text-[#6366F1] font-semibold underline">
                      Create one in Studio Designer
                    </Link>{' '}
                    to generate a tokenized OBS URL.
                  </div>
                ) : (
                  <select
                    value={selectedStudioId}
                    onChange={(e) => setSelectedStudioId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                  >
                    {studios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block font-medium mb-1.5 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-[#06B6D4]" />
                  <span>Output Quality Profile</span>
                </label>
                <div className="space-y-1.5">
                  {(['720p', '1080p', '4k'] as ExportResolution[]).map((resKey) => {
                    const spec = QUALITY_PROFILES[resKey];
                    const unlocked = isProfileUnlocked(resKey);
                    const selected = qualityProfile === resKey;
                    return (
                      <button
                        key={resKey}
                        type="button"
                        disabled={!unlocked}
                        onClick={() => void handleQualityChange(resKey)}
                        className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                          selected
                            ? 'border-[#06B6D4] bg-[#06B6D4]/10'
                            : unlocked
                            ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080B14] hover:border-slate-500'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#080B14]/50 opacity-55 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">{spec.label}</span>
                          <span className="font-mono text-[11px] text-[#06B6D4] shrink-0">
                            {unlocked ? spec.uploadRequirement : resKey === '1080p' ? 'Creator+' : 'Business'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-[#94A3B8] mt-0.5">
                          {spec.width}×{spec.height} · ~{spec.recommendedBitrateKbps} kbps · {spec.stabilityNote}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">Streaming Pipeline</label>
                <select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value as typeof destination)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                >
                  <option value="obs_youtube">OBS Studio → YouTube Live (Supported)</option>
                  <option value="obs_facebook">OBS Studio → Facebook Live (Supported)</option>
                  <option value="obs_twitch">OBS Studio → Twitch (Supported)</option>
                  <option value="direct_rtmp">Direct Browser RTMP / Multistreaming (Unavailable)</option>
                </select>
              </div>

              {destination === 'direct_rtmp' && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2 text-amber-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Direct browser-to-RTMP ingest and multistreaming require a dedicated media relay server (FFmpeg/WebRTC
                    ingest) and are not enabled in this zero-budget deployment. Use OBS Studio with the clean output URL below.
                  </span>
                </div>
              )}

              {/* Video & Body Framing Controls */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium flex items-center gap-1.5 text-slate-900 dark:text-white">
                    <Sliders className="w-3.5 h-3.5 text-[#06B6D4]" />
                    <span>Adjust Video &amp; Framing</span>
                  </span>
                  {selectedStudio && (
                    <button
                      type="button"
                      disabled={savingFraming}
                      onClick={() => void handleSaveFramingToStudio()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#6366F1] text-white font-semibold text-[11px] hover:bg-[#5558E6] disabled:opacity-50"
                    >
                      <Save className="w-3 h-3" />
                      <span>{savingFraming ? 'Saving...' : 'Save to Studio'}</span>
                    </button>
                  )}
                </div>
                {framingSavedMsg && (
                  <div className="text-[11px] text-emerald-400">{framingSavedMsg}</div>
                )}

                <div className="p-2.5 rounded-lg bg-[#6366F1]/10 border border-[#6366F1]/30 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Focus className="w-3.5 h-3.5 text-[#06B6D4]" />
                      <span>AI Auto-Frame</span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-[#94A3B8]">
                      Dynamically tracks &amp; centers your silhouette.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleAutoFrame}
                    className={`px-2.5 py-1 rounded font-semibold shrink-0 transition-colors ${
                      autoFrameEnabled ? 'bg-[#10B981] text-white' : 'bg-[#6366F1] text-white hover:bg-[#5558E6]'
                    }`}
                  >
                    {autoFrameEnabled ? 'Active' : 'Enable'}
                  </button>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span>Subject Scale</span>
                    <span className="font-mono">{subjectConfig.scale.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.35}
                    max={2.0}
                    step={0.02}
                    value={subjectConfig.scale}
                    onChange={(e) => {
                      setAutoFrameEnabled(false);
                      setAutoFrameDetected(false);
                      setSubjectConfig((c) => ({ ...c, scale: Number(e.target.value) }));
                    }}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Horizontal Position</span>
                    <span className="font-mono">{Math.round(subjectConfig.offsetX * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={-0.6}
                    max={0.6}
                    step={0.01}
                    value={subjectConfig.offsetX}
                    onChange={(e) => {
                      setAutoFrameEnabled(false);
                      setAutoFrameDetected(false);
                      setSubjectConfig((c) => ({ ...c, offsetX: Number(e.target.value) }));
                    }}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Vertical Position</span>
                    <span className="font-mono">{Math.round(subjectConfig.offsetY * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={-0.5}
                    max={0.5}
                    step={0.01}
                    value={subjectConfig.offsetY}
                    onChange={(e) => {
                      setAutoFrameEnabled(false);
                      setAutoFrameDetected(false);
                      setSubjectConfig((c) => ({ ...c, offsetY: Number(e.target.value) }));
                    }}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Body Detection Boost (Hands &amp; Arms)</span>
                    <span className="font-mono">{Math.round((subjectConfig.bodySensitivity ?? 0.6) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={subjectConfig.bodySensitivity ?? 0.6}
                    onChange={(e) => setSubjectConfig((c) => ({ ...c, bodySensitivity: Number(e.target.value) }))}
                    className="w-full"
                  />
                </div>
              </div>

              {selectedStudio && plan?.limits.obsWorkflow && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Clean OBS Browser Source</span>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedStudio.obsShareEnabled)}
                      onChange={(e) => toggleObsShare(e.target.checked)}
                    />
                  </div>
                  {obsOutputUrl && (
                    <div className="space-y-2">
                      <input
                        readOnly
                        value={obsOutputUrl}
                        className="w-full px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 font-mono text-[11px]"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(obsOutputUrl);
                            setCopiedUrl(true);
                            setTimeout(() => setCopiedUrl(false), 1800);
                          }}
                          className="flex-1 py-1.5 px-3 rounded-lg bg-[#6366F1] text-white font-semibold inline-flex items-center justify-center gap-1.5"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>{copiedUrl ? 'Copied' : 'Copy OBS URL'}</span>
                        </button>
                        <a
                          href={obsOutputUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 inline-flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Open</span>
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pre-Broadcast Checklist */}
            <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="font-display text-sm font-semibold flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-[#10B981]" />
                <span>Pre-Broadcast Checklist</span>
              </div>
              {[
                { key: 'camera', label: 'Camera framing verified behind desk' },
                { key: 'audio', label: 'Microphone level active and unmuted' },
                { key: 'lighting', label: 'Front subject lighting balanced for segmentation' },
                { key: 'obsSource', label: 'OBS Browser Source / RTMP stream key tested' },
              ].map((item) => (
                <label key={item.key} className="flex items-center gap-2.5 cursor-pointer text-slate-600 dark:text-[#94A3B8]">
                  <input
                    type="checkbox"
                    checked={checklist[item.key as keyof typeof checklist]}
                    onChange={(e) =>
                      setChecklist((c) => ({ ...c, [item.key]: e.target.checked }))
                    }
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}
