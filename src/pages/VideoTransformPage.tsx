import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Film,
  FlipHorizontal,
  Maximize2,
  Move,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Square,
  Upload,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { StudioSegmenter, type SegmentationMode } from '../engine/segmentation';
import { getAspectDimensions, renderStudioFrame } from '../engine/studioRenderer';
import { detectBrowserCapabilities, formatDuration, loadImageElement } from '../engine/videoCapabilities';
import { apiRequest, ApiError } from '../lib/api';
import type {
  AspectRatio,
  BrandingConfig,
  CustomStudio,
  ExportResolution,
  ForegroundMaskConfig,
  StudioTemplate,
  SubjectConfig,
} from '../../shared/types';

function clampNum(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

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
  const [resolution, setResolution] = useState<ExportResolution>('720p');
  const [segMode, setSegMode] = useState<SegmentationMode>('mediapipe');
  const [mirrorVideo, setMirrorVideo] = useState(false);
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
  const [selectedBgUrl, setSelectedBgUrl] = useState('/src/assets/images/studio_news_desk_1795011533684.jpg');

  const [subjectConfig, setSubjectConfig] = useState<SubjectConfig>({
    scale: 1,
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
  });

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

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    Promise.all([
      apiRequest<{ templates: StudioTemplate[] }>('/api/templates'),
      apiRequest<{ studios: CustomStudio[] }>('/api/studios').catch(() => ({ studios: [] })),
    ]).then(([t, s]) => {
      const avail = t.templates.filter((x) => x.isAvailable);
      setTemplates(avail);
      setCustomStudios(s.studios);
      if (avail.length > 0) setSelectedBgUrl(avail[0].backgroundUrl);
    });

    const seg = new StudioSegmenter();
    segmenterRef.current = seg;
    seg.initMediaPipe().then((ok) => {
      if (!ok) setSegMode('chroma_key');
    });

    return () => {
      seg.dispose();
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, []);

  useEffect(() => {
    loadImageElement(selectedBgUrl).then((img) => {
      bgImgRef.current = img;
    });
  }, [selectedBgUrl]);

  useEffect(() => {
    if (branding.logoUrl) {
      loadImageElement(branding.logoUrl).then((img) => {
        logoImgRef.current = img;
      });
    } else {
      logoImgRef.current = null;
    }
  }, [branding.logoUrl]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = muted ? 0 : volume;
    }
    if (videoRef.current) {
      videoRef.current.volume = muted ? 0 : volume;
      videoRef.current.muted = muted;
    }
  }, [volume, muted]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    setExportStatus(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const maxMb = plan?.limits.maxUploadMb ?? 100;
    if (file.size > maxMb * 1024 * 1024) {
      setFileError(`File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds your ${plan?.name || 'Free'} plan limit of ${maxMb} MB.`);
      return;
    }
    if (!file.type.startsWith('video/')) {
      setFileError('Please select a valid video file (MP4 or WebM supported by your browser).');
      return;
    }

    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
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

  // Continuous render loop while video is loaded
  useEffect(() => {
    let rafId = 0;
    const render = (now: number) => {
      rafId = requestAnimationFrame(render);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const seg = segmenterRef.current;
      if (!canvas) return;

      const dims = getAspectDimensions(aspectRatio, resolution === '4k' ? '1080p' : resolution);
      if (canvas.width !== dims.width || canvas.height !== dims.height) {
        canvas.width = dims.width;
        canvas.height = dims.height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let subjectCanvas: HTMLCanvasElement | null = null;
      if (video && videoUrl && video.readyState >= 2 && seg) {
        subjectCanvas = seg.extractSubjectCanvas(video, segMode, {
          lowPowerMode: caps.lowPowerRecommended,
          edgeSoftness: subjectConfig.edgeSoftness,
          edgeChoke: subjectConfig.edgeChoke ?? 0.3,
          bodySensitivity: subjectConfig.bodySensitivity ?? 0.6,
          chromaColor: subjectConfig.chromaKeyColor,
          chromaSimilarity: subjectConfig.chromaSimilarity,
          chromaSmoothness: subjectConfig.chromaSmoothness,
          timestampMs: now,
        });
      }

      renderStudioFrame(ctx, canvas.width, canvas.height, {
        backgroundImg: bgImgRef.current,
        customMaskImg: null,
        logoImg: logoImgRef.current,
        subjectCanvas,
        subjectConfig,
        foregroundMaskConfig: fgConfig,
        brandingConfig: branding,
        lightingPreset: 'neutral',
        aspectRatio,
        mirrorCamera: mirrorVideo,
        watermarkRequired: plan?.limits.watermarkRequired ?? true,
      });
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [videoUrl, aspectRatio, resolution, segMode, subjectConfig, fgConfig, branding, plan, mirrorVideo]);

  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    if (v.paused) {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
        v.currentTime = trimStart;
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
      const recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: caps.supportedMimeType,
        videoBitsPerSecond: resolution === '1080p' ? 5_000_000 : 2_800_000,
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      await new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error('Video recording interrupted during export.'));

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
          }, 150);
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
      a.download = `${(videoName || 'transformed-studio').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.webm`;
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
          settings: { resolution, segMode, trimStart, trimEnd },
        }),
      });

      await apiRequest(`/api/exports/${exportId}/complete`, { method: 'POST' });
      await refreshAuth();
      setExportStatus({ type: 'success', msg: 'Transformed video exported and downloaded.' });
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
    setFgConfig((f) => ({ ...f, enabled: false }));
    setSubjectConfig((c) => ({
      ...c,
      scale: 0.72,
      offsetX: 0,
      offsetY: 0,
      bodySensitivity: Math.max(c.bodySensitivity ?? 0.6, 0.78),
    }));
  };

  const handleResetFraming = () => {
    setSubjectConfig((c) => ({
      ...c,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }));
  };

  return (
    <DashboardLayout title="Video Transformation">
      <div className="max-w-[1500px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-5">
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
            <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold cursor-pointer hover:bg-[#5558E6]">
              <Upload className="w-4 h-4" />
              <span>Upload Video (Max {plan?.limits.maxUploadMb ?? 100} MB)</span>
              <input type="file" accept="video/mp4,video/webm,video/*" onChange={handleFileUpload} className="hidden" />
            </label>

            <div className="flex items-center gap-2">
              {videoUrl && (
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
                >
                  {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{playing ? 'Pause' : 'Preview'}</span>
                </button>
              )}

              {exporting ? (
                <button
                  type="button"
                  onClick={() => {
                    cancelledRef.current = true;
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Cancel ({exportProgress}%)</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!videoUrl}
                  onClick={handleExportTransformedVideo}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#10B981] text-white text-xs font-semibold disabled:opacity-40"
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
                  Processed locally in your browser. Supported containers depend on your browser (MP4 H.264 / WebM VP8/VP9).
                </p>
              </div>
            )}
          </div>

          {/* Direct Stage Video Adjustment Bar */}
          <div className="px-3 py-2.5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-slate-500 dark:text-[#94A3B8]">
              <Move className="w-3.5 h-3.5 text-[#06B6D4]" />
              <span>{videoUrl ? 'Drag video to move' : 'Adjust your video framing'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <button
                  type="button"
                  title="Zoom Out (Show More Body)"
                  onClick={() =>
                    setSubjectConfig((c) => ({ ...c, scale: clampNum(Number((c.scale - 0.05).toFixed(2)), 0.35, 2.0) }))
                  }
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
                  onClick={() =>
                    setSubjectConfig((c) => ({ ...c, scale: clampNum(Number((c.scale + 0.05).toFixed(2)), 0.35, 2.0) }))
                  }
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
                onClick={() => setFgConfig((f) => ({ ...f, enabled: !f.enabled }))}
                className={`px-2.5 py-1.5 rounded-lg border font-medium ${
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
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-medium ${
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
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                <span className="font-mono text-slate-500">
                  Playhead: {formatDuration(currentTime)} / {formatDuration(videoDuration)}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Start Time</span>
                    <span className="font-mono">{trimStart.toFixed(1)}s</span>
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
                    <span className="font-mono">{trimEnd.toFixed(1)}s</span>
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700"
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
          <div className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            Studio &amp; Editing Settings
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
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Export Quality</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as ExportResolution)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              >
                <option value="720p">720p</option>
                <option value="1080p" disabled={plan?.limits.maxExportResolution === '720p'}>
                  1080p
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

          <div>
            <label className="block font-medium mb-1">Segmentation</label>
            <select
              value={segMode}
              onChange={(e) => setSegMode(e.target.value as SegmentationMode)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            >
              <option value="mediapipe">MediaPipe AI Segmentation</option>
              <option value="chroma_key">Chroma Key</option>
              <option value="original">Original Video</option>
            </select>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="p-2.5 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-700 dark:text-slate-200">Realistic edge blending</span>
              <button
                type="button"
                onClick={() =>
                  setSubjectConfig((c) => ({
                    ...c,
                    edgeChoke: 0.34,
                    bodySensitivity: 0.68,
                    edgeSoftness: 2,
                    lightWrap: 0.34,
                    shadowIntensity: 0.1,
                  }))
                }
                className="px-2 py-1 rounded bg-[#06B6D4] text-slate-950 font-semibold text-[11px] hover:bg-cyan-400"
              >
                Auto Blend
              </button>
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
            <div>
              <div className="flex justify-between mb-1">
                <span>Anti-Halo Edge Trim</span>
                <span className="font-mono">{(subjectConfig.edgeChoke ?? 0.3).toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={subjectConfig.edgeChoke ?? 0.3}
                onChange={(e) => setSubjectConfig((c) => ({ ...c, edgeChoke: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span>Studio Light Wrap</span>
                <span className="font-mono">{(subjectConfig.lightWrap ?? 0.28).toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={0.85}
                step={0.02}
                value={subjectConfig.lightWrap ?? 0.28}
                onChange={(e) => setSubjectConfig((c) => ({ ...c, lightWrap: Number(e.target.value) }))}
                className="w-full"
              />
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
                onChange={(e) => setSubjectConfig((c) => ({ ...c, scale: Number(e.target.value) }))}
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
                onChange={(e) => setSubjectConfig((c) => ({ ...c, offsetX: Number(e.target.value) }))}
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
                onChange={(e) => setSubjectConfig((c) => ({ ...c, offsetY: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span>Brightness</span>
                <span className="font-mono">{subjectConfig.brightness.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.6}
                max={1.4}
                step={0.02}
                value={subjectConfig.brightness}
                onChange={(e) => setSubjectConfig((c) => ({ ...c, brightness: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span>Contrast</span>
                <span className="font-mono">{subjectConfig.contrast.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.6}
                max={1.4}
                step={0.02}
                value={subjectConfig.contrast}
                onChange={(e) => setSubjectConfig((c) => ({ ...c, contrast: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span>Saturation</span>
                <span className="font-mono">{subjectConfig.saturation.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={1.8}
                step={0.02}
                value={subjectConfig.saturation}
                onChange={(e) => setSubjectConfig((c) => ({ ...c, saturation: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

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
