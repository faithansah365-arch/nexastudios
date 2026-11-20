import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Film,
  FlipHorizontal,
  Focus,
  Maximize2,
  Move,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Upload,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { AutoFrameTracker } from '../engine/autoFrame';
import {
  computeAutoFixPatch,
  scanVideoClipQuality,
  type QualityReport,
} from '../engine/qualityControl';
import { StudioSegmenter, type SegmentationMode } from '../engine/segmentation';
import { analyzeBackgroundStats, getAspectDimensions, renderStudioFrame } from '../engine/studioRenderer';
import { detectBrowserCapabilities, formatDuration, loadImageElement } from '../engine/videoCapabilities';
import { apiRequest, ApiError } from '../lib/api';
import type {
  AspectRatio,
  BrandingConfig,
  CameraMotionMode,
  CinematicConfig,
  ColorGradePreset,
  CustomStudio,
  ExportResolution,
  ForegroundMaskConfig,
  LightingPreset,
  SceneTransitionMode,
  StudioTemplate,
  SubjectConfig,
} from '../../shared/types';

function clampNum(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

const DEFAULT_CINEMATIC: CinematicConfig = {
  motionMode: 'none',
  motionIntensity: 0.45,
  colorGrade: 'natural',
  sceneTransition: 'none',
  bgHorizonShift: 0,
  bgPerspectiveZoom: 1.04,
};

const DEFAULT_SUBJECT: SubjectConfig = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  colorTemp: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  bgBlur: 3,
  edgeSoftness: 2,
  edgeChoke: 0.34,
  bodySensitivity: 0.68,
  lightWrap: 0.32,
  temporalStability: 0.7,
  autoColorMatch: true,
  colorMatchStrength: 0.72,
  exposureMatch: 0.65,
  fgSharpness: 0,
  autoStudioMode: true,
  cinematic: DEFAULT_CINEMATIC,
  shadowIntensity: 0.24,
  chromaKeyEnabled: false,
  chromaKeyColor: '#00b140',
  chromaSimilarity: 0.24,
  chromaSmoothness: 0.08,
};

