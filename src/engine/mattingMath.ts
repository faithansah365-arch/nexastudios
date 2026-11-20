import type { CinematicConfig, ColorGradePreset, LightingPreset } from '../../shared/types';

export interface MaskPipelineBuffers {
  currLuma: Float32Array;
  prevLuma: Float32Array;
  motion: Float32Array;
  raw: Float32Array;
  joint: Float32Array;
  erodeH: Float32Array;
  eroded: Float32Array;
  temporal: Float32Array;
  blurH: Float32Array;
  final: Float32Array;
  prevGood: Float32Array;
}

export function createMaskPipelineBuffers(len: number): MaskPipelineBuffers {
  return {
    currLuma: new Float32Array(len),
    prevLuma: new Float32Array(len),
    motion: new Float32Array(len),
    raw: new Float32Array(len),
    joint: new Float32Array(len),
    erodeH: new Float32Array(len),
    eroded: new Float32Array(len),
    temporal: new Float32Array(len),
    blurH: new Float32Array(len),
    final: new Float32Array(len),
    prevGood: new Float32Array(len),
  };
}

export type MaskIssueCategory = 'leakage' | 'flicker' | 'dropout' | 'halo';

export type MaskHealthState = 'ok' | 'recovered' | 'flagged';

export interface MaskHealthMetrics {
  state: MaskHealthState;
  coverage: number;
  borderLeakage: number;
  iouStability: number;
  recoveryStreak: number;
  issueCategory: MaskIssueCategory | null;
  issueReason: string | null;
}

export interface ImageColorStats {
  meanLuma: number; // 0..255
  contrastStd: number; // ~0..90
  meanR: number;
  meanG: number;
  meanB: number;
  warmth: number; // -1 (cool blue) to +1 (warm amber)
  sampleCount: number;
}

export interface ColorMatchCompensation {
  exposureGain: number; // multiplier around 1.0
  contrastGain: number; // multiplier around 1.0
  warmSepia: number; // 0..0.18
  coolHueDeg: number; // -12..0
  saturationGain: number; // multiplier around 1.0
  ambientTintRgb: { r: number; g: number; b: number };
  ambientTintAlpha: number; // 0..0.24
  mismatchScore: number; // 0..1 (0 = well matched, 1 = severe mismatch)
}

export interface CinematicCameraState {
  bgScale: number;
  subjectScaleMul: number;
  fgScaleMul: number;
  panXNorm: number; // normalized -0.04..0.04
  panYNorm: number; // normalized -0.025..0.025
  fadeAlpha: number; // 0..1 opacity for scene transition fade-in
}

export function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

/**
 * Extracts Rec.709 perceptual luminance (0..255) and normalized motion map (0..1)
 * between consecutive video frames while suppressing camera sensor grain.
 */
export function extractLumaAndMotion(
  rgbaPixels: Uint8ClampedArray | Uint8Array,
  bufs: MaskPipelineBuffers,
  totalPixels: number,
  hasPrevFrame: boolean
): void {
  const { currLuma, prevLuma, motion } = bufs;
  for (let i = 0; i < totalPixels; i++) {
    const p = i * 4;
    const luma = rgbaPixels[p] * 0.2126 + rgbaPixels[p + 1] * 0.7152 + rgbaPixels[p + 2] * 0.0722;
    currLuma[i] = luma;
    if (hasPrevFrame) {
      const diff = Math.abs(luma - prevLuma[i]) / 255;
      // Deadzone suppresses static wall sensor noise (<4.5%) so walls stay temporally locked
      motion[i] = diff <= 0.045 ? 0 : clamp((diff - 0.045) * 3.2, 0, 1);
    } else {
      motion[i] = 0;
    }
    prevLuma[i] = luma;
  }
}

export interface RefineMaskParams {
  bodySensitivity: number; // 0..1
  edgeChoke: number; // 0..1
  edgeSoftness: number; // 0..10 px
  temporalStability: number; // 0..1
  hasTemporalHistory: boolean;
}

/**
 * Runs multi-stage alpha refinement:
 * 1. Motion-aware confidence remapping (protects moving hands/hair from clipping)
 * 2. Interior torso/clothing hole recovery
 * 3. Joint edge-guided refinement using source luminance gradients (tight hair/collar contours)
 * 4. Motion-protected inward anti-halo erosion
 * 5. Motion-adaptive temporal stabilization
 * 6. Strictly inward spatial feathering (never bleeds alpha outward into room wall)
 */
