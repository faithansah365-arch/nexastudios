import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Palette, Plus, Save, Trash2, Upload } from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { renderStudioFrame } from '../engine/studioRenderer';
import { loadImageElement } from '../engine/videoCapabilities';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import type {
  BrandingConfig,
  CameraFraming,
  CustomStudio,
  ForegroundMaskConfig,
  LightingPreset,
  StudioTemplate,
  SubjectConfig,
} from '../../shared/types';

export function StudioDesignerPage() {
  const { plan, refreshAuth } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  const [studios, setStudios] = useState<CustomStudio[]>([]);
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('My Branded Studio');
  const [backgroundUrl, setBackgroundUrl] = useState('/src/assets/images/bg_news_broadcast_1795098704414.jpg');
  const [framing, setFraming] = useState<CameraFraming>('medium');
  const [lighting, setLighting] = useState<LightingPreset>('neutral');
  const [subject, setSubject] = useState<SubjectConfig>({
    scale: 0.95,
    offsetX: 0,
    offsetY: 0.05,
    colorTemp: 0,
    brightness: 1,
    contrast: 1,
    saturation: 1,
    bgBlur: 2,
    edgeSoftness: 3,
    shadowIntensity: 0.35,
    chromaKeyEnabled: false,
    chromaKeyColor: '#00b140',
    chromaSimilarity: 0.24,
    chromaSmoothness: 0.08,
  });
  const [fg, setFg] = useState<ForegroundMaskConfig>({
    enabled: true,
    deskHeightRatio: 0.26,
    deskStyle: 'news_glass',
    perspectiveTilt: 0,
    deskOpacity: 0.96,
  });
  const [branding, setBranding] = useState<BrandingConfig>({
    logoPosition: 'top-right',
    primaryColor: '#6366F1',
    secondaryColor: '#06B6D4',
    screenText: 'STUDIO LIVE',
    showScreenGraphic: true,
    lowerThirdTitle: 'Host Name',
    lowerThirdSubtitle: 'Weekly Broadcast',
    showLowerThird: true,
  });

  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  const loadData = async () => {
    const [sRes, tRes] = await Promise.all([
      apiRequest<{ studios: CustomStudio[] }>('/api/studios'),
      apiRequest<{ templates: StudioTemplate[] }>('/api/templates'),
    ]);
    setStudios(sRes.studios);
    setTemplates(tRes.templates.filter((t) => t.isAvailable));
    if (sRes.studios.length > 0 && !editingId) {
      selectStudio(sRes.studios[0]);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const selectStudio = (s: CustomStudio) => {
    setEditingId(s.id);
    setName(s.name);
    setBackgroundUrl(s.backgroundUrl);
    setFraming(s.cameraFraming);
    setLighting(s.lightingPreset);
    setSubject(s.subjectConfig);
    setFg(s.foregroundMaskConfig);
    setBranding(s.brandingConfig);
  };

  useEffect(() => {
    loadImageElement(backgroundUrl).then((img) => {
      bgImgRef.current = img;
      draw();
    });
  }, [backgroundUrl]);

  useEffect(() => {
    if (branding.logoUrl) {
      loadImageElement(branding.logoUrl).then((img) => {
        logoImgRef.current = img;
        draw();
      });
    } else {
      logoImgRef.current = null;
      draw();
    }
  }, [branding.logoUrl]);

  const draw = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = 960;
    c.height = 540;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const subj = document.createElement('canvas');
    subj.width = 360;
    subj.height = 480;
    const sctx = subj.getContext('2d')!;
    sctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    sctx.beginPath();
    sctx.arc(180, 120, 58, 0, Math.PI * 2);
    sctx.fill();
    sctx.beginPath();
    sctx.roundRect(80, 190, 200, 290, 44);
    sctx.fill();

    renderStudioFrame(ctx, 960, 540, {
      backgroundImg: bgImgRef.current,
      customMaskImg: null,
      logoImg: logoImgRef.current,
      subjectCanvas: subj,
      subjectConfig: subject,
      foregroundMaskConfig: fg,
      brandingConfig: branding,
      lightingPreset: lighting,
      aspectRatio: '16:9',
      mirrorCamera: false,
      watermarkRequired: plan?.limits.watermarkRequired ?? true,
    });
  };

  useEffect(() => {
    draw();
  }, [subject, fg, branding, lighting, framing]);

  const handleUploadAsset = (e: React.ChangeEvent<HTMLInputElement>, kind: 'logo' | 'bg') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiRequest<{ url: string }>('/api/studios/upload-image', {
          method: 'POST',
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        if (kind === 'logo') {
          setBranding((b) => ({ ...b, logoUrl: res.url }));
        } else {
          setBackgroundUrl(res.url);
        }
      } catch (err) {
        setStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Asset upload failed.' });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setStatus(null);
    try {
      if (editingId) {
        await apiRequest(`/api/studios/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name,
            backgroundUrl,
            cameraFraming: framing,
            lightingPreset: lighting,
            subjectConfig: subject,
            foregroundMaskConfig: fg,
            brandingConfig: branding,
          }),
        });
        setStatus({ type: 'success', msg: 'Studio configuration updated.' });
      } else {
        const res = await apiRequest<{ studio: CustomStudio }>('/api/studios', {
          method: 'POST',
          body: JSON.stringify({
            name,
            category: 'Corporate Presentation Studios',
            studioType: fg.enabled ? 'layered_2_5d' : 'simple_background',
            backgroundUrl,
            cameraFraming: framing,
            lightingPreset: lighting,
            subjectConfig: subject,
            foregroundMaskConfig: fg,
            brandingConfig: branding,
            supportedAspectRatios: ['16:9', '9:16', '1:1'],
          }),
        });
        setEditingId(res.studio.id);
        setStatus({ type: 'success', msg: 'New custom studio saved.' });
      }
      await loadData();
      await refreshAuth();
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save studio.' });
    }
  };

  const handleDuplicate = async () => {
    if (!editingId) return;
    setStatus(null);
    try {
      const res = await apiRequest<{ studio: CustomStudio }>(`/api/studios/${editingId}/duplicate`, {
        method: 'POST',
      });
      await loadData();
      await refreshAuth();
      selectStudio(res.studio);
      setStatus({ type: 'success', msg: 'Studio duplicated.' });
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Unable to duplicate studio.' });
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    setStatus(null);
    try {
      await apiRequest(`/api/studios/${editingId}`, { method: 'DELETE' });
      setEditingId(null);
      await loadData();
      await refreshAuth();
      setStatus({ type: 'success', msg: 'Studio deleted.' });
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Unable to delete studio.' });
    }
  };

  return (
    <DashboardLayout title="Studio Designer">
      <div className="max-w-[1500px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Saved Studios Selector & Actions */}
        <div className="xl:col-span-3 space-y-3">
          <div className="p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-display text-sm font-semibold">Saved Studios</span>
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setName('New Custom Studio');
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#6366F1]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            </div>
            {studios.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                No saved studios yet. Customize settings on the right and click Save.
              </p>
            ) : (
              <div className="space-y-1.5">
                {studios.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectStudio(s)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium truncate transition-colors ${
                      editingId === s.id
                        ? 'bg-[#6366F1] text-white'
                        : 'hover:bg-slate-100 dark:hover:bg-[#172033] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center Preview */}
        <div className="xl:col-span-5 space-y-4">
          <div className="aspect-video rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#080B14]">
            <canvas ref={canvasRef} className="w-full h-full object-contain" />
          </div>

          {status && (
            <div
              className={`p-3 rounded-lg text-xs ${
                status.type === 'error'
                  ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                  : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              }`}
            >
              {status.msg}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold hover:bg-[#5558E6]"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{editingId ? 'Save Changes' : 'Save New Studio'}</span>
            </button>
            {editingId && (
              <>
                <button
                  type="button"
                  onClick={handleDuplicate}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Duplicate</span>
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/30 text-red-400 text-xs font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
                <Link
                  to={`/dashboard/live-studio?studio=${encodeURIComponent(editingId)}`}
                  className="ml-auto text-xs font-semibold text-[#06B6D4] hover:underline"
                >
                  Open in Live Studio
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Right Controls */}
        <div className="xl:col-span-4 p-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-4 text-xs h-fit">
          <div className="flex items-center gap-2 font-display text-sm font-semibold">
            <Palette className="w-4 h-4 text-[#6366F1]" />
            <span>Design &amp; Brand Properties</span>
          </div>

          <div>
            <label className="block font-medium mb-1">Studio Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Background Template</label>
            <select
              value={backgroundUrl}
              onChange={(e) => setBackgroundUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.backgroundUrl}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <label className="inline-flex items-center gap-2 text-[#06B6D4] cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload custom background image</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => handleUploadAsset(e, 'bg')} className="hidden" />
          </label>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <label className="block font-medium mb-1">Primary Color</label>
              <input
                type="color"
                value={branding.primaryColor}
                onChange={(e) => setBranding((b) => ({ ...b, primaryColor: e.target.value }))}
                className="w-full h-8 rounded cursor-pointer"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Secondary Color</label>
              <input
                type="color"
                value={branding.secondaryColor}
                onChange={(e) => setBranding((b) => ({ ...b, secondaryColor: e.target.value }))}
                className="w-full h-8 rounded cursor-pointer"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block font-medium">Logo Upload &amp; Position</label>
            <div className="flex items-center gap-2">
              <label className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer">
                Upload Logo
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => handleUploadAsset(e, 'logo')} className="hidden" />
              </label>
              <select
                value={branding.logoPosition}
                onChange={(e) => setBranding((b) => ({ ...b, logoPosition: e.target.value as BrandingConfig['logoPosition'] }))}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              >
                <option value="top-left">Top Left</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
              </select>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-medium">Wall Screen Graphic</span>
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
              placeholder="Screen text"
            />
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-medium">Lower-Third Title</span>
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
              placeholder="Title"
            />
            <input
              value={branding.lowerThirdSubtitle}
              onChange={(e) => setBranding((b) => ({ ...b, lowerThirdSubtitle: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
              placeholder="Subtitle"
            />
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <label className="block font-medium">Foreground Desk</label>
            <select
              value={fg.deskStyle}
              onChange={(e) =>
                setFg((f) => ({
                  ...f,
                  enabled: e.target.value !== 'none',
                  deskStyle: e.target.value as ForegroundMaskConfig['deskStyle'],
                }))
              }
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#080B14] border border-slate-300 dark:border-slate-700"
            >
              <option value="none">No Desk</option>
              <option value="news_glass">News Glass Desk</option>
              <option value="church_pulpit">Sanctuary Wood Pulpit</option>
              <option value="podcast_oak">Podcast Oak Table</option>
              <option value="minimal_slate">Minimalist Slate</option>
            </select>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
