import type {
  AspectRatio,
  BrandingConfig,
  ForegroundMaskConfig,
  LightingPreset,
  SubjectConfig,
} from '../../shared/types';

export interface StudioRenderScene {
  backgroundImg: HTMLImageElement | null;
  customMaskImg: HTMLImageElement | null;
  logoImg: HTMLImageElement | null;
  subjectCanvas: HTMLCanvasElement | null;
  subjectConfig: SubjectConfig;
  foregroundMaskConfig: ForegroundMaskConfig;
  brandingConfig: BrandingConfig;
  lightingPreset: LightingPreset;
  aspectRatio: AspectRatio;
  mirrorCamera: boolean;
  watermarkRequired: boolean;
  transparentBackground?: boolean; // For keyed OBS output
}

// Reusable lightweight offscreen canvases for studio light-wrap compositing (zero GC overhead)
let envCanvas: HTMLCanvasElement | null = null;
let envCtx: CanvasRenderingContext2D | null = null;
let wrapCanvas: HTMLCanvasElement | null = null;
let wrapCtx: CanvasRenderingContext2D | null = null;

function ensureWrapBuffers(ew: number, eh: number): {
  envC: HTMLCanvasElement;
  envX: CanvasRenderingContext2D;
  wrapC: HTMLCanvasElement;
  wrapX: CanvasRenderingContext2D;
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
  if (!envCtx || !wrapCtx) return null;
  if (envCanvas.width !== ew || envCanvas.height !== eh) {
    envCanvas.width = ew;
    envCanvas.height = eh;
    wrapCanvas.width = ew;
    wrapCanvas.height = eh;
  }
  return { envC: envCanvas, envX: envCtx, wrapC: wrapCanvas, wrapX: wrapCtx };
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

function drawCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cw: number, ch: number): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(cw / iw, ch / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawForegroundDesk(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fg: ForegroundMaskConfig,
  customMaskImg: HTMLImageElement | null,
  branding: BrandingConfig
): void {
  if (!fg.enabled || fg.deskStyle === 'none') return;

  ctx.save();
  ctx.globalAlpha = Math.max(0.2, Math.min(1, fg.deskOpacity ?? 0.96));

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

  // 1. Background Layer
  if (!scene.transparentBackground) {
    ctx.save();
    if (scene.backgroundImg && scene.backgroundImg.complete && scene.backgroundImg.naturalWidth > 0) {
      if (scene.subjectConfig.bgBlur > 0) {
        ctx.filter = `blur(${scene.subjectConfig.bgBlur}px)`;
      }
      drawCoverImage(ctx, scene.backgroundImg, w, h);
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
    const boxX = Math.round(w * 0.06);
    const boxY = Math.round(h * 0.1);
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

  // 3. Subject Layer + Ambient Studio Light Wrap
  if (scene.subjectCanvas && scene.subjectCanvas.width > 0 && scene.subjectCanvas.height > 0) {
    const sc = scene.subjectConfig;
    const sw = scene.subjectCanvas.width;
    const sh = scene.subjectCanvas.height;

    const baseScale = Math.min(w / sw, h / sh) * sc.scale;
    const drawW = sw * baseScale;
    const drawH = sh * baseScale;
    const cx = w / 2 + sc.offsetX * w;
    const cy = h - drawH / 2 + sc.offsetY * h;

    ctx.save();
    const filters: string[] = [
      `brightness(${sc.brightness})`,
      `contrast(${sc.contrast})`,
      `saturate(${sc.saturation})`,
    ];
    if (sc.colorTemp > 5) {
      filters.push(`sepia(${Math.min(0.28, (sc.colorTemp / 100) * 0.4)})`);
    } else if (sc.colorTemp < -5) {
      filters.push(`hue-rotate(${Math.max(-18, sc.colorTemp * 0.3)}deg)`);
    }
    if (scene.lightingPreset === 'warm_studio') {
      filters.push('sepia(0.06)');
    }
    ctx.filter = filters.join(' ');

    // Subtle soft studio depth (avoiding heavy dark cutout outline ring around hair/shoulders)
    if (sc.shadowIntensity > 0.01) {
      ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.32, sc.shadowIntensity * 0.32)})`;
      ctx.shadowBlur = Math.round(h * 0.045);
      ctx.shadowOffsetY = Math.round(h * 0.012);
    }

    ctx.translate(cx, cy);
    if (scene.mirrorCamera) {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(scene.subjectCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Realistic Ambient Light Wrap: softly wraps studio wall colors 2-4px inward along the subject edge
    const lightWrap = Math.max(0, Math.min(1, sc.lightWrap ?? 0.25));
    if (lightWrap > 0.01 && !scene.transparentBackground) {
      const ew = Math.min(320, Math.max(120, Math.round(w * 0.28)));
      const eh = Math.max(68, Math.round((ew / w) * h));
      const bufs = ensureWrapBuffers(ew, eh);
      if (bufs) {
        const { envC, envX, wrapC, wrapX } = bufs;
        const scaleRatio = ew / w;
        const sCx = cx * scaleRatio;
        const sCy = cy * scaleRatio;
        const sDw = drawW * scaleRatio;
        const sDh = drawH * scaleRatio;

        // Capture diffused ambient background wall light
        envX.save();
        envX.clearRect(0, 0, ew, eh);
        envX.filter = 'blur(8px)';
        if (scene.backgroundImg && scene.backgroundImg.complete && scene.backgroundImg.naturalWidth > 0) {
          drawCoverImage(envX, scene.backgroundImg, ew, eh);
        } else {
          const g = envX.createLinearGradient(0, 0, ew, eh);
          g.addColorStop(0, '#0B1020');
          g.addColorStop(1, '#172033');
          envX.fillStyle = g;
          envX.fillRect(0, 0, ew, eh);
        }
        envX.restore();

        // Carve out inner core so only the outer 2-4px rim inside the silhouette keeps background light
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

        // Strictly clamp within crisp subject alpha so wrap stays 100% inside the person
        wrapX.save();
        wrapX.translate(sCx, sCy);
        if (scene.mirrorCamera) wrapX.scale(-1, 1);
        wrapX.globalCompositeOperation = 'destination-in';
        wrapX.drawImage(scene.subjectCanvas, -sDw / 2, -sDh / 2, sDw, sDh);
        wrapX.restore();
        wrapX.restore();

        // Blend wrapped edge highlight gently onto the subject on main canvas
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = Math.min(0.65, lightWrap * 0.8);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(wrapC, 0, 0, w, h);
        ctx.restore();
      }
    }
  }

  // 4. Foreground Layer (Virtual Desk / Pulpit / Custom Mask rendered IN FRONT of lower subject)
  drawForegroundDesk(ctx, w, h, scene.foregroundMaskConfig, scene.customMaskImg, scene.brandingConfig);

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

  // 6. Free Plan Watermark
  if (scene.watermarkRequired) {
    ctx.save();
    const text = 'NexaFlow AI Studio';
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