export function refineAlphaMaskPipeline(
  confidenceFloats: Float32Array,
  w: number,
  h: number,
  bufs: MaskPipelineBuffers,
  params: RefineMaskParams
): Float32Array {
  const total = w * h;
  const sensitivity = clamp(params.bodySensitivity, 0, 1);
  const choke = clamp(params.edgeChoke, 0, 1);
  const softness = clamp(params.edgeSoftness, 0, 10);
  const stability = clamp(params.temporalStability, 0, 1);

  const { raw, motion, currLuma, joint, erodeH, eroded, temporal, blurH, final } = bufs;

  const baseLow = Math.max(0.08, 0.36 - sensitivity * 0.22 + choke * 0.12);
  const baseHigh = Math.max(baseLow + 0.16, 0.78 - sensitivity * 0.2);

  // 1. Calibrated smoothstep + motion sensitivity protection for fast-moving hands/arms
  for (let i = 0; i < total; i++) {
    const conf = confidenceFloats[i];
    const m = motion[i];
    const low = Math.max(0.06, baseLow - m * 0.09);
    const high = Math.max(low + 0.14, baseHigh - m * 0.07);
    if (conf <= low) {
      raw[i] = 0;
    } else if (conf >= high) {
      raw[i] = 1;
    } else {
      const t = (conf - low) / (high - low);
      raw[i] = t * t * (3 - 2 * t);
    }
  }

  // 2. Interior hole & limb continuity fill
  if (sensitivity > 0.3) {
    const recoverWeight = Math.min(1, (sensitivity - 0.3) * 1.45);
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        const cur = raw[idx];
        if (cur > 0.03 && cur < 0.88) {
          const neighAvg = (raw[idx - 1] + raw[idx + 1] + raw[idx - w] + raw[idx + w]) * 0.25;
          if (neighAvg > 0.62) {
            raw[idx] = cur + (neighAvg - cur) * recoverWeight * 0.7;
          }
        }
      }
    }
  }

  // 3. Joint Edge-Guided (cross-bilateral) refinement along transition boundaries
  // Snaps alpha cleanly to real RGB/luma object edges (hair, ears, collar) without blurring crisp edges
  const invTwoSigmaLumaSq = 1 / (2 * 24 * 24);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const centerAlpha = raw[idx];
      // Skip solid core and clear background for speed and crisp interior preservation
      if (centerAlpha <= 0.02 || centerAlpha >= 0.98) {
        joint[idx] = centerAlpha;
        continue;
      }
      const centerL = currLuma[idx];
      let wSum = 1.0;
      let aSum = centerAlpha;

      const y0 = y > 0 ? y - 1 : 0;
      const y1 = y + 1 < h ? y + 1 : h - 1;
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x + 1 < w ? x + 1 : w - 1;

      for (let ny = y0; ny <= y1; ny++) {
        const nRow = ny * w;
        for (let nx = x0; nx <= x1; nx++) {
          if (nx === x && ny === y) continue;
          const nIdx = nRow + nx;
          const dL = currLuma[nIdx] - centerL;
          const rangeW = Math.exp(-(dL * dL) * invTwoSigmaLumaSq);
          const spatialW = nx === x || ny === y ? 0.85 : 0.6;
          const weight = rangeW * spatialW;
          wSum += weight;
          aSum += raw[nIdx] * weight;
        }
      }
      joint[idx] = aSum / wSum;
    }
  }

  // 4. Motion-protected inward anti-halo erosion
  if (choke > 0.05) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let m = joint[row + x];
        const xl = x > 0 ? x - 1 : 0;
        const xr = x + 1 < w ? x + 1 : w - 1;
        if (joint[row + xl] < m) m = joint[row + xl];
        if (joint[row + xr] < m) m = joint[row + xr];
        erodeH[row + x] = m;
      }
    }
    const baseErodeBlend = Math.min(0.85, choke * 0.92);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const yu = (y > 0 ? y - 1 : 0) * w;
      const yd = (y + 1 < h ? y + 1 : h - 1) * w;
      for (let x = 0; x < w; x++) {
        const idx = row + x;
        let m = erodeH[idx];
        if (erodeH[yu + x] < m) m = erodeH[yu + x];
        if (erodeH[yd + x] < m) m = erodeH[yd + x];
        // Relax erosion on rapidly moving hands/fingers so gestures stay crisp & intact
        const erodeBlend = baseErodeBlend * (1 - motion[idx] * 0.65);
        eroded[idx] = joint[idx] * (1 - erodeBlend) + m * erodeBlend;
      }
    }
  } else {
    eroded.set(joint);
  }

  // 5. Motion-adaptive temporal stabilization governed by temporalStability (0..1)
  if (!params.hasTemporalHistory) {
    temporal.set(eroded);
  } else {
    const staticUpdateRate = clamp(0.42 - stability * 0.24, 0.14, 0.6); // lower = steadier static edges
    const mediumUpdateRate = clamp(0.66 - stability * 0.2, 0.35, 0.78);
    const fastUpdateRate = 0.9; // moving hands/head always respond fast without ghost trails
    for (let i = 0; i < total; i++) {
      const curr = eroded[i];
      const prev = temporal[i];
      const alphaDiff = Math.abs(curr - prev);
      const m = motion[i];
      const blend =
        m > 0.35 || alphaDiff > 0.32
          ? fastUpdateRate
          : m > 0.12 || alphaDiff > 0.12
          ? mediumUpdateRate
          : staticUpdateRate;
      temporal[i] = prev + (curr - prev) * blend;
    }
  }

  // 6. Strictly INWARD spatial feathering (prevents room-color halo growth outside silhouette)
  if (softness > 0.2) {
    const r = softness >= 4 ? 2 : 1;
    const div = r * 2 + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sum = temporal[row + x];
        for (let k = 1; k <= r; k++) {
          const xl = x - k >= 0 ? x - k : 0;
          const xr = x + k < w ? x + k : w - 1;
          sum += temporal[row + xl] + temporal[row + xr];
        }
        blurH[row + x] = sum / div;
      }
    }
    const featherMix = Math.min(1, softness / 5);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const idx = row + x;
        let sum = blurH[idx];
        for (let k = 1; k <= r; k++) {
          const yu = (y - k >= 0 ? y - k : 0) * w;
          const yd = (y + k < h ? y + k : h - 1) * w;
          sum += blurH[yu + x] + blurH[yd + x];
        }
        const blurred = sum / div;
        const orig = temporal[idx];
        const mixed = orig * (1 - featherMix) + blurred * featherMix;
        final[idx] = mixed < orig ? mixed : orig;
      }
    }
  } else {
    final.set(temporal);
  }

  return final;
}