export function VideoTransformPage() {
  const { plan, refreshAuth } = useAuth();
  const caps = detectBrowserCapabilities();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const segmenterRef = useRef<StudioSegmenter | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceCreatedRef = useRef(false);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Editing controls
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolution, setResolution] = useState<ExportResolution>('1080p');
  const [segMode, setSegMode] = useState<SegmentationMode>('mediapipe');
  const [mirrorVideo, setMirrorVideo] = useState(false);
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('neutral');
  const [autoFrameEnabled, setAutoFrameEnabled] = useState(false);
  const [autoFrameDetected, setAutoFrameDetected] = useState(false);
  const [controlMode, setControlMode] = useState<'auto' | 'advanced'>('auto');
  const [liveWarning, setLiveWarning] = useState<string | null>(null);

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

  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [customStudios, setCustomStudios] = useState<CustomStudio[]>([]);
  const [selectedBgUrl, setSelectedBgUrl] = useState('/src/assets/images/bg_news_broadcast_1795098704414.jpg');

  const [subjectConfig, setSubjectConfig] = useState<SubjectConfig>(DEFAULT_SUBJECT);

  const [fgConfig, setFgConfig] = useState<ForegroundMaskConfig>({
    enabled: true,
    deskHeightRatio: 0.24,
    deskStyle: 'news_glass',
    perspectiveTilt: 0,
    deskOpacity: 0.96,
  });

  const [branding, setBranding] = useState<BrandingConfig>({
    logoPosition: 'top-right',
    primaryColor: '#6366F1',
    secondaryColor: '#06B6D4',
    screenText: '',
    showScreenGraphic: false,
    lowerThirdTitle: '',
    lowerThirdSubtitle: '',
    showLowerThird: false,
  });

  // Quality Control state
  const [qcScanning, setQcScanning] = useState(false);
  const [qcProgress, setQcProgress] = useState(0);
  const [qcReport, setQcReport] = useState<QualityReport | null>(null);
  const qcCancelledRef = useRef(false);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const cancelledRef = useRef(false);

  // Respect plan max export resolution
  useEffect(() => {
    const maxRes = plan?.limits.maxExportResolution ?? '720p';
    if (maxRes === '720p' && resolution !== '720p') {
      setResolution('720p');
    }
  }, [plan, resolution]);

  const liveSceneRef = useRef({
    aspectRatio,
    resolution,
    segMode,
    subjectConfig,
    fgConfig,
    branding,
    lightingPreset,
    mirrorVideo,
    autoFrameEnabled,
    trimStart,
    watermarkRequired: plan?.limits.watermarkRequired ?? true,
  });

  useEffect(() => {
    liveSceneRef.current = {
      aspectRatio,
      resolution,
      segMode,
      subjectConfig,
      fgConfig,
      branding,
      lightingPreset,
      mirrorVideo,
      autoFrameEnabled,
      trimStart,
      watermarkRequired: plan?.limits.watermarkRequired ?? true,
    };
  }, [
    aspectRatio,
    resolution,
    segMode,
    subjectConfig,
    fgConfig,
    branding,
    lightingPreset,
    mirrorVideo,
    autoFrameEnabled,
    trimStart,
    plan,
  ]);

  const toggleAutoFrame = () => {
    setAutoFrameEnabled((prev) => {
      const next = !prev;
      autoFrameTrackerRef.current?.reset();
      if (!next) setAutoFrameDetected(false);
      return next;
    });
  };

  useEffect(() => {
    Promise.all([
      apiRequest<{ templates: StudioTemplate[] }>('/api/templates'),
      apiRequest<{ studios: CustomStudio[] }>('/api/studios').catch(() => ({ studios: [] })),
    ]).then(([t, s]) => {
      const avail = t.templates.filter((x) => x.isAvailable);
      setTemplates(avail);
      setCustomStudios(s.studios);
      if (avail.length > 0) {
        setSelectedBgUrl(avail[0].backgroundUrl);
        setLightingPreset(avail[0].lightingPreset);
      }
    });

    const seg = new StudioSegmenter();
    segmenterRef.current = seg;
    seg.initMediaPipe().then((ok) => {
      if (!ok) setSegMode('chroma_key');
    });

    return () => {
      qcCancelledRef.current = true;
      seg.dispose();
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, []);

  useEffect(() => {
    loadImageElement(selectedBgUrl).then((img) => {
      bgImgRef.current = img;
    });
    const matchedTpl = templates.find((t) => t.backgroundUrl === selectedBgUrl);
    if (matchedTpl) {
      setLightingPreset(matchedTpl.lightingPreset);
      setFgConfig(matchedTpl.foregroundMaskConfig);
    }
  }, [selectedBgUrl, templates]);

  useEffect(() => {
    if (branding.logoUrl) {
      loadImageElement(branding.logoUrl).then((img) => {
        logoImgRef.current = img;
      });
    } else {
      logoImgRef.current = null;
    }
  }, [branding.logoUrl]);

  // Keep <video> element unmuted once routed to AudioContext so Web Audio GainNode drives volume cleanly
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = muted ? 0 : volume;
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = 1;
      }
    } else if (videoRef.current) {
      videoRef.current.volume = muted ? 0 : volume;
      videoRef.current.muted = muted;
    }
  }, [volume, muted]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    setExportStatus(null);
    setQcReport(null);
    setLiveWarning(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const maxMb = plan?.limits.maxUploadMb ?? 100;
    if (file.size > maxMb * 1024 * 1024) {
      setFileError(
        `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds your ${plan?.name || 'Free'} plan limit of ${maxMb} MB.`
      );
      return;
    }
    if (!file.type.startsWith('video/')) {
      setFileError('Please select a valid video file (MP4 or WebM supported by your browser).');
      return;
    }

    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    segmenterRef.current?.resetTemporalState();
    setVideoUrl(url);
    setVideoName(file.name.replace(/\.[^.]+$/, ''));
    setPlaying(false);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiRequest<{ url: string }>('/api/studios/upload-image', {
          method: 'POST',
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        setBranding((b) => ({ ...b, logoUrl: res.url }));
      } catch (err) {
        setFileError(err instanceof Error ? err.message : 'Logo upload failed.');
      }
    };
    reader.readAsDataURL(file);
  };

  // Continuous synchronized render loop for preview & export
  useEffect(() => {
    let rafId = 0;
    let lastAutoFrameUiSync = 0;
    let lastWarningSync = 0;

    const render = (now: number) => {
      rafId = requestAnimationFrame(render);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const seg = segmenterRef.current;
      if (!canvas) return;

      const s = liveSceneRef.current;
      const dims = getAspectDimensions(s.aspectRatio, s.resolution === '4k' ? '1080p' : s.resolution);
      if (canvas.width !== dims.width || canvas.height !== dims.height) {
        canvas.width = dims.width;
        canvas.height = dims.height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let subjectCanvas: HTMLCanvasElement | null = null;
      if (video && videoUrl && video.readyState >= 2 && seg && !qcScanning) {
        subjectCanvas = seg.extractSubjectCanvas(video, s.segMode, {
          lowPowerMode: caps.lowPowerRecommended && s.resolution === '720p',
          edgeSoftness: s.subjectConfig.edgeSoftness,
          edgeChoke: s.subjectConfig.edgeChoke ?? 0.34,
          bodySensitivity: s.subjectConfig.bodySensitivity ?? 0.68,
          temporalStability: s.subjectConfig.temporalStability ?? 0.7,
          detectSilhouette: true,
          chromaColor: s.subjectConfig.chromaKeyColor,
          chromaSimilarity: s.subjectConfig.chromaSimilarity,
          chromaSmoothness: s.subjectConfig.chromaSmoothness,
          timestampMs: now,
        });

        if (now - lastWarningSync >= 400) {
          lastWarningSync = now;
          const health = seg.lastDiagnostics.health;
          if (health.state === 'flagged' && s.segMode !== 'original') {
            setLiveWarning(health.issueReason || 'Matting instability detected on current frame.');
          } else {
            setLiveWarning(null);
          }
        }

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
              mirrorCamera: s.mirrorVideo,
              deskEnabled: s.fgConfig.enabled && s.fgConfig.deskStyle !== 'none',
              deskHeightRatio: s.fgConfig.deskHeightRatio,
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

      const clipTimeMs = video && videoUrl ? Math.max(0, (video.currentTime - s.trimStart) * 1000) : now;

      renderStudioFrame(ctx, canvas.width, canvas.height, {
        backgroundImg: bgImgRef.current,
        customMaskImg: null,
        logoImg: logoImgRef.current,
        subjectCanvas,
        fgStats: seg?.lastDiagnostics.fgStats ?? null,
        timeMs: clipTimeMs,
        subjectConfig: s.subjectConfig,
        foregroundMaskConfig: s.fgConfig,
        brandingConfig: s.branding,
        lightingPreset: s.lightingPreset,
        aspectRatio: s.aspectRatio,
        mirrorCamera: s.mirrorVideo,
        watermarkRequired: s.watermarkRequired,
      });
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [videoUrl, caps.lowPowerRecommended, qcScanning]);

  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    if (v.paused) {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
        v.currentTime = trimStart;
        segmenterRef.current?.resetTemporalState();
      }
      await v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const ensureAudioGraph = (): MediaStreamAudioDestinationNode | null => {
    const video = videoRef.current;
    if (!video) return null;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    if (!mediaSourceCreatedRef.current) {
      video.muted = false;
      video.volume = 1;
      const source = audioCtxRef.current.createMediaElementSource(video);
      const gain = audioCtxRef.current.createGain();
      gain.gain.value = muted ? 0 : volume;
      const dest = audioCtxRef.current.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(audioCtxRef.current.destination);
      gain.connect(dest);
      gainNodeRef.current = gain;
      destNodeRef.current = dest;
      mediaSourceCreatedRef.current = true;
    }
    return destNodeRef.current;
  };

  const handleRunQualityCheck = async () => {
    if (!videoUrl || !segmenterRef.current || qcScanning || exporting) return;
    const video = videoRef.current;
    if (video && !video.paused) {
      video.pause();
      setPlaying(false);
    }

    qcCancelledRef.current = false;
    setQcScanning(true);
    setQcProgress(0);
    setQcReport(null);

    try {
      const report = await scanVideoClipQuality({
        videoUrl,
        trimStart,
        trimEnd: Math.max(trimStart + 0.5, trimEnd),
        segmenter: segmenterRef.current,
        ctx: {
          segMode,
          subjectConfig,
          fgConfig,
          bgStats: analyzeBackgroundStats(bgImgRef.current),
          lightingPreset,
        },
        onProgress: (pct) => setQcProgress(pct),
        isCancelled: () => qcCancelledRef.current,
      });
      setQcReport(report);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Unable to run pre-export quality scan.');
    } finally {
      setQcScanning(false);
    }
  };

  const handleApplyAutoStudio = () => {
    setSubjectConfig((c) => ({
      ...c,
      autoStudioMode: true,
      autoColorMatch: true,
      colorMatchStrength: 0.74,
      exposureMatch: 0.68,
      edgeChoke: 0.34,
      bodySensitivity: 0.68,
      temporalStability: 0.74,
      edgeSoftness: 2,
      lightWrap: 0.34,
      fgSharpness: 0,
      shadowIntensity: 0.24,
    }));
    setQcReport(null);
  };

  const handleApplySuggestedFixes = () => {
    if (!qcReport) return;
    const patch = computeAutoFixPatch(qcReport, subjectConfig);
    setSubjectConfig((c) => ({ ...c, ...patch }));
    if (qcReport.issues.some((i) => i.category === 'framing_perspective')) {
      setAutoFrameEnabled(true);
      autoFrameTrackerRef.current?.reset();
    }
    // Clear stale report so user runs a genuine verification scan
    setQcReport(null);
  };

  const handleExportTransformedVideo = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !videoUrl) return;
    if (!caps.mediaRecorderSupported || !caps.supportedMimeType) {
      setExportStatus({ type: 'error', msg: 'MediaRecorder is not supported in this browser.' });
      return;
    }

    const duration = Math.max(1, trimEnd - trimStart);
    setExportStatus(null);
    setExporting(true);
    setExportProgress(0);
    cancelledRef.current = false;

    let exportId: string | null = null;
    try {
      const authRes = await apiRequest<{ exportRecord: { id: string } }>('/api/exports/authorize', {
        method: 'POST',
        body: JSON.stringify({
          title: `${videoName || 'Transformed Video'}`,
          resolution,
          aspectRatio,
          format: caps.supportedMimeType,
          durationSeconds: Math.round(duration),
        }),
      });
      exportId = authRes.exportRecord.id;

      const audioDest = ensureAudioGraph();
      const canvasStream = canvas.captureStream(30);
      const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
      if (audioDest && !muted) {
        audioDest.stream.getAudioTracks().forEach((t) => tracks.push(t));
      }

      const chunks: Blob[] = [];
      const bitrate = resolution === '1080p' ? 8_000_000 : 3_200_000;
      const recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: caps.supportedMimeType,
        videoBitsPerSecond: bitrate,
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      await new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error('Video recording interrupted during export.'));

        segmenterRef.current?.resetTemporalState();
        video.currentTime = trimStart;
        video.onseeked = async () => {
          video.onseeked = null;
          recorder.start(500);
          await video.play();
          setPlaying(true);

          const poll = setInterval(() => {
            if (cancelledRef.current) {
              clearInterval(poll);
              video.pause();
              setPlaying(false);
              if (recorder.state !== 'inactive') recorder.stop();
              return;
            }
            const pct = Math.min(100, Math.round(((video.currentTime - trimStart) / duration) * 100));
            setExportProgress(pct);
            if (video.currentTime >= trimEnd || video.ended) {
              clearInterval(poll);
              video.pause();
              setPlaying(false);
              if (recorder.state !== 'inactive') recorder.stop();
            }
          }, 100);
        };
      });

      if (cancelledRef.current) {
        if (exportId) await apiRequest(`/api/exports/${exportId}/fail`, { method: 'POST' });
        await refreshAuth();
        setExportStatus({ type: 'error', msg: 'Export cancelled. Quota was refunded.' });
        return;
      }

      const blob = new Blob(chunks, { type: caps.supportedMimeType });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      const ext = caps.supportedMimeType.includes('mp4') ? 'mp4' : 'webm';
      a.download = `${(videoName || 'transformed-studio').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);

      await apiRequest('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          title: videoName || 'Transformed Video',
          type: 'video_transform',
          aspectRatio,
          durationSeconds: Math.round(duration),
          settings: { resolution, segMode, trimStart, trimEnd, cinematic: subjectConfig.cinematic },
        }),
      });

      await apiRequest(`/api/exports/${exportId}/complete`, { method: 'POST' });
      await refreshAuth();
      setExportStatus({ type: 'success', msg: `Transformed ${resolution} (30 fps) video exported and downloaded.` });
    } catch (err) {
      if (exportId) {
        await apiRequest(`/api/exports/${exportId}/fail`, { method: 'POST' }).catch(() => {});
        await refreshAuth();
      }
      setExportStatus({
        type: 'error',
        msg: err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Export failed.',
      });
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!videoUrl || !canvasRef.current) return;
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
    setFgConfig((f) => ({ ...f, enabled: false }));
    setSubjectConfig((c) => ({
      ...c,
      scale: 0.74,
      offsetX: 0,
      offsetY: 0,
      bodySensitivity: Math.max(c.bodySensitivity ?? 0.68, 0.8),
    }));
  };

  const handleResetFraming = () => {
    setAutoFrameEnabled(false);
    setAutoFrameDetected(false);
    setSubjectConfig((c) => ({
      ...c,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      cinematic: { ...DEFAULT_CINEMATIC, ...c.cinematic, bgHorizonShift: 0, bgPerspectiveZoom: 1.04 },
    }));
  };

  const cinematic = subjectConfig.cinematic ?? DEFAULT_CINEMATIC;
  const updateCinematic = (patch: Partial<CinematicConfig>) => {
    setSubjectConfig((c) => ({
      ...c,
      cinematic: { ...(c.cinematic ?? DEFAULT_CINEMATIC), ...patch },
    }));
  };

  return (
    <DashboardLayout title="Video Transformation">
      <div className="max-w-[1520px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-5">
        <video
          ref={videoRef}
          src={videoUrl || undefined}
          playsInline
          className="hidden"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration || 0;
            setVideoDuration(d);
            setTrimStart(0);
            setTrimEnd(d);
          }}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setCurrentTime(t);
            if (!exporting && trimEnd > 0 && t >= trimEnd) {
              e.currentTarget.pause();
              setPlaying(false);
            }
          }}
          onError={() => {
            setFileError('This browser cannot decode the selected video codec. Try an H.264 MP4 or VP8/VP9 WebM video.');
          }}
        />

        {/* Left: Canvas & Timeline */}
        <div className="xl:col-span-8 space-y-4">
          <div className="p-3 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold cursor-pointer hover:bg-[#5558E6] whitespace-nowrap">
              <Upload className="w-4 h-4" />
              <span>Upload Video (Max {plan?.limits.maxUploadMb ?? 100} MB)</span>
              <input type="file" accept="video/mp4,video/webm,video/*" onChange={handleFileUpload} className="hidden" />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {videoUrl && (
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={exporting || qcScanning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium whitespace-nowrap"
                >
                  {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{playing ? 'Pause' : 'Preview'}</span>
                </button>
              )}

              {videoUrl && (
                <button
                  type="button"
                  disabled={exporting || qcScanning}
                  onClick={handleRunQualityCheck}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#06B6D4]/50 bg-[#06B6D4]/10 text-[#06B6D4] text-xs font-semibold hover:bg-[#06B6D4]/20 disabled:opacity-50 whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{qcScanning ? `Scanning (${qcProgress}%)` : 'Run Quality Check'}</span>
                </button>
              )}

              {exporting ? (
                <button
                  type="button"
                  onClick={() => {
                    cancelledRef.current = true;
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold whitespace-nowrap"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span className="font-mono tabular-nums">Cancel ({exportProgress}%)</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!videoUrl || qcScanning}
                  onClick={handleExportTransformedVideo}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#10B981] text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Transformed Video</span>
                </button>
              )}
            </div>
          </div>

          {fileError && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-xs text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{fileError}</span>
            </div>
          )}

          {liveWarning && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-xs text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{liveWarning}</span>
            </div>
          )}

          {exportStatus && (
            <div
              className={`p-3.5 rounded-xl text-xs ${
                exportStatus.type === 'error'
                  ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                  : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              }`}
            >
              {exportStatus.msg}
            </div>
          )}

          {/* Pre-Export Quality Control Report */}
          {qcReport && (
            <div
              className={`p-4 rounded-xl border space-y-3 text-xs ${
                qcReport.overallStatus === 'failed'
                  ? 'bg-red-500/10 border-red-500/40 text-red-200'
                  : qcReport.overallStatus === 'warnings'
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
                  : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold">
                  {qcReport.overallStatus === 'passed' ? (
                    <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <span>
                    Quality Check:{' '}
                    {qcReport.overallStatus === 'passed'
                      ? 'Passed'
                      : qcReport.overallStatus === 'warnings'
                      ? 'Passed with Warnings'
                      : 'Review Flagged Sections'}
                  </span>
                </div>
                <div className="font-mono tabular-nums text-[11px] opacity-85">
                  {qcReport.metrics.framesAnalyzed} frames · {Math.round(qcReport.metrics.avgStability * 100)}% matte stability ·{' '}
                  {Math.round(qcReport.metrics.leakagePeak * 100)}% margin bleed
                </div>
              </div>

              <p className="text-xs opacity-90">{qcReport.summary}</p>

              {qcReport.issues.length > 0 && (
                <div className="space-y-2 pt-1">
                  {qcReport.issues.map((issue) => (
                    <div
                      key={issue.id}
                      className="p-2.5 rounded-lg bg-[#080B14]/70 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="font-medium text-white flex items-center gap-2">
                          <span className="font-mono tabular-nums text-[11px] text-[#06B6D4]">
                            {formatDuration(Math.round(issue.timestampStartSec))}–{formatDuration(Math.round(issue.timestampEndSec))}
                          </span>
                          <span>{issue.message}</span>
                        </div>
                        <div className="text-[11px] text-slate-300">{issue.suggestedFix}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (videoRef.current) {
                            videoRef.current.currentTime = issue.timestampStartSec;
                            setCurrentTime(issue.timestampStartSec);
                          }
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-medium shrink-0 whitespace-nowrap"
                      >
                        Jump to Section
                      </button>
                    </div>
                  ))}
                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleApplySuggestedFixes}
                      className="px-3 py-1.5 rounded-lg bg-[#06B6D4] text-slate-950 font-semibold text-[11px] hover:bg-cyan-400"
                    >
                      Apply Suggested Fixes (Then Re-Scan)
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#080B14] flex items-center justify-center min-h-[360px]">
            <canvas
              ref={canvasRef}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
              className={`max-h-[60vh] w-auto max-w-full block touch-none select-none ${
                videoUrl ? (isDraggingSubject ? 'cursor-grabbing' : 'cursor-grab') : ''
              } ${
                aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video w-full'
              }`}
            />
            {!videoUrl && (
              <div className="absolute inset-0 bg-[#080B14]/70 flex flex-col items-center justify-center p-6 text-center space-y-2">
                <Film className="w-8 h-8 text-[#06B6D4]" />
                <div className="font-display text-base font-semibold text-white">Upload a Video to Transform</div>
                <p className="text-xs text-slate-300 max-w-md">
                  Processed locally at zero cloud latency. Removes your room background cleanly and blends lighting, perspective, and shadows into the studio.
                </p>
              </div>
            )}
            {videoUrl && autoFrameEnabled && (
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-[#080B14]/85 border border-[#06B6D4]/50 text-[11px] font-medium text-white flex items-center gap-1.5 pointer-events-none">
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
                  ? 'Auto-Frame keeps you aligned'
                  : videoUrl
                  ? 'Drag subject on canvas to reposition'
                  : 'Adjust subject perspective'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={toggleAutoFrame}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-semibold transition-colors whitespace-nowrap ${
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
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#06B6D4]/15 text-[#06B6D4] border border-[#06B6D4]/30 font-semibold hover:bg-[#06B6D4]/25 whitespace-nowrap"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fit Full Body</span>
              </button>

              <button
                type="button"
                onClick={() => setFgConfig((f) => ({ ...f, enabled: !f.enabled }))}
                className={`px-2.5 py-1.5 rounded-lg border font-medium whitespace-nowrap ${
                  fgConfig.enabled
                    ? 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                }`}
              >
                {fgConfig.enabled ? 'Desk On' : 'Desk Off'}
              </button>

              <button
                type="button"
                onClick={() => setMirrorVideo((m) => !m)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-medium whitespace-nowrap ${
                  mirrorVideo
                    ? 'border-[#6366F1]/50 bg-[#6366F1]/10 text-[#6366F1]'
                    : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
                <span>{mirrorVideo ? 'Mirrored' : 'Flip'}</span>
              </button>

              <button
                type="button"
                onClick={handleResetFraming}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Trim & Audio Bar */}
          {videoUrl && (
            <div className="p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-[#6366F1]" />
                  <span>Trim Timeline ({formatDuration(trimStart)} – {formatDuration(trimEnd)})</span>
                </span>
                <span className="font-mono tabular-nums text-slate-500">
                  Playhead: {formatDuration(currentTime)} / {formatDuration(videoDuration)}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Start Time</span>
                    <span className="font-mono tabular-nums">{trimStart.toFixed(1)}s</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, trimEnd - 0.5)}
                    step={0.1}
                    value={trimStart}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setTrimStart(val);
                      if (videoRef.current) videoRef.current.currentTime = val;
                    }}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>End Time</span>
                    <span className="font-mono tabular-nums">{trimEnd.toFixed(1)}s</span>
                  </div>
                  <input
                    type="range"
                    min={Math.min(videoDuration, trimStart + 0.5)}
                    max={videoDuration}
                    step={0.1}
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 whitespace-nowrap"
                >
                  {muted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-[#10B981]" />}
                  <span>{muted ? 'Audio Muted' : 'Audio Active'}</span>
                </button>
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <span>Volume</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Studio & Editing Controls */}
        <aside className="xl:col-span-4 p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-4 text-xs h-fit">
          <div className="flex items-center justify-between gap-2">
            <div className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Studio &amp; Integration
            </div>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-[#080B14] border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setControlMode('auto')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  controlMode === 'auto'
                    ? 'bg-[#6366F1] text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Auto Studio
              </button>
              <button
                type="button"
                onClick={() => setControlMode('advanced')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  controlMode === 'advanced'
                    ? 'bg-[#06B6D4] text-slate-950'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Advanced
              </button>
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1">Project Title</label>
            <input
              value={videoName}
              onChange={(e) => setVideoName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              placeholder="Video title"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Aspect Ratio</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              >
                <option value="16:9">16:9 Widescreen</option>
                <option value="9:16">9:16 Vertical</option>
                <option value="1:1">1:1 Square</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Export Quality</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as ExportResolution)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              >
                <option value="720p">720p HD (30 fps)</option>
                <option value="1080p" disabled={plan?.limits.maxExportResolution === '720p'}>
                  1080p Full HD (30 fps) {plan?.limits.maxExportResolution === '720p' ? '· Creator+' : ''}
                </option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1">Studio Environment</label>
            <select
              value={selectedBgUrl}
              onChange={(e) => setSelectedBgUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.backgroundUrl}>
                  {t.name}
                </option>
              ))}
              {customStudios.map((s) => (
                <option key={s.id} value={s.backgroundUrl}>
                  {s.name} (Saved)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Segmentation</label>
              <select
                value={segMode}
                onChange={(e) => setSegMode(e.target.value as SegmentationMode)}
                className="w-full px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              >
                <option value="mediapipe">AI Studio Matting</option>
                <option value="chroma_key">Chroma Key</option>
                <option value="original">Original Video</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Lighting Profile</label>
              <select
                value={lightingPreset}
                onChange={(e) => setLightingPreset(e.target.value as LightingPreset)}
                className="w-full px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              >
                <option value="neutral">Studio Auto</option>
                <option value="warm_studio">Warm Tungsten</option>
                <option value="cool_broadcast">Cool Broadcast</option>
                <option value="dramatic">Dramatic Key</option>
              </select>
            </div>
          </div>

          {/* Essential Smart Controls (Shown in both Auto & Advanced) */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="p-2.5 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200">
                <Sparkles className="w-3.5 h-3.5 text-[#06B6D4]" />
                <span>One-click natural studio blend</span>
              </div>
              <button
                type="button"
                onClick={handleApplyAutoStudio}
                className="px-2.5 py-1 rounded bg-[#06B6D4] text-slate-950 font-semibold text-[11px] hover:bg-cyan-400 whitespace-nowrap"
              >
                Auto Balance
              </button>
            </div>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-medium">Auto Color &amp; Exposure Match</span>
              <input
                type="checkbox"
                checked={subjectConfig.autoColorMatch ?? true}
                onChange={(e) => setSubjectConfig((c) => ({ ...c, autoColorMatch: e.target.checked }))}
              />
            </label>

            <div>
              <div className="flex justify-between mb-1">
                <span>Background Depth Blur</span>
                <span className="font-mono tabular-nums">{subjectConfig.bgBlur} px</span>
              </div>
              <input
                type="range"
                min={0}
                max={16}
                step={1}
                value={subjectConfig.bgBlur}
                onChange={(e) => setSubjectConfig((c) => ({ ...c, bgBlur: Number(e.target.value) }))}
                className="w-full"
              />
            </div>

            {/* Cinematic Production Presets */}
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div>
                <label className="block font-medium mb-1">Camera Motion</label>
                <select
                  value={cinematic.motionMode}
                  onChange={(e) => updateCinematic({ motionMode: e.target.value as CameraMotionMode })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                >
                  <option value="none">Locked Tripod</option>
                  <option value="subtle_push_in">Subtle Push-In</option>
                  <option value="gentle_drift">Gentle Studio Drift</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Color Grade</label>
                <select
                  value={cinematic.colorGrade}
                  onChange={(e) => updateCinematic({ colorGrade: e.target.value as ColorGradePreset })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                >
                  <option value="natural">Natural Studio</option>
                  <option value="crisp_broadcast">Crisp Broadcast</option>
                  <option value="warm_cinema">Warm Cinema</option>
                  <option value="moody_studio">Moody Studio</option>
                  <option value="filmic">Filmic Curve</option>
                </select>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#6366F1]/10 border border-[#6366F1]/30 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Focus className="w-3.5 h-3.5 text-[#06B6D4]" />
                  <span>AI Auto-Frame</span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-[#94A3B8]">
                  Aligns scale &amp; perspective automatically.
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
          </div>

          {/* Advanced Precision Controls */}
          {controlMode === 'advanced' && (
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <Sliders className="w-3.5 h-3.5 text-[#06B6D4]" />
                <span>Advanced Matting &amp; Camera Calibration</span>
              </div>

              {[
                { key: 'bodySensitivity', label: 'Body & Hand Detection', min: 0, max: 1, step: 0.02, def: 0.68 },
                { key: 'temporalStability', label: 'Temporal Anti-Flicker', min: 0, max: 1, step: 0.02, def: 0.7 },
                { key: 'edgeChoke', label: 'Anti-Halo Edge Trim', min: 0, max: 1, step: 0.02, def: 0.34 },
                { key: 'edgeSoftness', label: 'Inward Edge Feather (px)', min: 0, max: 8, step: 1, def: 2 },
                { key: 'fgSharpness', label: 'Subject Edge Sharpness', min: -1, max: 1, step: 0.05, def: 0 },
                { key: 'lightWrap', label: 'Studio Light Wrap', min: 0, max: 0.85, step: 0.02, def: 0.32 },
                { key: 'colorMatchStrength', label: 'Auto Color Harmony', min: 0, max: 1, step: 0.02, def: 0.72 },
                { key: 'exposureMatch', label: 'Auto Exposure Balance', min: 0, max: 1, step: 0.02, def: 0.65 },
                { key: 'shadowIntensity', label: 'Grounded Contact Shadow', min: 0, max: 0.9, step: 0.05, def: 0.24 },
                { key: 'brightness', label: 'Manual Brightness', min: 0.6, max: 1.4, step: 0.02, def: 1 },
                { key: 'contrast', label: 'Manual Contrast', min: 0.6, max: 1.4, step: 0.02, def: 1 },
                { key: 'saturation', label: 'Manual Saturation', min: 0.2, max: 1.8, step: 0.02, def: 1 },
                { key: 'colorTemp', label: 'Manual Color Temp', min: -40, max: 40, step: 1, def: 0 },
              ].map((ctrl) => {
                const rawVal = subjectConfig[ctrl.key as keyof SubjectConfig];
                const val = typeof rawVal === 'number' ? rawVal : ctrl.def;
                return (
                  <div key={ctrl.key}>
                    <div className="flex justify-between mb-1">
                      <span>{ctrl.label}</span>
                      <span className="font-mono tabular-nums">
                        {Number.isInteger(ctrl.step) ? val : val.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={ctrl.min}
                      max={ctrl.max}
                      step={ctrl.step}
                      value={val}
                      onChange={(e) =>
                        setSubjectConfig((c) => ({ ...c, [ctrl.key]: Number(e.target.value) }))
                      }
                      className="w-full"
                    />
                  </div>
                );
              })}

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Horizon Offset</span>
                    <span className="font-mono tabular-nums">{Math.round(cinematic.bgHorizonShift * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={-0.12}
                    max={0.12}
                    step={0.01}
                    value={cinematic.bgHorizonShift}
                    onChange={(e) => updateCinematic({ bgHorizonShift: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Perspective Zoom</span>
                    <span className="font-mono tabular-nums">{cinematic.bgPerspectiveZoom.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.95}
                    max={1.3}
                    step={0.02}
                    value={cinematic.bgPerspectiveZoom}
                    onChange={(e) => updateCinematic({ bgPerspectiveZoom: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">Clip Entry Transition</label>
                <select
                  value={cinematic.sceneTransition}
                  onChange={(e) => updateCinematic({ sceneTransition: e.target.value as SceneTransitionMode })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                >
                  <option value="none">Direct Cut</option>
                  <option value="smooth_fade">Smooth Fade-In (0.65s)</option>
                </select>
              </div>
            </div>
          )}

          <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-medium">Foreground Desk</span>
              <input
                type="checkbox"
                checked={fgConfig.enabled}
                onChange={(e) => setFgConfig((f) => ({ ...f, enabled: e.target.checked }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">Lower Third</span>
              <input
                type="checkbox"
                checked={branding.showLowerThird}
                onChange={(e) => setBranding((b) => ({ ...b, showLowerThird: e.target.checked }))}
              />
            </div>
            {branding.showLowerThird && (
              <>
                <input
                  value={branding.lowerThirdTitle}
                  onChange={(e) => setBranding((b) => ({ ...b, lowerThirdTitle: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                  placeholder="Title text"
                />
                <input
                  value={branding.lowerThirdSubtitle}
                  onChange={(e) => setBranding((b) => ({ ...b, lowerThirdSubtitle: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                  placeholder="Subtitle text"
                />
              </>
            )}
            <label className="block pt-1">
              <span className="block font-medium mb-1">Add Brand Logo Overlay</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} className="text-[11px]" />
            </label>
          </div>
        </aside>
      </div>
    </DashboardLayout>
  );
}
