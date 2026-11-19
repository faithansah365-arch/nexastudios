import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  AudioLines,
  Camera,
  Download,
  FlipHorizontal,
  Focus,
  Gauge,
  Layers,
  Maximize2,
  Mic,
  MicOff,
  Move,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Sliders,
  Square,
  Type,
  VideoOff,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { TeleprompterOverlay } from '../components/TeleprompterOverlay';
import { useAuth } from '../context/AuthContext';
import { StudioAudioProcessor, type NoiseReductionStrength } from '../engine/audioNoiseReduction';
import { AutoFrameTracker } from '../engine/autoFrame';
import { StudioSegmenter, type SegmentationMode } from '../engine/segmentation';
import { getAspectDimensions, renderStudioFrame } from '../engine/studioRenderer';
import { detectBrowserCapabilities, formatDuration, loadImageElement } from '../engine/videoCapabilities';
import {
  clampTeleprompterFontSize,
  clampTeleprompterSpeed,
  DEFAULT_TELEPROMPTER_FONT_SIZE,
  DEFAULT_TELEPROMPTER_SCRIPT,
  DEFAULT_TELEPROMPTER_SPEED,
  MAX_TELEPROMPTER_FONT_SIZE,
  MAX_TELEPROMPTER_SPEED,
  MIN_TELEPROMPTER_FONT_SIZE,
  MIN_TELEPROMPTER_SPEED,
} from '../../shared/teleprompter';
import { apiRequest, ApiError } from '../lib/api';
import type {
  AspectRatio,
  BrandingConfig,
  CustomStudio,
  ExportResolution,
  ForegroundMaskConfig,
  LightingPreset,
  StudioTemplate,
  SubjectConfig,
} from '../../shared/types';