/**
 * Inspects a refined alpha mask against the previous healthy mask to detect:
 * - Sudden subject disappearance / low-light segmentation collapse
 * - Original room background leakage spikes along top/side margins
 * - Severe temporal flicker (low frame-to-frame IoU)
 *
 * When a transient fault occurs, recovers safely from `prevGood` up to `maxHoldFrames`
 * (never exposing raw room background), and flags persistent failures for user review.
 */
export function analyzeMaskHealthAndRecover(
  candidate: Float32Array,
  prevGood: Float32Array,
  w: number,
  h: number,
  state: {
    hasPrevGood: boolean;
    prevCoverage: number;
    recoveryStreak: number;
    maxHoldFrames?: number;
  }
): MaskHealthMetrics {
  const total = w * h;
  const maxHold = state.maxHoldFrames ?? 12;

  let fgCount = 0;
  let intersect = 0;
  let union = 0;
  let borderSampleCount = 0;
  let borderLeakCount = 0;

  const marginX = Math.max(2, Math.round(w * 0.03));
  const topBandY = Math.max(2, Math.round(h * 0.04));
  const upperBodyLimitY = Math.round(h * 0.72);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const isFg = candidate[i] >= 0.45;
      if (isFg) fgCount++;

      if (state.hasPrevGood) {
        const wasFg = prevGood[i] >= 0.45;
        if (isFg || wasFg) {
          union++;
          if (isFg && wasFg) intersect++;
        }
      }

      // Check top band & upper left/right corners where room furniture/walls leak when matting breaks
      const inTopEdge = y < topBandY;
      const inUpperCornerMargin = y < upperBodyLimitY && (x < marginX || x >= w - marginX);
      if (inTopEdge || inUpperCornerMargin) {
        borderSampleCount++;
        if (isFg) borderLeakCount++;
      }
    }
  }

  const coverage = total > 0 ? fgCount / total : 0;
  const borderLeakage = borderSampleCount > 0 ? borderLeakCount / borderSampleCount : 0;
  const iouStability = union > 0 ? intersect / union : 1;

  // Detect matting failures
  let issueCategory: MaskIssueCategory | null = null;
  let issueReason: string | null = null;

  const suddenDropout =
    state.hasPrevGood &&
    state.prevCoverage > 0.08 &&
    (coverage < 0.015 || (coverage < state.prevCoverage * 0.32 && iouStability < 0.35));

  const subjectMissing = !state.hasPrevGood && coverage < 0.012;

  const leakageSpike =
    borderLeakage > 0.38 ||
    (state.hasPrevGood &&
      state.prevCoverage > 0.04 &&
      coverage - state.prevCoverage > 0.34 &&
      coverage > 0.72) ||
    coverage > 0.88;

  const flickerSpike = state.hasPrevGood && state.prevCoverage > 0.05 && iouStability < 0.52 && !suddenDropout;

  if (suddenDropout) {
    issueCategory = 'dropout';
    issueReason = 'Temporary subject dropout detected (low contrast or fast movement).';
  } else if (leakageSpike) {
    issueCategory = 'leakage';
    issueReason = 'Original room background leakage detected around frame margins.';
  } else if (flickerSpike) {
    issueCategory = 'flicker';
    issueReason = 'Elevated silhouette flicker between consecutive frames.';
  } else if (subjectMissing) {
    issueCategory = 'dropout';
    issueReason = 'No human subject reliably detected in frame.';
  }

  // Healthy frame -> commit to prevGood snapshot
  if (!issueCategory) {
    prevGood.set(candidate);
    return {
      state: 'ok',
      coverage,
      borderLeakage,
      iouStability,
      recoveryStreak: 0,
      issueCategory: null,
      issueReason: null,
    };
  }

  // Attempt safe temporal recovery when we have a valid prior frame within hold budget
  const nextStreak = state.recoveryStreak + 1;
  const canRecoverSafely =
    state.hasPrevGood &&
    nextStreak <= maxHold &&
    (issueCategory === 'dropout' || issueCategory === 'leakage' || issueCategory === 'flicker');

  if (canRecoverSafely) {
    if (issueCategory === 'dropout') {
      // Hold last clean matte rather than erasing the speaker
      candidate.set(prevGood);
    } else {
      // Suppress leaked wall patches by anchoring strongly to last clean matte
      const holdWeight = issueCategory === 'leakage' ? 0.86 : 0.72;
      for (let i = 0; i < total; i++) {
        candidate[i] = candidate[i] * (1 - holdWeight) + prevGood[i] * holdWeight;
      }
    }
    return {
      state: 'recovered',
      coverage,
      borderLeakage,
      iouStability,
      recoveryStreak: nextStreak,
      issueCategory,
      issueReason,
    };
  }

  // Hold budget exhausted or no baseline subject -> flag section for user review
  if (state.hasPrevGood && (issueCategory === 'dropout' || issueCategory === 'leakage')) {
    // Still avoid flashing raw room background by holding attenuated prior matte
    candidate.set(prevGood);
  }

  return {
    state: 'flagged',
    coverage,
    borderLeakage,
    iouStability,
    recoveryStreak: nextStreak,
    issueCategory,
    issueReason,
  };
}

