import type {
  AspectRatio,
  BrandingConfig,
  ForegroundMaskConfig,
  LightingPreset,
  SubjectConfig,
} from '../../shared/types';
import {
  analyzeImageColorStats,
  clamp,
  computeCinematicCameraTransform,
  computeEnvironmentColorMatch,
  getColorGradeFilter,
  type ImageColorStats,
} from './mattingMath';

export interface StudioRenderScene {
  backgroundImg: HTMLImageElement | null;
  customMaskImg: HTMLImageElement | null;
  logoImg: HTMLImageElement | null;
  subjectCanvas: HTMLCanvasElement | null;
  fgStats?: ImageColorStats | null;
  timeMs?: number;
  subjectConfig: SubjectConfig;
  foregroundMaskConfig: ForegroundMaskConfig;
  brandingConfig: BrandingConfig;
  lightingPreset: LightingPreset;
  aspectRatio: AspectRatio;
  mirrorCamera: boolean;
  watermarkRequired: boolean;
  transparentBackground?: boolean; // For keyed OBS output
}

// Reusable lightweight offscreen canvases for studio light-wrap & color-match compositing
let envCanvas: HTMLCanvasElement | null = null;
let envCtx: CanvasRenderingContext2D | null = null;
let wrapCanvas: HTMLCanvasElement | null = null;
let wrapCtx: CanvasRenderingContext2D | null = null;
let tintCanvas: HTMLCanvasElement | null = null;
let tintCtx: CanvasRenderingContext2D | null = null;
let gradeCanvas: HTMLCanvasElement | null = null;
let gradeCtx: CanvasRenderingContext2D | null = null;
let sampleToneCanvas: HTMLCanvasElement | null = null;
let sampleToneCtx: CanvasRenderingContext2D | null = null;

const bgStatsCache = new WeakMap<HTMLImageElement, ImageColorStats>();

export function analyzeBackgroundStats(img: HTMLImageElement | null): ImageColorStats | null {
  if (!img || !img.complete || img.naturalWidth === 0 || typeof document === 'undefined') {
    return null;
  }
  const cached = bgStatsCache.get(img);
  if (cached) return cached;
  try {
    if (!sampleToneCanvas) {
      sampleToneCanvas = document.createElement('canvas');
      sampleToneCanvas.width = 32;
      sampleToneCanvas.height = 18;
      sampleToneCtx = sampleToneCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!sampleToneCtx) return null;
    sampleToneCtx.clearRect(0, 0, 32, 18);
    sampleToneCtx.drawImage(img, 0, 0, 32, 18);
    const data = sampleToneCtx.getImageData(0, 0, 32, 18).data;
    const stats = analyzeImageColorStats(data, 32, 18);
    bgStatsCache.set(img, stats);
    return stats;
  } catch {
    return null;
  }
}

function ensureWrapBuffers(ew: number, eh: number): {
  envC: HTMLCanvasElement;
  envX: CanvasRenderingContext2D;
  wrapC: HTMLCanvasElement;
  wrapX: CanvasRenderingContext2D;
  tintC: HTMLCanvasElement;
  tintX: CanvasRenderingContext2D;
} | null {
  if (typeof document === 'undefined') return null;
  if (!envCanvas) {
    envCanvas = document.createElement('canvas');
    envCtx = envCanvas.getContext('2d');
  }
  if (!wrapCanvas) {
    wrapCanvas = document.createElement('canvas');
    wrapCtx = wrapCanvas.getContext('2d');
  }
  if (!tintCanvas) {
    tintCanvas = document.createElement('canvas');
    tintCtx = tintCanvas.getContext('2d');
  }
  if (!envCtx || !wrapCtx || !tintCtx) return null;
  if (envCanvas.width !== ew || envCanvas.height !== eh) {
    envCanvas.width = ew;
    envCanvas.height = eh;
    wrapCanvas.width = ew;
    wrapCanvas.height = eh;
    tintCanvas.width = ew;
    tintCanvas.height = eh;
  }
  return { envC: envCanvas, envX: envCtx, wrapC: wrapCanvas, wrapX: wrapCtx, tintC: tintCanvas, tintX: tintCtx };
}

function ensureGradeBuffer(w: number, h: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  if (!gradeCanvas) {
    gradeCanvas = document.createElement('canvas');
    gradeCtx = gradeCanvas.getContext('2d');
  }
  if (!gradeCtx) return null;
  if (gradeCanvas.width !== w || gradeCanvas.height !== h) {
    gradeCanvas.width = w;
    gradeCanvas.height = h;
  }
  return { c: gradeCanvas, x: gradeCtx };
}