function clampNum(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

const DEFAULT_SUBJECT: SubjectConfig = {
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

const DEFAULT_FG: ForegroundMaskConfig = {
  enabled: true,
  deskHeightRatio: 0.26,
  deskStyle: 'news_glass',
  perspectiveTilt: 0,
  deskOpacity: 0.96,
};

const DEFAULT_BRANDING: BrandingConfig = {
  logoPosition: 'top-right',
  primaryColor: '#6366F1',
  secondaryColor: '#06B6D4',
  screenText: 'LIVE STUDIO',
  showScreenGraphic: false,
  lowerThirdTitle: '',
  lowerThirdSubtitle: '',
  showLowerThird: false,
  teleprompterText: '',
};

export function LiveStudioPage() {
  const { plan, refreshAuth } = useAuth();
  const [searchParams] = useSearchParams();
  const caps = detectBrowserCapabilities();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const segmenterRef = useRef<StudioSegmenter | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioProcessorRef = useRef<StudioAudioProcessor | null>(null);

  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const fgMaskImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [customStudios, setCustomStudios] = useState<CustomStudio[]>([]);
  const [activeStudioName, setActiveStudioName] = useState('Metro Briefing Desk');
  const [activeStudioId, setActiveStudioId] = useState<string | undefined>(undefined);
  const [backgroundUrl, setBackgroundUrl] = useState('/src/assets/images/bg_news_broadcast_1795098704414.jpg');
  const [subjectConfig, setSubjectConfig] = useState<SubjectConfig>(DEFAULT_SUBJECT);
  const [fgConfig, setFgConfig] = useState<ForegroundMaskConfig>(DEFAULT_FG);
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING);
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('cool_broadcast');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolution, setResolution] = useState<ExportResolution>('720p');

  // Hardware & permission states
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [selectedAudioId, setSelectedAudioId] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [noiseReductionEnabled, setNoiseReductionEnabled] = useState(true);
  const [noiseReductionStrength, setNoiseReductionStrength] = useState<NoiseReductionStrength>('balanced');
  const [noiseReductionStats, setNoiseReductionStats] = useState<{ speechActive: boolean; reductionDb: number }>({
    speechActive: false,
    reductionDb: 0,
  });
  const [mirrorCamera, setMirrorCamera] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);

  // Segmentation & performance states
  const [segMode, setSegMode] = useState<SegmentationMode>('mediapipe');
  const [segStatusText, setSegStatusText] = useState('Initializing local model...');
  const [segWarning, setSegWarning] = useState<string | null>(null);
  const [lowPowerMode, setLowPowerMode] = useState(caps.lowPowerRecommended);
  const [fps, setFps] = useState(0);

  // Recording & export states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState('Studio Production');
  const [exportStatus, setExportStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  // Control panel tab, Teleprompter, Auto-Frame & canvas drag state
  const [activeTab, setActiveTab] = useState<'studio' | 'subject' | 'color' | 'branding'>('studio');
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [teleprompterSpeed, setTeleprompterSpeed] = useState(DEFAULT_TELEPROMPTER_SPEED);
  const [teleprompterFontSize, setTeleprompterFontSize] = useState(DEFAULT_TELEPROMPTER_FONT_SIZE);
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

  // Mutable ref for animation loop to avoid restarting RAF on slider drag
  const sceneStateRef = useRef({
    subjectConfig,
    fgConfig,
    branding,
    lightingPreset,
    aspectRatio,
    mirrorCamera,
    segMode,
    lowPowerMode,
    autoFrameEnabled,
    watermarkRequired: plan?.limits.watermarkRequired ?? true,
  });

  useEffect(() => {
    sceneStateRef.current = {
      subjectConfig,
      fgConfig,
      branding,
      lightingPreset,
      aspectRatio,
      mirrorCamera,
      segMode,
      lowPowerMode,
      autoFrameEnabled,
      watermarkRequired: plan?.limits.watermarkRequired ?? true,
    };
  }, [subjectConfig, fgConfig, branding, lightingPreset, aspectRatio, mirrorCamera, segMode, lowPowerMode, autoFrameEnabled, plan]);

  const toggleAutoFrame = useCallback(() => {
    setAutoFrameEnabled((prev) => {
      const next = !prev;
      autoFrameTrackerRef.current?.reset();
      if (!next) setAutoFrameDetected(false);
      return next;
    });
  }, []);

  const toggleNoiseReduction = useCallback(() => {
    setNoiseReductionEnabled((prev) => {
      const next = !prev;
      audioProcessorRef.current?.setEnabled(next);
      return next;
    });
  }, []);

  const handleNoiseStrengthChange = useCallback((nextStrength: NoiseReductionStrength) => {
    setNoiseReductionStrength(nextStrength);
    audioProcessorRef.current?.setStrength(nextStrength);
  }, []);

  const toggleTeleprompter = useCallback(() => {
    setShowTeleprompter((prev) => {
      const next = !prev;
      if (next) {
        setBranding((b) =>
          b.teleprompterText && b.teleprompterText.trim()
            ? b
            : { ...b, teleprompterText: DEFAULT_TELEPROMPTER_SCRIPT }
        );
      }
      return next;
    });
  }, []);

  // Load templates and user's custom studios
  useEffect(() => {
    Promise.all([
      apiRequest<{ templates: StudioTemplate[] }>('/api/templates'),
      apiRequest<{ studios: CustomStudio[] }>('/api/studios').catch(() => ({ studios: [] })),
    ]).then(([tRes, sRes]) => {
      const avail = tRes.templates.filter((t) => t.isAvailable);
      setTemplates(avail);
      setCustomStudios(sRes.studios);

      const qTpl = searchParams.get('template');
      const qStudio = searchParams.get('studio');

      if (qStudio) {
        const found = sRes.studios.find((s) => s.id === qStudio);
        if (found) applyCustomStudio(found);
      } else if (qTpl) {
        const found = avail.find((t) => t.id === qTpl);
        if (found) applyTemplate(found);
      } else if (avail.length > 0) {
        applyTemplate(avail[0]);
      }
    });
  }, []);

  const applyTemplate = (tpl: StudioTemplate) => {
    setActiveStudioId(undefined);
    setActiveStudioName(tpl.name);
    setBackgroundUrl(tpl.backgroundUrl);
    setSubjectConfig({
      ...DEFAULT_SUBJECT,
      ...tpl.defaultSubjectConfig,
      edgeChoke: tpl.defaultSubjectConfig.edgeChoke ?? 0.3,
      bodySensitivity: tpl.defaultSubjectConfig.bodySensitivity ?? 0.6,
      lightWrap: tpl.defaultSubjectConfig.lightWrap ?? 0.28,
    });
    setFgConfig(tpl.foregroundMaskConfig);
    setBranding({ ...DEFAULT_BRANDING, ...tpl.defaultBrandingConfig });
    setLightingPreset(tpl.lightingPreset);
    if (tpl.supportedAspectRatios.length > 0) {
      setAspectRatio(tpl.supportedAspectRatios[0]);
    }
  };

  const applyCustomStudio = (studio: CustomStudio) => {
    setActiveStudioId(studio.id);
    setActiveStudioName(studio.name);
    setBackgroundUrl(studio.backgroundUrl);
    setSubjectConfig({
      ...DEFAULT_SUBJECT,
      ...studio.subjectConfig,
      edgeChoke: studio.subjectConfig.edgeChoke ?? 0.3,
      bodySensitivity: studio.subjectConfig.bodySensitivity ?? 0.6,
      lightWrap: studio.subjectConfig.lightWrap ?? 0.28,
    });
    setFgConfig(studio.foregroundMaskConfig);
    setBranding({ ...DEFAULT_BRANDING, ...studio.brandingConfig });
    setLightingPreset(studio.lightingPreset);
  };

  // Load image textures when URLs change
  useEffect(() => {
    let active = true;
    loadImageElement(backgroundUrl).then((img) => {
      if (active) bgImgRef.current = img;
    });
    return () => {
      active = false;
    };
  }, [backgroundUrl]);

  useEffect(() => {
    let active = true;
    if (fgConfig.customMaskUrl) {
      loadImageElement(fgConfig.customMaskUrl).then((img) => {
        if (active) fgMaskImgRef.current = img;
      });
    } else {
      fgMaskImgRef.current = null;
    }
    return () => {
      active = false;
    };
  }, [fgConfig.customMaskUrl]);

  useEffect(() => {
    let active = true;
    if (branding.logoUrl) {
      loadImageElement(branding.logoUrl).then((img) => {
        if (active) logoImgRef.current = img;
      });
    } else {
      logoImgRef.current = null;
    }
    return () => {
      active = false;
    };
  }, [branding.logoUrl]);

  // Initialize MediaPipe segmenter lazily inside workspace
  useEffect(() => {
    const seg = new StudioSegmenter();
    segmenterRef.current = seg;
    seg.initMediaPipe().then((ok) => {
      setSegStatusText(seg.status.backendInfo);
      if (!ok && seg.status.error) {
        setSegWarning(seg.status.error);
        setSegMode('chroma_key');
      }
    });
    return () => {
      seg.dispose();
    };
  }, []);

  const stopCameraStream = useCallback(() => {
    if (audioProcessorRef.current) {
      audioProcessorRef.current.dispose();
      audioProcessorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setAudioLevel(0);
    setNoiseReductionStats({ speechActive: false, reductionDb: 0 });
  }, []);

  const startCamera = useCallback(
    async (vidId?: string, audId?: string) => {
      if (!caps.mediaDevicesSupported) {
        setCameraError('Your browser does not support camera and microphone capture (getUserMedia).');
        return;
      }
      setCameraError(null);
      stopCameraStream();

      try {
        const resDims = getAspectDimensions('16:9', resolution === '4k' ? '1080p' : resolution);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: vidId ? { exact: vidId } : undefined,
            width: { ideal: resDims.width },
            height: { ideal: resDims.height },
            frameRate: { ideal: 30 },
          },
          audio: {
            deviceId: audId ? { exact: audId } : undefined,
            echoCancellation: true,
            noiseSuppression: noiseReductionEnabled,
            autoGainControl: noiseReductionEnabled,
          },
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Listen for physical camera disconnection
        stream.getVideoTracks().forEach((track) => {
          track.onended = () => {
            setCameraActive(false);
            setCameraError('Camera disconnected during session. Reconnect your camera and click Retry.');
          };
        });

        // Real-time Web Audio AI noise reduction + broadcast output stream
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          audioTracks.forEach((t) => {
            t.enabled = !micMuted;
          });
          const processor = new StudioAudioProcessor(noiseReductionEnabled, noiseReductionStrength);
          processor.attachStream(stream);
          audioProcessorRef.current = processor;
        }

        // Enumerate devices after permission granted
        const devices = await navigator.mediaDevices.enumerateDevices();
        setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
        setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
        setCameraActive(true);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.name === 'NotAllowedError'
              ? 'Camera or microphone permission was denied. Allow access in browser site settings and retry.'
              : err.name === 'NotFoundError'
              ? 'No camera or microphone was detected on this device.'
              : `Camera initialization error: ${err.message}`
            : 'Unable to access camera.';
        setCameraError(msg);
        setCameraActive(false);
      }
    },
    [caps.mediaDevicesSupported, micMuted, noiseReductionEnabled, noiseReductionStrength, resolution, stopCameraStream]
  );

  // Sync mic mute toggle
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !micMuted;
      });
    }
  }, [micMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [stopCameraStream, recordedUrl]);

  // Main real-time compositing render loop
  useEffect(() => {
    let rafId = 0;
    let frameCount = 0;
    let lastFpsSample = performance.now();
    let lastAutoFrameUiSync = 0;

    const renderLoop = (now: number) => {
      rafId = requestAnimationFrame(renderLoop);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const seg = segmenterRef.current;
      if (!canvas) return;

      const s = sceneStateRef.current;
      const dims = getAspectDimensions(s.aspectRatio, resolution === '4k' && !s.lowPowerMode ? '1080p' : s.lowPowerMode ? '720p' : resolution);
      if (canvas.width !== dims.width || canvas.height !== dims.height) {
        canvas.width = dims.width;
        canvas.height = dims.height;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let subjectCanvas: HTMLCanvasElement | null = null;
      if (cameraActive && video && video.readyState >= 2 && seg) {
        subjectCanvas = seg.extractSubjectCanvas(video, s.segMode, {
          lowPowerMode: s.lowPowerMode,
          edgeSoftness: s.subjectConfig.edgeSoftness,
          edgeChoke: s.subjectConfig.edgeChoke ?? 0.3,
          bodySensitivity: s.subjectConfig.bodySensitivity ?? 0.6,
          detectSilhouette: s.autoFrameEnabled,
          chromaColor: s.subjectConfig.chromaKeyColor,
          chromaSimilarity: s.subjectConfig.chromaSimilarity,
          chromaSmoothness: s.subjectConfig.chromaSmoothness,
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
              deskEnabled: s.fgConfig.enabled && s.fgConfig.deskStyle !== 'none',
              deskHeightRatio: s.fgConfig.deskHeightRatio,
            },
            now
          );
          s.subjectConfig = {
            ...s.subjectConfig,
            ...tracked.framing,
          };
          if (now - lastAutoFrameUiSync >= 160) {
            lastAutoFrameUiSync = now;
            setAutoFrameDetected(tracked.detected);
            setSubjectConfig((prev) => ({ ...prev, ...tracked.framing }));
          }
        }
      }

      renderStudioFrame(ctx, canvas.width, canvas.height, {
        backgroundImg: bgImgRef.current,
        customMaskImg: fgMaskImgRef.current,
        logoImg: logoImgRef.current,
        subjectCanvas,
        subjectConfig: s.subjectConfig,
        foregroundMaskConfig: s.fgConfig,
        brandingConfig: s.branding,
        lightingPreset: s.lightingPreset,
        aspectRatio: s.aspectRatio,
        mirrorCamera: s.mirrorCamera,
        watermarkRequired: s.watermarkRequired,
      });

      // Audio level meter & noise reduction state update
      if (audioProcessorRef.current && !micMuted) {
        setAudioLevel(audioProcessorRef.current.getMeterLevel());
        if (now - lastAutoFrameUiSync >= 140) {
          const stats = audioProcessorRef.current.getStats();
          setNoiseReductionStats({
            speechActive: stats.speechActive,
            reductionDb: stats.reductionDb,
          });
        }
      } else {
        setAudioLevel(0);
      }

      frameCount += 1;
      if (now - lastFpsSample >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastFpsSample = now;
      }
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [cameraActive, micMuted, resolution]);

  // Recording Timer & Plan Max Duration Guard
  useEffect(() => {
    if (!isRecording) return;
    const maxSecs = (plan?.limits.maxRecordingMinutes ?? 3) * 60;
    const interval = setInterval(() => {
      setRecordingSeconds((prev) => {
        if (prev + 1 >= maxSecs) {
          stopRecording();
          return maxSecs;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording, plan]);

  const startRecording = () => {
    setExportStatus(null);
    if (!canvasRef.current || !caps.mediaRecorderSupported || !caps.supportedMimeType) {
      setExportStatus({
        type: 'error',
        msg: 'MediaRecorder or compatible WebM/MP4 codecs are not supported in this browser.',
      });
      return;
    }
    if (!cameraActive) {
      setExportStatus({ type: 'error', msg: 'Start your camera before recording.' });
      return;
    }

    const canvasStream = canvasRef.current.captureStream(lowPowerMode ? 24 : 30);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    const processedAudioTracks = audioProcessorRef.current?.getOutputAudioTracks() ?? [];
    if (processedAudioTracks.length > 0) {
      processedAudioTracks.forEach((t) => tracks.push(t));
    } else if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t) => tracks.push(t));
    }
    const combined = new MediaStream(tracks);
    recordedChunksRef.current = [];

    try {
      const recorder = new MediaRecorder(combined, {
        mimeType: caps.supportedMimeType,
        videoBitsPerSecond: resolution === '1080p' ? 5_000_000 : 2_800_000,
      });
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: caps.supportedMimeType || 'video/webm' });
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        const url = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setRecordedUrl(url);
        setIsRecording(false);
      };
      recorder.start(500);
      recorderRef.current = recorder;
      setRecordingSeconds(0);
      setRecordedBlob(null);
      setIsRecording(true);
    } catch (err) {
      setExportStatus({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Unable to start MediaRecorder.',
      });
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleAuthorizedExport = async () => {
    if (!recordedBlob || !recordedUrl) return;
    setExportStatus(null);
    setExporting(true);
    let exportId: string | null = null;

    try {
      const authRes = await apiRequest<{ exportRecord: { id: string } }>('/api/exports/authorize', {
        method: 'POST',
        body: JSON.stringify({
          title: projectTitle || activeStudioName,
          studioId: activeStudioId,
          resolution,
          aspectRatio,
          format: recordedBlob.type || 'video/webm',
          durationSeconds: recordingSeconds,
        }),
      });
      exportId = authRes.exportRecord.id;

      // Save project metadata record
      await apiRequest('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          title: projectTitle || activeStudioName,
          type: 'live_recording',
          studioId: activeStudioId,
          aspectRatio,
          durationSeconds: recordingSeconds,
          settings: { resolution, segMode },
        }),
      });

      // Trigger local file download
      const a = document.createElement('a');
      a.href = recordedUrl;
      const ext = recordedBlob.type.includes('mp4') ? 'mp4' : 'webm';
      a.download = `${(projectTitle || 'nexastudios-production').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      await apiRequest(`/api/exports/${exportId}/complete`, { method: 'POST' });
      await refreshAuth();
      setExportStatus({ type: 'success', msg: 'Export authorized and downloaded locally.' });
    } catch (err) {
      if (exportId) {
        await apiRequest(`/api/exports/${exportId}/fail`, { method: 'POST' }).catch(() => {});
        await refreshAuth();
      }
      setExportStatus({
        type: 'error',
        msg: err instanceof ApiError ? err.message : 'Export authorization failed.',
      });
    } finally {
      setExporting(false);
    }
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
    setAutoFrameEnabled(false);
    setAutoFrameDetected(false);
    setSubjectConfig((c) => ({
      ...c,
      scale: 0.95,
      offsetX: 0,
      offsetY: 0,
    }));
  };

  const maxMinutes = plan?.limits.maxRecordingMinutes ?? 3;

  return (
    <DashboardLayout title="Live AI Studio">
      <div className="max-w-[1600px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Hidden source video element */}
        <video ref={videoRef} playsInline muted className="hidden" />

        {/* Left/Center: Stage Viewport & Transport Controls */}
        <div className="xl:col-span-8 space-y-4">
          {/* Top Studio Action Bar */}
          <div className="p-3 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {!cameraActive ? (
                <button
                  type="button"
                  onClick={() => startCamera(selectedVideoId, selectedAudioId)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold hover:bg-[#5558E6] whitespace-nowrap"
                >
                  <Camera className="w-4 h-4" />
                  <span>Enable Camera &amp; Mic</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopCameraStream}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <VideoOff className="w-4 h-4 text-red-400" />
                  <span>Stop Camera</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setMicMuted((m) => !m)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap ${
                  micMuted
                    ? 'border-red-500/40 text-red-400 bg-red-500/10'
                    : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {micMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-[#10B981]" />}
                <span>{micMuted ? 'Muted' : 'Mic On'}</span>
              </button>

              <button
                type="button"
                onClick={toggleNoiseReduction}
                title="Toggle real-time AI background noise filtering for broadcast audio"
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                  noiseReductionEnabled
                    ? 'border-[#10B981]/50 text-[#10B981] bg-[#10B981]/10'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <AudioLines className="w-3.5 h-3.5" />
                <span>{noiseReductionEnabled ? 'AI Noise Filter On' : 'Noise Filter Off'}</span>
              </button>

              <button
                type="button"
                onClick={() => setMirrorCamera((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium whitespace-nowrap"
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
                <span>{mirrorCamera ? 'Mirrored' : 'Normal'}</span>
              </button>

              <button
                type="button"
                onClick={() => setLowPowerMode((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap ${
                  lowPowerMode
                    ? 'border-[#06B6D4] text-[#06B6D4] bg-[#06B6D4]/10'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                <span>{lowPowerMode ? 'Low-Power Mode On' : 'Standard Quality'}</span>
              </button>

              <button
                type="button"
                onClick={toggleTeleprompter}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                  showTeleprompter
                    ? 'border-[#06B6D4] text-[#06B6D4] bg-[#06B6D4]/10'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <ScrollText className="w-3.5 h-3.5" />
                <span>{showTeleprompter ? 'Teleprompter On' : 'Teleprompter'}</span>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="font-mono tabular-nums text-xs text-slate-500 dark:text-[#94A3B8]">
                {fps} FPS · {resolution}
              </div>

              {!isRecording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={!cameraActive}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 disabled:opacity-40 whitespace-nowrap"
                >
                  <span className="w-2 h-2 rounded-full bg-white" />
                  <span>Record Scene</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="font-mono tabular-nums">
                    Stop ({formatDuration(recordingSeconds)} / {formatDuration(maxMinutes * 60)})
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Warnings / Errors */}
          {cameraError && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-between gap-3 text-xs text-red-400">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{cameraError}</span>
              </div>
              <button
                type="button"
                onClick={() => startCamera(selectedVideoId, selectedAudioId)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded bg-red-500 text-white font-semibold shrink-0"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {segWarning && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{segWarning}</span>
            </div>
          )}

          {fps > 0 && fps < 15 && cameraActive && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400 flex items-center justify-between gap-2">
              <span>Low frame rate detected ({fps} FPS). Enable Low-Power Mode or switch to 720p for smoother output.</span>
              {!lowPowerMode && (
                <button
                  type="button"
                  onClick={() => setLowPowerMode(true)}
                  className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-semibold shrink-0"
                >
                  Enable Low-Power
                </button>
              )}
            </div>
          )}

          {/* Main Composited Video Canvas */}
          <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#080B14] flex items-center justify-center min-h-[360px]">
            <canvas
              ref={canvasRef}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
              className={`max-h-[65vh] w-auto max-w-full block touch-none select-none ${
                cameraActive ? (isDraggingSubject ? 'cursor-grabbing' : 'cursor-grab') : ''
              } ${
                aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video w-full'
              }`}
            />

            {!cameraActive && (
              <div className="absolute inset-0 bg-[#080B14]/65 flex flex-col items-center justify-center p-6 text-center space-y-3">
                <Camera className="w-8 h-8 text-[#06B6D4]" />
                <div className="font-display text-lg font-semibold text-white">
                  Studio Preview Ready: {activeStudioName}
                </div>
                <p className="text-xs text-slate-300 max-w-md">
                  Click Enable Camera &amp; Mic above to begin real-time local segmentation inside this virtual studio.
                </p>
                <button
                  type="button"
                  onClick={() => startCamera(selectedVideoId, selectedAudioId)}
                  className="px-5 py-2.5 rounded-lg bg-[#6366F1] text-white text-xs font-semibold hover:bg-[#5558E6]"
                >
                  Start Live Camera
                </button>
              </div>
            )}

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

            {/* Eye-Contact AI Teleprompter Overlay */}
            {showTeleprompter && (
              <TeleprompterOverlay
                script={branding.teleprompterText || ''}
                onChangeScript={(nextScript) => setBranding((b) => ({ ...b, teleprompterText: nextScript }))}
                scrollSpeed={teleprompterSpeed}
                onChangeScrollSpeed={(nextSpeed) => setTeleprompterSpeed(clampTeleprompterSpeed(nextSpeed))}
                fontSize={teleprompterFontSize}
                onChangeFontSize={(nextFont) => setTeleprompterFontSize(clampTeleprompterFontSize(nextFont))}
                onClose={() => setShowTeleprompter(false)}
              />
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
                  : 'Adjust your video framing'}
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
                onClick={handleResetFraming}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Audio Meter, AI Noise Profile & Hardware Bar */}
          <div className="p-3 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center text-xs">
            <div className="sm:col-span-4 flex items-center gap-2">
              <span className="text-slate-500 dark:text-[#94A3B8] shrink-0">Mic Level</span>
              <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-[#10B981] transition-all duration-75"
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
              {cameraActive && noiseReductionEnabled && !micMuted && (
                <span className="font-mono tabular-nums text-[11px] text-[#10B981] shrink-0">
                  {noiseReductionStats.speechActive ? 'Voice' : `-${noiseReductionStats.reductionDb}dB`}
                </span>
              )}
            </div>
            <div className="sm:col-span-2">
              <select
                aria-label="Audio noise reduction strength"
                disabled={!noiseReductionEnabled}
                value={noiseReductionStrength}
                onChange={(e) => handleNoiseStrengthChange(e.target.value as NoiseReductionStrength)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 disabled:opacity-50"
              >
                <option value="balanced">Filter: Balanced</option>
                <option value="studio">Filter: Studio Strong</option>
              </select>
            </div>
            <select
              aria-label="Camera device"
              value={selectedVideoId}
              onChange={(e) => {
                setSelectedVideoId(e.target.value);
                if (cameraActive) void startCamera(e.target.value, selectedAudioId);
              }}
              className="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 truncate"
            >
              <option value="">Default Camera</option>
              {videoDevices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
            <select
              aria-label="Microphone device"
              value={selectedAudioId}
              onChange={(e) => {
                setSelectedAudioId(e.target.value);
                if (cameraActive) void startCamera(selectedVideoId, e.target.value);
              }}
              className="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 truncate"
            >
              <option value="">Default Microphone</option>
              {audioDevices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
            <div className="sm:col-span-2 text-slate-500 dark:text-[#94A3B8] truncate text-right">
              {segStatusText}
            </div>
          </div>

          {/* Recorded Clip Playback & Server-Authorized Export */}
          {recordedUrl && (
            <div className="p-5 rounded-xl bg-white dark:bg-[#111827] border border-[#6366F1]/50 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Play className="w-4 h-4 text-[#10B981]" />
                    <span>Recorded Production Ready ({formatDuration(recordingSeconds)})</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                    Review playback below, then authorize &amp; download locally (uses 1 monthly export quota).
                  </p>
                </div>
              </div>

              <video src={recordedUrl} controls className="w-full max-h-72 rounded-lg bg-black" />

              {exportStatus && (
                <div
                  className={`p-3 rounded-lg text-xs ${
                    exportStatus.type === 'error'
                      ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                      : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                  }`}
                >
                  {exportStatus.msg}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  className="flex-1 min-w-[200px] px-3.5 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700 text-sm"
                  placeholder="Production title"
                />
                <button
                  type="button"
                  disabled={exporting}
                  onClick={handleAuthorizedExport}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#10B981] text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-60"
                >
                  <Download className="w-4 h-4" />
                  <span>{exporting ? 'Authorizing Export...' : 'Authorize & Download Video'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Studio & Layer Controls */}
        <aside className="xl:col-span-4 p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-5 h-fit">
          <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#080B14]">
            {[
              { id: 'studio', label: 'Studio', icon: Layers },
              { id: 'subject', label: 'Subject', icon: Sliders },
              { id: 'color', label: 'Color', icon: Gauge },
              { id: 'branding', label: 'Graphics', icon: Type },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`py-2 px-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-[#172033] text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-[#94A3B8]'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {activeTab === 'studio' && (
            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Segmentation Method
                </label>
                <select
                  value={segMode}
                  onChange={(e) => setSegMode(e.target.value as SegmentationMode)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                >
                  <option value="mediapipe">MediaPipe AI Segmentation (Local)</option>
                  <option value="chroma_key">Chroma Key (Green / Blue Screen)</option>
                  <option value="original">Original Camera (No Removal)</option>
                </select>
              </div>

              {segMode === 'chroma_key' && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span>Key Color</span>
                    <input
                      type="color"
                      value={subjectConfig.chromaKeyColor}
                      onChange={(e) => setSubjectConfig((c) => ({ ...c, chromaKeyColor: e.target.value }))}
                      className="w-8 h-6 rounded cursor-pointer"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span>Similarity</span>
                      <span className="font-mono">{subjectConfig.chromaSimilarity.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={0.55}
                      step={0.01}
                      value={subjectConfig.chromaSimilarity}
                      onChange={(e) => setSubjectConfig((c) => ({ ...c, chromaSimilarity: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">Aspect Ratio</label>
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
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">Resolution</label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as ExportResolution)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                  >
                    <option value="720p">720p HD</option>
                    <option value="1080p" disabled={plan?.limits.maxExportResolution === '720p'}>
                      1080p Full HD {plan?.limits.maxExportResolution === '720p' ? '(Creator+)' : ''}
                    </option>
                    <option value="4k" disabled={plan?.limits.maxExportResolution !== '4k'}>
                      4K UHD {plan?.limits.maxExportResolution !== '4k' ? '(Business)' : ''}
                    </option>
                  </select>
                </div>
              </div>

              <div>
                <div className="font-medium text-slate-700 dark:text-slate-300 mb-2">Studio Environment</div>
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className={`text-left rounded-lg overflow-hidden border transition-colors ${
                        activeStudioName === t.name && !activeStudioId
                          ? 'border-[#6366F1]'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-500'
                      }`}
                    >
                      <img src={t.thumbnailUrl} alt={t.name} className="w-full aspect-video object-cover" />
                      <div className="p-2 text-[11px] font-medium truncate">{t.name}</div>
                    </button>
                  ))}
                  {customStudios.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => applyCustomStudio(s)}
                      className={`text-left rounded-lg overflow-hidden border transition-colors ${
                        activeStudioId === s.id
                          ? 'border-[#06B6D4]'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-500'
                      }`}
                    >
                      <img src={s.backgroundUrl} alt={s.name} className="w-full aspect-video object-cover" />
                      <div className="p-2 text-[11px] font-medium truncate">{s.name} (Saved)</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'subject' && (
            <div className="space-y-4 text-xs">
              <div className="p-3 rounded-lg bg-[#6366F1]/10 border border-[#6366F1]/30 flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Focus className="w-3.5 h-3.5 text-[#06B6D4]" />
                    <span>AI Auto-Frame</span>
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-[#94A3B8] mt-0.5">
                    Tracks your silhouette &amp; dynamically centers zoom and position.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleAutoFrame}
                  className={`px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-colors ${
                    autoFrameEnabled
                      ? 'bg-[#10B981] text-white'
                      : 'bg-[#6366F1] text-white hover:bg-[#5558E6]'
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
                <p className="text-[11px] text-slate-500 dark:text-[#94A3B8] mt-0.5">
                  Raise if hands, arms, or dark clothes disappear.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Foreground Desk Layer</span>
                  <input
                    type="checkbox"
                    checked={fgConfig.enabled}
                    onChange={(e) => setFgConfig((f) => ({ ...f, enabled: e.target.checked }))}
                  />
                </div>
                <select
                  value={fgConfig.deskStyle}
                  onChange={(e) => setFgConfig((f) => ({ ...f, deskStyle: e.target.value as ForegroundMaskConfig['deskStyle'] }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                >
                  <option value="none">No Desk</option>
                  <option value="news_glass">Television News Glass Desk</option>
                  <option value="church_pulpit">Sanctuary Wood Pulpit</option>
                  <option value="podcast_oak">Podcast Studio Oak Table</option>
                  <option value="minimal_slate">Minimalist Slate Desk</option>
                </select>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Desk Height</span>
                    <span className="font-mono">{Math.round(fgConfig.deskHeightRatio * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.15}
                    max={0.48}
                    step={0.01}
                    value={fgConfig.deskHeightRatio}
                    onChange={(e) => setFgConfig((f) => ({ ...f, deskHeightRatio: Number(e.target.value) }))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'color' && (
            <div className="space-y-4 text-xs">
              <div className="p-3 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-700 dark:text-slate-200">
                  Remove outline lines &amp; match studio lighting
                </span>
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
                  className="px-2.5 py-1 rounded bg-[#06B6D4] text-slate-950 font-semibold shrink-0 hover:bg-cyan-400"
                >
                  Realistic Blend
                </button>
              </div>
              <div>
                <label className="block font-medium mb-1.5">Lighting Preset</label>
                <select
                  value={lightingPreset}
                  onChange={(e) => setLightingPreset(e.target.value as LightingPreset)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                >
                  <option value="neutral">Neutral Studio</option>
                  <option value="warm_studio">Warm Tungsten</option>
                  <option value="cool_broadcast">Cool Broadcast</option>
                  <option value="dramatic">Dramatic Vignette</option>
                </select>
              </div>
              {[
                { key: 'bodySensitivity', label: 'Body Detection Boost', min: 0, max: 1, step: 0.02, def: 0.6 },
                { key: 'edgeChoke', label: 'Anti-Halo Edge Trim', min: 0, max: 1, step: 0.02, def: 0.3 },
                { key: 'edgeSoftness', label: 'Inward Edge Feather (px)', min: 0, max: 10, step: 1, def: 2 },
                { key: 'lightWrap', label: 'Studio Light Wrap', min: 0, max: 0.85, step: 0.02, def: 0.28 },
                { key: 'brightness', label: 'Brightness', min: 0.6, max: 1.4, step: 0.02, def: 1 },
                { key: 'contrast', label: 'Contrast', min: 0.6, max: 1.4, step: 0.02, def: 1 },
                { key: 'saturation', label: 'Saturation', min: 0.2, max: 1.8, step: 0.02, def: 1 },
                { key: 'colorTemp', label: 'Color Temperature', min: -40, max: 40, step: 1, def: 0 },
                { key: 'bgBlur', label: 'Background Blur (px)', min: 0, max: 16, step: 1, def: 2 },
                { key: 'shadowIntensity', label: 'Soft Ambient Depth', min: 0, max: 0.9, step: 0.05, def: 0.12 },
              ].map((ctrl) => {
                const rawVal = subjectConfig[ctrl.key as keyof SubjectConfig];
                const val = typeof rawVal === 'number' ? rawVal : ctrl.def;
                return (
                  <div key={ctrl.key}>
                    <div className="flex justify-between mb-1">
                      <span>{ctrl.label}</span>
                      <span className="font-mono">{Number.isInteger(ctrl.step) ? val : val.toFixed(2)}</span>
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
            </div>
          )}

          {activeTab === 'branding' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">Show Lower Third</span>
                <input
                  type="checkbox"
                  checked={branding.showLowerThird}
                  onChange={(e) => setBranding((b) => ({ ...b, showLowerThird: e.target.checked }))}
                />
              </div>
              <input
                value={branding.lowerThirdTitle}
                onChange={(e) => setBranding((b) => ({ ...b, lowerThirdTitle: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                placeholder="Presenter name / Title"
              />
              <input
                value={branding.lowerThirdSubtitle}
                onChange={(e) => setBranding((b) => ({ ...b, lowerThirdSubtitle: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                placeholder="Role or topic subtitle"
              />

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Wall Screen Banner</span>
                  <input
                    type="checkbox"
                    checked={branding.showScreenGraphic}
                    onChange={(e) => setBranding((b) => ({ ...b, showScreenGraphic: e.target.checked }))}
                  />
                </div>
                <input
                  value={branding.screenText}
                  onChange={(e) => setBranding((b) => ({ ...b, screenText: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                  placeholder="Studio wall display text"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">AI Eye-Contact Teleprompter</span>
                  <button
                    type="button"
                    onClick={toggleTeleprompter}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      showTeleprompter
                        ? 'bg-[#06B6D4] text-slate-950'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {showTeleprompter ? 'Overlay On' : 'Show Overlay'}
                  </button>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span>Scroll Speed</span>
                    <span className="font-mono tabular-nums">{teleprompterSpeed} px/s</span>
                  </div>
                  <input
                    type="range"
                    min={MIN_TELEPROMPTER_SPEED}
                    max={MAX_TELEPROMPTER_SPEED}
                    step={2}
                    value={teleprompterSpeed}
                    onChange={(e) => setTeleprompterSpeed(clampTeleprompterSpeed(Number(e.target.value)))}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span>Font Size</span>
                    <span className="font-mono tabular-nums">{teleprompterFontSize} px</span>
                  </div>
                  <input
                    type="range"
                    min={MIN_TELEPROMPTER_FONT_SIZE}
                    max={MAX_TELEPROMPTER_FONT_SIZE}
                    step={1}
                    value={teleprompterFontSize}
                    onChange={(e) => setTeleprompterFontSize(clampTeleprompterFontSize(Number(e.target.value)))}
                    className="w-full"
                  />
                </div>

                <textarea
                  rows={4}
                  value={branding.teleprompterText || ''}
                  onChange={(e) => setBranding((b) => ({ ...b, teleprompterText: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                  placeholder="Paste script notes or use the AI Script button directly on the teleprompter overlay..."
                />
              </div>
            </div>
          )}
        </aside>
      </div>
    </DashboardLayout>
  );
}