/**
 * Analyzes perceptual brightness, contrast, and warm/cool RGB balance of either
 * an entire background image or the interior foreground pixels (`alpha >= 0.72`).
 */
export function analyzeImageColorStats(
  rgbaPixels: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  alphaMask?: Float32Array
): ImageColorStats {
  const total = w * h;
  if (total <= 0) {
    return { meanLuma: 120, contrastStd: 38, meanR: 120, meanG: 120, meanB: 120, warmth: 0, sampleCount: 0 };
  }

  // Sample grid stride keeps CPU overhead near zero (~1,500 samples)
  const stride = Math.max(1, Math.floor(Math.sqrt(total / 1600)));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLuma = 0;
  let sumLumaSq = 0;
  let count = 0;

  for (let y = 0; y < h; y += stride) {
    const row = y * w;
    for (let x = 0; x < w; x += stride) {
      const i = row + x;
      if (alphaMask && alphaMask[i] < 0.72) continue;
      const p = i * 4;
      const r = rgbaPixels[p];
      const g = rgbaPixels[p + 1];
      const b = rgbaPixels[p + 2];
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      sumR += r;
      sumG += g;
      sumB += b;
      sumLuma += luma;
      sumLumaSq += luma * luma;
      count++;
    }
  }

  if (count === 0) {
    return { meanLuma: 120, contrastStd: 38, meanR: 120, meanG: 120, meanB: 120, warmth: 0, sampleCount: 0 };
  }

  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const meanLuma = sumLuma / count;
  const variance = Math.max(0, sumLumaSq / count - meanLuma * meanLuma);
  const contrastStd = Math.sqrt(variance);
  const warmth = clamp((meanR - meanB) / 255, -1, 1);

  return {
    meanLuma,
    contrastStd,
    meanR,
    meanG,
    meanB,
    warmth,
    sampleCount: count,
  };
}

