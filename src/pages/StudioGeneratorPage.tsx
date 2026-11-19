import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Layers, Save, Sparkles, Upload } from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { ThreeStagePreview } from '../engine/ThreeStagePreview';
import { renderStudioFrame } from '../engine/studioRenderer';
import { loadImageElement } from '../engine/videoCapabilities';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import type {
  ForegroundMaskConfig,
  LightingPreset,
  StudioCategory,
  StudioType,
  SubjectConfig,
} from '../../shared/types';

export function StudioGeneratorPage() {
  const { refreshAuth } = useAuth();
  const navigate = useNavigate();
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const maskImgRef = useRef<HTMLImageElement | null>(null);

  const [studioName, setStudioName] = useState('Custom Broadcast Studio');
  const [category, setCategory] = useState<StudioCategory>('Corporate Presentation Studios');
  const [studioType, setStudioType] = useState<StudioType>('layered_2_5d');
  const [backgroundUrl, setBackgroundUrl] = useState('/src/assets/images/bg_executive_keynote_1795098704486.jpg');
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('neutral');
  const [viewMode, setViewMode] = useState<'composite' | 'depth_3d'>('composite');

  const [subjectConfig, setSubjectConfig] = useState<SubjectConfig>({
    scale: 0.95,
    offsetX: 0,
    offsetY: 0.05,
    colorTemp: 0,
    brightness: 1,
    contrast: 1,
    saturation: 1,
    bgBlur: 0,
    edgeSoftness: 3,
    shadowIntensity: 0.35,
    chromaKeyEnabled: false,
    chromaKeyColor: '#00b140',
    chromaSimilarity: 0.24,
    chromaSmoothness: 0.08,
  });

  const [fgConfig, setFgConfig] = useState<ForegroundMaskConfig>({
    enabled: true,
    deskHeightRatio: 0.26,
    deskStyle: 'minimal_slate',
    perspectiveTilt: 0,
    deskOpacity: 0.96,
  });

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  useEffect(() => {
    loadImageElement(backgroundUrl).then((img) => {
      bgImgRef.current = img;
      drawCompositePreview();
    });
  }, [backgroundUrl]);

  useEffect(() => {
    if (fgConfig.customMaskUrl) {
      loadImageElement(fgConfig.customMaskUrl).then((img) => {
        maskImgRef.current = img;
        drawCompositePreview();
      });
    } else {
      maskImgRef.current = null;
      drawCompositePreview();
    }
  }, [fgConfig.customMaskUrl]);

  const drawCompositePreview = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    canvas.width = 960;
    canvas.height = 540;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create a clean silhouette placeholder subject solely to preview desk occlusion math
    const subj = document.createElement('canvas');
    subj.width = 360;
    subj.height = 480;
    const sctx = subj.getContext('2d')!;
    sctx.fillStyle = 'rgba(99, 102, 241, 0.55)';
    sctx.beginPath();
    sctx.arc(180, 120, 62, 0, Math.PI * 2);
    sctx.fill();
    sctx.beginPath();
    sctx.roundRect(75, 195, 210, 285, 48);
    sctx.fill();

    renderStudioFrame(ctx, 960, 540, {
      backgroundImg: bgImgRef.current,
      customMaskImg: maskImgRef.current,
      logoImg: null,
      subjectCanvas: subj,
      subjectConfig,
      foregroundMaskConfig: fgConfig,
      brandingConfig: {
        logoPosition: 'top-right',
        primaryColor: '#6366F1',
        secondaryColor: '#06B6D4',
        screenText: '',
        showScreenGraphic: false,
        lowerThirdTitle: '',
        lowerThirdSubtitle: '',
        showLowerThird: false,
      },
      lightingPreset,
      aspectRatio: '16:9',
      mirrorCamera: false,
      watermarkRequired: false,
    });
  };

  useEffect(() => {
    drawCompositePreview();
  }, [subjectConfig, fgConfig, lightingPreset, viewMode]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, target: 'background' | 'mask') => {
    setStatus(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setStatus({ type: 'error', msg: 'Unsupported image format. Upload JPG, PNG, or WebP.' });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setStatus({ type: 'error', msg: 'Image exceeds the 8 MB limit.' });
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiRequest<{ url: string }>('/api/studios/upload-image', {
          method: 'POST',
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        if (target === 'background') {
          setBackgroundUrl(res.url);
          setStatus({ type: 'success', msg: 'Studio photograph uploaded and validated.' });
        } else {
          setFgConfig((f) => ({ ...f, enabled: true, deskStyle: 'custom_mask', customMaskUrl: res.url }));
          setStudioType('layered_2_5d');
          setStatus({ type: 'success', msg: 'Custom foreground mask uploaded.' });
        }
      } catch (err) {
        setStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Upload failed.' });
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveStudio = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setSaving(true);
    try {
      const res = await apiRequest<{ studio: { id: string } }>('/api/studios', {
        method: 'POST',
        body: JSON.stringify({
          name: studioName,
          category,
          studioType,
          backgroundUrl,
          foregroundMaskConfig: fgConfig,
          subjectConfig,
          brandingConfig: {
            logoPosition: 'top-right',
            primaryColor: '#6366F1',
            secondaryColor: '#06B6D4',
            screenText: '',
            showScreenGraphic: false,
            lowerThirdTitle: '',
            lowerThirdSubtitle: '',
            showLowerThird: false,
          },
          cameraFraming: 'medium',
          lightingPreset,
          supportedAspectRatios: ['16:9', '9:16', '1:1'],
        }),
      });
      await refreshAuth();
      setStatus({ type: 'success', msg: 'Studio configuration saved. Ready to use in Live AI Studio.' });
      setTimeout(() => navigate(`/dashboard/live-studio?studio=${encodeURIComponent(res.studio.id)}`), 600);
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Unable to save studio.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout title="AI Studio Generator">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-4">
          <div className="p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-[#94A3B8]">
              <Sparkles className="w-4 h-4 text-[#6366F1]" />
              <span>
                Converts a single studio photograph into a fixed-camera{' '}
                <strong>{studioType === 'layered_2_5d' ? 'Layered 2.5D Studio' : '2D Backdrop'}</strong>.
              </span>
            </div>

            <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-[#080B14] text-xs">
              <button
                type="button"
                onClick={() => setViewMode('composite')}
                className={`px-3 py-1.5 rounded-md font-medium ${
                  viewMode === 'composite' ? 'bg-white dark:bg-[#172033] text-slate-900 dark:text-white' : 'text-slate-500'
                }`}
              >
                Composite Placement
              </button>
              <button
                type="button"
                onClick={() => setViewMode('depth_3d')}
                className={`px-3 py-1.5 rounded-md font-medium ${
                  viewMode === 'depth_3d' ? 'bg-white dark:bg-[#172033] text-slate-900 dark:text-white' : 'text-slate-500'
                }`}
              >
                2.5D Depth Planes (Three.js)
              </button>
            </div>
          </div>

          <div className="aspect-video rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#080B14]">
            {viewMode === 'composite' ? (
              <canvas ref={previewCanvasRef} className="w-full h-full object-contain" />
            ) : (
              <ThreeStagePreview
                backgroundUrl={backgroundUrl}
                subjectConfig={subjectConfig}
                foregroundMaskConfig={fgConfig}
              />
            )}
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-[#94A3B8]">
            <strong>Technical Transparency:</strong> Single-image uploads create fixed-camera 2D or layered 2.5D
            environments (background plane + subject placement + foreground desk mask). True multi-angle 3D geometry is
            not inferred from a single RGB photo.
          </div>
        </div>

        <form
          onSubmit={handleSaveStudio}
          className="lg:col-span-4 p-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-4 text-xs h-fit"
        >
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#06B6D4]" />
            <span>Configure Studio</span>
          </h2>

          {status && (
            <div
              className={`p-3 rounded-lg flex items-center gap-2 ${
                status.type === 'error'
                  ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                  : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              }`}
            >
              {status.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{status.msg}</span>
            </div>
          )}

          <div>
            <label className="block font-medium mb-1">Studio Name</label>
            <input
              required
              value={studioName}
              onChange={(e) => setStudioName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as StudioCategory)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            >
              <option>Church Broadcasting Studios</option>
              <option>Television News Studios</option>
              <option>Podcast Studios</option>
              <option>Educational Studios</option>
              <option>Corporate Presentation Studios</option>
            </select>
          </div>

          <div>
            <label className="block font-medium mb-1">Studio Architecture Type</label>
            <select
              value={studioType}
              onChange={(e) => {
                const val = e.target.value as StudioType;
                setStudioType(val);
                if (val === 'simple_background') {
                  setFgConfig((f) => ({ ...f, enabled: false }));
                } else {
                  setFgConfig((f) => ({ ...f, enabled: true }));
                }
              }}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            >
              <option value="layered_2_5d">Layered 2.5D Studio (With Foreground Mask/Desk)</option>
              <option value="simple_background">Simple 2D Background Image</option>
            </select>
          </div>

          <label className="block p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 cursor-pointer hover:border-[#6366F1]">
            <div className="flex items-center gap-2 font-semibold text-[#6366F1]">
              <Upload className="w-4 h-4" />
              <span>{uploading ? 'Uploading...' : 'Upload Studio Photo (JPG, PNG, WebP)'}</span>
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handlePhotoUpload(e, 'background')}
              className="hidden"
            />
          </label>

          {studioType === 'layered_2_5d' && (
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div>
                <label className="block font-medium mb-1">Foreground Desk / Mask</label>
                <select
                  value={fgConfig.deskStyle}
                  onChange={(e) =>
                    setFgConfig((f) => ({ ...f, enabled: true, deskStyle: e.target.value as ForegroundMaskConfig['deskStyle'] }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
                >
                  <option value="minimal_slate">Minimalist Slate Desk</option>
                  <option value="news_glass">News Broadcast Glass Desk</option>
                  <option value="church_pulpit">Sanctuary Wood Pulpit</option>
                  <option value="podcast_oak">Podcast Oak Table</option>
                  <option value="custom_mask">Custom Transparent PNG Mask</option>
                </select>
              </div>

              {fgConfig.deskStyle === 'custom_mask' && (
                <label className="block text-[#06B6D4] cursor-pointer underline">
                  Upload transparent PNG foreground mask
                  <input
                    type="file"
                    accept="image/png,image/webp"
                    onChange={(e) => handlePhotoUpload(e, 'mask')}
                    className="hidden"
                  />
                </label>
              )}

              <div>
                <div className="flex justify-between mb-1">
                  <span>Desk Occlusion Height</span>
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
          )}

          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex justify-between mb-1">
                <span>Subject Scale</span>
                <span className="font-mono">{subjectConfig.scale.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1.4}
                step={0.02}
                value={subjectConfig.scale}
                onChange={(e) => setSubjectConfig((c) => ({ ...c, scale: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span>Subject Vertical Position</span>
                <span className="font-mono">{Math.round(subjectConfig.offsetY * 100)}%</span>
              </div>
              <input
                type="range"
                min={-0.3}
                max={0.3}
                step={0.01}
                value={subjectConfig.offsetY}
                onChange={(e) => setSubjectConfig((c) => ({ ...c, offsetY: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Lighting Preset</label>
              <select
                value={lightingPreset}
                onChange={(e) => setLightingPreset(e.target.value as LightingPreset)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              >
                <option value="neutral">Neutral</option>
                <option value="warm_studio">Warm Studio</option>
                <option value="cool_broadcast">Cool Broadcast</option>
                <option value="dramatic">Dramatic Vignette</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || uploading}
            className="w-full py-2.5 px-4 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E6] inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving Studio...' : 'Save Studio & Open in Live Studio'}</span>
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