export function getAspectDimensions(ratio: AspectRatio, resolution: '720p' | '1080p' | '4k'): { width: number; height: number } {
  const baseHeight = resolution === '4k' ? 2160 : resolution === '1080p' ? 1080 : 720;
  if (ratio === '9:16') {
    const w = resolution === '4k' ? 1080 : resolution === '1080p' ? 1080 : 720;
    const h = Math.round((w * 16) / 9);
    return { width: w, height: h };
  }
  if (ratio === '1:1') {
    return { width: baseHeight, height: baseHeight };
  }
  return { width: Math.round((baseHeight * 16) / 9), height: baseHeight };
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cw: number,
  ch: number,
  overscan = 1,
  shiftX = 0,
  shiftY = 0
): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(cw / iw, ch / ih) * overscan;
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (cw - dw) / 2 + shiftX;
  const dy = (ch - dh) / 2 + shiftY;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawForegroundDesk(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fg: ForegroundMaskConfig,
  customMaskImg: HTMLImageElement | null,
  branding: BrandingConfig,
  camScaleMul = 1,
  camPanX = 0
): void {
  if (!fg.enabled || fg.deskStyle === 'none') return;

  ctx.save();
  ctx.globalAlpha = Math.max(0.2, Math.min(1, fg.deskOpacity ?? 0.96));

  if (camScaleMul !== 1 || camPanX !== 0) {
    ctx.translate(w / 2 + camPanX * w * 1.15, h);
    ctx.scale(camScaleMul, camScaleMul);
    ctx.translate(-w / 2, -h);
  }

  if (fg.deskStyle === 'custom_mask' && customMaskImg && customMaskImg.complete) {
    drawCoverImage(ctx, customMaskImg, w, h);
    ctx.restore();
    return;
  }

  const deskH = Math.round(h * Math.max(0.14, Math.min(0.55, fg.deskHeightRatio || 0.25)));
  const topY = h - deskH;
  const tiltOffset = (fg.perspectiveTilt || 0) * (w * 0.002);

  if (fg.deskStyle === 'church_pulpit') {
    const podiumW = Math.round(w * 0.34);
    const podiumX = Math.round((w - podiumW) / 2);
    const topLipH = Math.round(deskH * 0.16);

    const topGrad = ctx.createLinearGradient(0, topY, 0, topY + topLipH);
    topGrad.addColorStop(0, '#784B2A');
    topGrad.addColorStop(1, '#4E2F18');
    ctx.fillStyle = topGrad;
    ctx.beginPath();
    ctx.moveTo(podiumX - 18, topY + tiltOffset);
    ctx.lineTo(podiumX + podiumW + 18, topY - tiltOffset);
    ctx.lineTo(podiumX + podiumW, topY + topLipH);
    ctx.lineTo(podiumX, topY + topLipH);
    ctx.closePath();
    ctx.fill();

    const bodyGrad = ctx.createLinearGradient(podiumX, topY + topLipH, podiumX + podiumW, h);
    bodyGrad.addColorStop(0, '#3D2414');
    bodyGrad.addColorStop(0.5, '#59361E');
    bodyGrad.addColorStop(1, '#27170C');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(podiumX, topY + topLipH, podiumW, deskH - topLipH);

    ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.fillRect(podiumX, topY + topLipH, podiumW, 2);
  } else if (fg.deskStyle === 'news_glass') {
    const deskW = Math.round(w * 0.72);
    const deskX = Math.round((w - deskW) / 2);
    const topThickness = Math.round(deskH * 0.14);

    const glassGrad = ctx.createLinearGradient(deskX, topY, deskX + deskW, topY + topThickness);
    glassGrad.addColorStop(0, 'rgba(148, 163, 184, 0.35)');
    glassGrad.addColorStop(0.5, 'rgba(226, 232, 240, 0.55)');
    glassGrad.addColorStop(1, 'rgba(56, 189, 248, 0.32)');
    ctx.fillStyle = glassGrad;
    ctx.beginPath();
    ctx.moveTo(deskX - 24, topY + tiltOffset);
    ctx.lineTo(deskX + deskW + 24, topY - tiltOffset);
    ctx.lineTo(deskX + deskW, topY + topThickness);
    ctx.lineTo(deskX, topY + topThickness);
    ctx.closePath();
    ctx.fill();

    const fasciaGrad = ctx.createLinearGradient(0, topY + topThickness, 0, h);
    fasciaGrad.addColorStop(0, '#0F172A');
    fasciaGrad.addColorStop(1, '#060913');
    ctx.fillStyle = fasciaGrad;
    ctx.fillRect(deskX, topY + topThickness, deskW, deskH - topThickness);

    ctx.fillStyle = branding.secondaryColor || '#06B6D4';
    ctx.fillRect(deskX + 20, topY + topThickness + 8, deskW - 40, 3);
  } else if (fg.deskStyle === 'podcast_oak') {
    const deskW = Math.round(w * 0.86);
    const deskX = Math.round((w - deskW) / 2);
    const topThickness = Math.round(deskH * 0.22);

    const oakGrad = ctx.createLinearGradient(0, topY, 0, topY + topThickness);
    oakGrad.addColorStop(0, '#6B442A');
    oakGrad.addColorStop(1, '#4A2E1B');
    ctx.fillStyle = oakGrad;
    ctx.beginPath();
    ctx.moveTo(deskX - 16, topY + tiltOffset);
    ctx.lineTo(deskX + deskW + 16, topY - tiltOffset);
    ctx.lineTo(deskX + deskW, topY + topThickness);
    ctx.lineTo(deskX, topY + topThickness);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#181412';
    ctx.fillRect(deskX, topY + topThickness, deskW, deskH - topThickness);
  } else {
    const deskW = Math.round(w * 0.8);
    const deskX = Math.round((w - deskW) / 2);
    const slateGrad = ctx.createLinearGradient(0, topY, 0, h);
    slateGrad.addColorStop(0, '#1E293B');
    slateGrad.addColorStop(0.15, '#111827');
    slateGrad.addColorStop(1, '#080B14');
    ctx.fillStyle = slateGrad;
    ctx.beginPath();
    ctx.moveTo(deskX - 18, topY + tiltOffset);
    ctx.lineTo(deskX + deskW + 18, topY - tiltOffset);
    ctx.lineTo(deskX + deskW, h);
    ctx.lineTo(deskX, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(deskX - 12, topY, deskW + 24, 2);
  }

  ctx.restore();
}

export function renderStudioFrame(ctx: CanvasRenderingContext2D, w: number, h: number, scene: StudioRenderScene): void {
  ctx.clearRect(0, 0, w, h);

  const sc = scene.subjectConfig;
  const cam = computeCinematicCameraTransform(scene.timeMs ?? 0, sc.cinematic);
  const bgStats = analyzeBackgroundStats(scene.backgroundImg);
  const autoMatchEnabled = sc.autoColorMatch ?? true;
  const colorComp = computeEnvironmentColorMatch(scene.fgStats ?? null, bgStats, scene.lightingPreset, {
    autoColorMatch: autoMatchEnabled,
    colorMatchStrength: sc.colorMatchStrength ?? 0.72,
    exposureMatch: sc.exposureMatch ?? 0.65,
  });

  // 1. 2.5D Background Layer with perspective horizon shift, camera push-in/drift, and depth-of-field blur
  const horizonShiftPx = clamp(sc.cinematic?.bgHorizonShift ?? 0, -0.15, 0.15) * h;
  const parallaxX =
    (Math.max(-0.02, Math.min(0.02, -(sc.offsetX || 0) * 0.08)) + cam.panXNorm * 0.7) * w;
  const parallaxY =
    (Math.max(-0.015, Math.min(0.015, -(sc.offsetY || 0) * 0.05)) + cam.panYNorm * 0.7) * h + horizonShiftPx;
  const bgOverscan = Math.max(1.04, cam.bgScale);

  if (!scene.transparentBackground) {
    ctx.save();
    if (scene.backgroundImg && scene.backgroundImg.complete && scene.backgroundImg.naturalWidth > 0) {
      if (sc.bgBlur > 0) {
        ctx.filter = `blur(${sc.bgBlur}px)`;
      }
      drawCoverImage(ctx, scene.backgroundImg, w, h, bgOverscan, parallaxX, parallaxY);
      ctx.filter = 'none';
    } else {
      const bgGrad = ctx.createLinearGradient(0, 0, w, h);
      bgGrad.addColorStop(0, '#0B1020');
      bgGrad.addColorStop(1, '#172033');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);
    }

    if (scene.lightingPreset === 'warm_studio') {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
      ctx.fillRect(0, 0, w, h);
    } else if (scene.lightingPreset === 'cool_broadcast') {
      ctx.fillStyle = 'rgba(6, 182, 212, 0.08)';
      ctx.fillRect(0, 0, w, h);
    } else if (scene.lightingPreset === 'dramatic') {
      const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, w * 0.18, w * 0.5, h * 0.5, w * 0.72);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.48)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  // 2. Virtual Wall Screen Graphic Layer (behind subject)
  if (scene.brandingConfig.showScreenGraphic && scene.brandingConfig.screenText.trim()) {
    ctx.save();
    const boxW = Math.round(w * 0.36);
    const boxH = Math.round(h * 0.14);
    const boxX = Math.round(w * 0.06 + parallaxX * 0.5);
    const boxY = Math.round(h * 0.1 + parallaxY * 0.5);
    ctx.fillStyle = 'rgba(8, 11, 20, 0.72)';
    ctx.strokeStyle = scene.brandingConfig.secondaryColor || '#06B6D4';
    ctx.lineWidth = 2;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = `600 ${Math.max(14, Math.round(h * 0.03))}px Outfit, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(scene.brandingConfig.screenText.slice(0, 32), boxX + 18, boxY + boxH / 2, boxW - 36);
    ctx.restore();
  }

  // 3. Subject Layer + Skin-Safe Environment Color Matching + Grounded Shadow + Ambient Light Wrap
  if (scene.subjectCanvas && scene.subjectCanvas.width > 0 && scene.subjectCanvas.height > 0) {
    const sw = scene.subjectCanvas.width;
    const sh = scene.subjectCanvas.height;

    const baseScale = Math.min(w / sw, h / sh) * sc.scale * cam.subjectScaleMul;
    const drawW = sw * baseScale;
    const drawH = sh * baseScale;
    const cx = w / 2 + (sc.offsetX + cam.panXNorm) * w;
    const cy = h - drawH / 2 + (sc.offsetY + cam.panYNorm) * h;

    // 3a. Grounded Studio Contact Shadow (projected behind subject toward desk/floor plane, never around face/hair)
    if (sc.shadowIntensity > 0.02 && !scene.transparentBackground) {
      ctx.save();
      const deskOffset = scene.foregroundMaskConfig.enabled && scene.foregroundMaskConfig.deskStyle !== 'none'
        ? h * (scene.foregroundMaskConfig.deskHeightRatio || 0.25) * 0.72
        : 0;
      const anchorY = Math.min(h * 0.96, cy + drawH * 0.36 - deskOffset * 0.25);
      const shadowRx = Math.max(40, drawW * 0.28);
      const shadowRy = Math.max(16, drawH * 0.14);
      const g = ctx.createRadialGradient(cx + 8, anchorY, shadowRx * 0.1, cx + 8, anchorY, shadowRx);
      const sAlpha = clamp(sc.shadowIntensity * 0.45, 0.04, 0.42);
      g.addColorStop(0, `rgba(4, 8, 18, ${sAlpha})`);
      g.addColorStop(0.55, `rgba(4, 8, 18, ${sAlpha * 0.42})`);
      g.addColorStop(1, 'rgba(4, 8, 18, 0)');
      ctx.translate(cx + 8, anchorY);
      ctx.scale(1, shadowRy / shadowRx);
      ctx.translate(-(cx + 8), -anchorY);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx + 8, anchorY, shadowRx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3b. Combined Manual + Automatic Environment Color/Exposure Filter + Sharpness Matching
    const combinedBrightness = clamp(sc.brightness * colorComp.exposureGain, 0.55, 1.55);
    const combinedContrast = clamp(
      sc.contrast * colorComp.contrastGain + Math.max(0, sc.fgSharpness ?? 0) * 0.08,
      0.55,
      1.6
    );
    const combinedSat = clamp(sc.saturation * colorComp.saturationGain, 0, 2.0);
    const fgSharp = clamp(sc.fgSharpness ?? 0, -1, 1);

    ctx.save();
    const filters: string[] = [
      `brightness(${combinedBrightness.toFixed(3)})`,
      `contrast(${combinedContrast.toFixed(3)})`,
      `saturate(${combinedSat.toFixed(3)})`,
    ];

    const manualWarmSepia = sc.colorTemp > 5 ? Math.min(0.28, (sc.colorTemp / 100) * 0.4) : 0;
    const totalWarmSepia = clamp(manualWarmSepia + colorComp.warmSepia, 0, 0.3);
    if (totalWarmSepia > 0.005) {
      filters.push(`sepia(${totalWarmSepia.toFixed(3)})`);
    }

    const manualCoolDeg = sc.colorTemp < -5 ? Math.max(-18, sc.colorTemp * 0.3) : 0;
    const totalCoolDeg = clamp(manualCoolDeg + colorComp.coolHueDeg, -20, 0);
    if (totalCoolDeg < -0.5) {
      filters.push(`hue-rotate(${totalCoolDeg.toFixed(1)}deg)`);
    }

    // Match studio softness when subject camera is overly crispy against blurred studio depth
    if (fgSharp < -0.05) {
      filters.push(`blur(${(Math.abs(fgSharp) * 1.15).toFixed(2)}px)`);
    }

    ctx.filter = filters.join(' ');

    if (sc.shadowIntensity > 0.01) {
      ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.26, sc.shadowIntensity * 0.28)})`;
      ctx.shadowBlur = Math.round(h * 0.038);
      ctx.shadowOffsetY = Math.round(h * 0.01);
    }

    ctx.translate(cx, cy);
    if (scene.mirrorCamera) {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(scene.subjectCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // 3c. Ambient Color Harmonies + 2-4px Studio Edge Light Wrap
    const lightWrap = Math.max(0, Math.min(1, sc.lightWrap ?? 0.28));
    if ((lightWrap > 0.01 || colorComp.ambientTintAlpha > 0.01) && !scene.transparentBackground) {
      const ew = Math.min(340, Math.max(140, Math.round(w * 0.28)));
      const eh = Math.max(76, Math.round((ew / w) * h));
      const bufs = ensureWrapBuffers(ew, eh);
      if (bufs) {
        const { envC, envX, wrapC, wrapX, tintC, tintX } = bufs;
        const scaleRatio = ew / w;
        const sCx = cx * scaleRatio;
        const sCy = cy * scaleRatio;
        const sDw = drawW * scaleRatio;
        const sDh = drawH * scaleRatio;

        // Atmospheric Soft-Light Harmony Wash across subject (skin-safe intensity)
        const washAlpha = Math.max(
          colorComp.ambientTintAlpha,
          Math.min(0.16, lightWrap * 0.28)
        );
        if (washAlpha > 0.01) {
          const { r, g, b } = colorComp.ambientTintRgb;
          tintX.save();
          tintX.clearRect(0, 0, ew, eh);
          tintX.translate(sCx, sCy);
          if (scene.mirrorCamera) tintX.scale(-1, 1);
          tintX.drawImage(scene.subjectCanvas, -sDw / 2, -sDh / 2, sDw, sDh);
          tintX.globalCompositeOperation = 'source-in';
          tintX.fillStyle = `rgb(${r}, ${g}, ${b})`;
          tintX.fillRect(-sDw / 2 - 4, -sDh / 2 - 4, sDw + 8, sDh + 8);
          tintX.restore();

          ctx.save();
          ctx.globalCompositeOperation = 'soft-light';
          ctx.globalAlpha = washAlpha;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(tintC, 0, 0, w, h);
          ctx.restore();
        }

        // Studio Background Light Wrap inside outer 2-4px hair & shoulder edge
        if (lightWrap > 0.01) {
          envX.save();
          envX.clearRect(0, 0, ew, eh);
          envX.filter = 'blur(8px)';
          if (scene.backgroundImg && scene.backgroundImg.complete && scene.backgroundImg.naturalWidth > 0) {
            drawCoverImage(
              envX,
              scene.backgroundImg,
              ew,
              eh,
              bgOverscan,
              parallaxX * scaleRatio,
              parallaxY * scaleRatio
            );
          } else {
            const g = envX.createLinearGradient(0, 0, ew, eh);
            g.addColorStop(0, '#0B1020');
            g.addColorStop(1, '#172033');
            envX.fillStyle = g;
            envX.fillRect(0, 0, ew, eh);
          }
          envX.restore();

          wrapX.save();
          wrapX.clearRect(0, 0, ew, eh);
          wrapX.drawImage(envC, 0, 0, ew, eh);

          wrapX.save();
          wrapX.translate(sCx, sCy);
          if (scene.mirrorCamera) wrapX.scale(-1, 1);
          wrapX.globalCompositeOperation = 'destination-out';
          wrapX.filter = 'blur(4px)';
          wrapX.drawImage(scene.subjectCanvas, -sDw / 2, -sDh / 2, sDw, sDh);
          wrapX.restore();

          wrapX.save();
          wrapX.translate(sCx, sCy);
          if (scene.mirrorCamera) wrapX.scale(-1, 1);
          wrapX.globalCompositeOperation = 'destination-in';
          wrapX.drawImage(scene.subjectCanvas, -sDw / 2, -sDh / 2, sDw, sDh);
          wrapX.restore();
          wrapX.restore();

          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = Math.min(0.62, lightWrap * 0.78);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(wrapC, 0, 0, w, h);
          ctx.restore();
        }
      }
    }
  }

  // 4. Foreground Desk Layer (scaled cohesively in 2.5D Z-space with camera motion)
  drawForegroundDesk(
    ctx,
    w,
    h,
    scene.foregroundMaskConfig,
    scene.customMaskImg,
    scene.brandingConfig,
    cam.fgScaleMul,
    cam.panXNorm
  );

  // 5. Branding & Broadcast Graphics Layer
  if (scene.logoImg && scene.logoImg.complete && scene.logoImg.naturalWidth > 0) {
    ctx.save();
    const maxLogoH = Math.round(h * 0.08);
    const ratio = scene.logoImg.naturalWidth / scene.logoImg.naturalHeight;
    const lw = Math.round(maxLogoH * ratio);
    const pad = Math.round(w * 0.025);
    const pos = scene.brandingConfig.logoPosition;
    const lx = pos.includes('right') ? w - lw - pad : pad;
    const ly = pos.includes('bottom') ? h - maxLogoH - pad : pad;
    ctx.drawImage(scene.logoImg, lx, ly, lw, maxLogoH);
    ctx.restore();
  }

  if (scene.brandingConfig.showLowerThird && scene.brandingConfig.lowerThirdTitle.trim()) {
    ctx.save();
    const ltW = Math.round(w * 0.44);
    const ltH = Math.round(h * 0.11);
    const ltX = Math.round(w * 0.04);
    const ltY = Math.round(h * 0.83);

    ctx.fillStyle = 'rgba(8, 11, 20, 0.88)';
    ctx.fillRect(ltX, ltY, ltW, ltH);
    ctx.fillStyle = scene.brandingConfig.primaryColor || '#6366F1';
    ctx.fillRect(ltX, ltY, 6, ltH);

    ctx.fillStyle = '#F8FAFC';
    ctx.font = `700 ${Math.max(15, Math.round(h * 0.032))}px Outfit, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(scene.brandingConfig.lowerThirdTitle.slice(0, 40), ltX + 20, ltY + Math.round(ltH * 0.18), ltW - 32);

    if (scene.brandingConfig.lowerThirdSubtitle.trim()) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = `500 ${Math.max(12, Math.round(h * 0.022))}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillText(scene.brandingConfig.lowerThirdSubtitle.slice(0, 56), ltX + 20, ltY + Math.round(ltH * 0.56), ltW - 32);
    }
    ctx.restore();
  }

  // 6. Master Cinematic Color Grade + Smooth Transition (applied across composited scene)
  const gradeFilter = !scene.transparentBackground ? getColorGradeFilter(sc.cinematic?.colorGrade) : '';
  if (gradeFilter) {
    const gBuf = ensureGradeBuffer(w, h);
    if (gBuf) {
      gBuf.x.clearRect(0, 0, w, h);
      gBuf.x.drawImage(ctx.canvas, 0, 0, w, h);
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      ctx.filter = gradeFilter;
      ctx.drawImage(gBuf.c, 0, 0, w, h);
      ctx.restore();
    }
  }

  if (!scene.transparentBackground && cam.fadeAlpha < 0.999) {
    ctx.save();
    ctx.fillStyle = `rgba(6, 9, 19, ${(1 - cam.fadeAlpha).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // 7. Free Plan Watermark
  if (scene.watermarkRequired) {
    ctx.save();
    const text = 'NexaStudios';
    ctx.font = `600 ${Math.max(13, Math.round(h * 0.024))}px Outfit, sans-serif`;
    const metrics = ctx.measureText(text);
    const padX = 14;
    const boxW = metrics.width + padX * 2;
    const boxH = Math.round(h * 0.048);
    const bx = w - boxW - Math.round(w * 0.025);
    const by = h - boxH - Math.round(h * 0.025);
    ctx.fillStyle = 'rgba(8, 11, 20, 0.62)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = 'rgba(248, 250, 252, 0.88)';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padX, by + boxH / 2);
    ctx.restore();
  }
}