/**
 * Computes skin-tone-safe foreground color, exposure, and contrast adjustments
 * so a subject filmed in an ordinary room blends naturally into a warm or cool studio.
 */
export function computeEnvironmentColorMatch(
  fgStats: ImageColorStats | null,
  bgStats: ImageColorStats | null,
  lightingPreset: LightingPreset,
  options: {
    autoColorMatch: boolean;
    colorMatchStrength: number; // 0..1
    exposureMatch: number; // 0..1
  }
): ColorMatchCompensation {
  const defaultRgb = bgStats
    ? {
        r: Math.round(bgStats.meanR),
        g: Math.round(bgStats.meanG),
        b: Math.round(bgStats.meanB),
      }
    : { r: 28, g: 38, b: 64 };

  if (!bgStats || !fgStats || fgStats.sampleCount < 20) {
    return {
      exposureGain: 1,
      contrastGain: 1,
      warmSepia: lightingPreset === 'warm_studio' ? 0.05 : 0,
      coolHueDeg: lightingPreset === 'cool_broadcast' ? -3 : 0,
      saturationGain: 1,
      ambientTintRgb: defaultRgb,
      ambientTintAlpha: options.autoColorMatch ? 0.1 : 0,
      mismatchScore: 0,
    };
  }

  // Compute perceptual lighting difference score even when auto-match is off (used by Quality Control)
  const lumaGap = Math.abs(fgStats.meanLuma - bgStats.meanLuma) / 140;
  const warmthGap = Math.abs(fgStats.warmth - bgStats.warmth) / 0.45;
  const mismatchScore = clamp(lumaGap * 0.65 + warmthGap * 0.35, 0, 1);

  if (!options.autoColorMatch) {
    return {
      exposureGain: 1,
      contrastGain: 1,
      warmSepia: lightingPreset === 'warm_studio' ? 0.05 : 0,
      coolHueDeg: 0,
      saturationGain: 1,
      ambientTintRgb: defaultRgb,
      ambientTintAlpha: 0,
      mismatchScore,
    };
  }

  const colorStrength = clamp(options.colorMatchStrength, 0, 1);
  const expStrength = clamp(options.exposureMatch, 0, 1);

  // Target foreground luminance harmonizes ~55% toward studio room key luminance without underexposing faces
  const idealFgLuma = clamp(fgStats.meanLuma * 0.45 + bgStats.meanLuma * 0.55, 78, 175);
  const rawExposureRatio = idealFgLuma / Math.max(36, fgStats.meanLuma);
  const exposureGain = clamp(1 + (rawExposureRatio - 1) * expStrength * 0.72, 0.78, 1.28);

  // Contrast balancing toward background dynamic range
  const targetContrast = clamp(bgStats.contrastStd * 0.92, 24, 62);
  const rawContrastRatio = targetContrast / Math.max(18, fgStats.contrastStd);
  const contrastGain = clamp(1 + (rawContrastRatio - 1) * expStrength * 0.42, 0.86, 1.18);

  // Color temperature matching preserving natural skin tones (strictly bounded)
  const presetWarmBias =
    lightingPreset === 'warm_studio' ? 0.08 : lightingPreset === 'cool_broadcast' ? -0.08 : 0;
  const targetWarmth = bgStats.warmth + presetWarmBias;
  const warmthDelta = (targetWarmth - fgStats.warmth) * colorStrength;

  const warmSepia = warmthDelta > 0.015 ? clamp(warmthDelta * 0.42, 0, 0.16) : 0;
  const coolHueDeg = warmthDelta < -0.015 ? clamp(warmthDelta * 26, -11, 0) : 0;

  // Slightly damp excessive chroma when pulling into moody/cool sets so skin doesn't turn neon
  const saturationGain = clamp(1 - Math.abs(warmthDelta) * 0.14, 0.9, 1.06);

  // Compute balanced atmospheric soft-light wash RGB from background ambience
  const tintR = Math.round(clamp(bgStats.meanR * 0.75 + 64 * 0.25, 20, 235));
  const tintG = Math.round(clamp(bgStats.meanG * 0.75 + 64 * 0.25, 20, 235));
  const tintB = Math.round(clamp(bgStats.meanB * 0.75 + 64 * 0.25, 20, 235));
  const ambientTintAlpha = clamp(0.06 + colorStrength * 0.14, 0, 0.22);

  return {
    exposureGain,
    contrastGain,
    warmSepia,
    coolHueDeg,
    saturationGain,
    ambientTintRgb: { r: tintR, g: tintG, b: tintB },
    ambientTintAlpha,
    mismatchScore,
  };
}

/**
 * Deterministic 2.5D cinematic camera curve driven by playback / render timestamp.
 */
export function computeCinematicCameraTransform(
  timeMs: number,
  cinematic?: Partial<CinematicConfig>
): CinematicCameraState {
  const mode = cinematic?.motionMode ?? 'none';
  const intensity = clamp(cinematic?.motionIntensity ?? 0.45, 0, 1);
  const fadeAlpha =
    cinematic?.sceneTransition === 'smooth_fade'
      ? clamp(timeMs / 650, 0, 1)
      : 1;

  const perspZoom = clamp(cinematic?.bgPerspectiveZoom ?? 1.04, 0.9, 1.35);

  if (mode === 'none' || intensity <= 0.01) {
    return {
      bgScale: perspZoom,
      subjectScaleMul: 1,
      fgScaleMul: 1,
      panXNorm: 0,
      panYNorm: 0,
      fadeAlpha,
    };
  }

  const sec = Math.max(0, timeMs / 1000);
  // Smooth organic breathing cycle (~16 seconds) that scales proportionally across 2.5D Z-planes
  const cycle = 0.5 - 0.5 * Math.cos((sec * Math.PI * 2) / 16);

  if (mode === 'subtle_push_in') {
    const pushDelta = cycle * 0.055 * intensity;
    return {
      bgScale: perspZoom + pushDelta * 0.75,
      subjectScaleMul: 1 + pushDelta,
      fgScaleMul: 1 + pushDelta * 1.25,
      panXNorm: Math.sin(sec * 0.35) * 0.004 * intensity,
      panYNorm: -pushDelta * 0.14,
      fadeAlpha,
    };
  }

  // gentle_drift
  const drift = Math.sin((sec * Math.PI * 2) / 14);
  return {
    bgScale: perspZoom + 0.025 * intensity,
    subjectScaleMul: 1 + 0.015 * intensity,
    fgScaleMul: 1 + 0.02 * intensity,
    panXNorm: drift * 0.022 * intensity,
    panYNorm: Math.cos((sec * Math.PI * 2) / 18) * 0.006 * intensity,
    fadeAlpha,
  };
}

export function getColorGradeFilter(grade?: ColorGradePreset): string {
  switch (grade) {
    case 'warm_cinema':
      return 'contrast(1.04) saturate(1.06) sepia(0.08)';
    case 'crisp_broadcast':
      return 'contrast(1.07) saturate(1.03) brightness(1.02)';
    case 'moody_studio':
      return 'contrast(1.1) saturate(0.92) brightness(0.96)';
    case 'filmic':
      return 'contrast(1.06) saturate(0.96) sepia(0.04)';
    default:
      return '';
  }
}
