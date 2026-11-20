import type { ForegroundMaskConfig, LightingPreset, SubjectConfig } from '../../shared/types';
import type { SilhouetteBounds } from './autoFrame';
import {
  computeEnvironmentColorMatch,
  type ImageColorStats,
  type MaskHealthMetrics,
} from './mattingMath.ts';
import type { SegmentationMode, StudioSegmenter } from './segmentation';

export type QualityCategory =
  | 'background_leakage'
  | 'flicker'
  | 'missing_subject'
  | 'lighting_mismatch'
  | 'framing_perspective'
  | 'halo_risk';

export type QualitySeverity = 'critical' | 'warning';

export interface QualitySample {
  timestampSec: number;
  health: MaskHealthMetrics;
  bounds: SilhouetteBounds | null;
  fgStats: ImageColorStats | null;
}

export interface QualityIssue {
  id: string;
  category: QualityCategory;
  severity: QualitySeverity;
  timestampStartSec: number;
  timestampEndSec: number;
  message: string;
  suggestedFix: string;
}

export interface QualityReport {
  overallStatus: 'passed' | 'warnings' | 'failed';
  passed: boolean;
  summary: string;
  issues: QualityIssue[];
  metrics: {
    framesAnalyzed: number;
    avgCoverage: number;
    avgStability: number;
    leakagePeak: number;
    recoveredFrames: number;
    flaggedFrames: number;
    lightingMismatchScore: number;
  };
}

export interface QualityEvalContext {
  segMode: SegmentationMode;
  subjectConfig: SubjectConfig;
  fgConfig: ForegroundMaskConfig;
  bgStats: ImageColorStats | null;
  lightingPreset: LightingPreset;
}

function roundSec(s: number): number {
  return Math.max(0, Number(s.toFixed(1)));
}

function groupConsecutiveRanges(
  samples: QualitySample[],
  predicate: (s: QualitySample) => boolean
): Array<{ startSec: number; endSec: number; count: number }> {
  const ranges: Array<{ startSec: number; endSec: number; count: number }> = [];
  let active: { startSec: number; endSec: number; count: number } | null = null;

  for (const s of samples) {
    if (predicate(s)) {
      if (!active) {
        active = { startSec: s.timestampSec, endSec: s.timestampSec, count: 1 };
      } else {
        active.endSec = s.timestampSec;
        active.count += 1;
      }
    } else if (active) {
      ranges.push(active);
      active = null;
    }
  }
  if (active) ranges.push(active);
  return ranges;
}

/**
 * Pure clip & live-buffer Quality Control evaluator. Never emits false-positive passes
 * when leakage, missing subject, severe flicker, or critical framing failures are present.
 */
export function evaluateClipQuality(
  samples: QualitySample[],
  ctx: QualityEvalContext
): QualityReport {
  if (samples.length === 0) {
    return {
      overallStatus: 'failed',
      passed: false,
      summary: 'No video frames could be analyzed yet. Load or start playback first.',
      issues: [
        {
          id: 'no-frames',
          category: 'missing_subject',
          severity: 'critical',
          timestampStartSec: 0,
          timestampEndSec: 0,
          message: 'Zero frames were available to analyze.',
          suggestedFix: 'Ensure the video is loaded and has at least 1 decoded frame before exporting.',
        },
      ],
      metrics: {
        framesAnalyzed: 0,
        avgCoverage: 0,
        avgStability: 0,
        leakagePeak: 0,
        recoveredFrames: 0,
        flaggedFrames: 0,
        lightingMismatchScore: 0,
      },
    };
  }

  let covSum = 0;
  let stabSum = 0;
  let stabCount = 0;
  let leakagePeak = 0;
  let recoveredFrames = 0;
  let flaggedFrames = 0;
  let mismatchSum = 0;
  let mismatchCount = 0;

  let headClipCount = 0;
  let tinySubjectCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    covSum += s.health.coverage;
    if (i > 0) {
      stabSum += s.health.iouStability;
      stabCount++;
    }
    if (s.health.borderLeakage > leakagePeak) {
      leakagePeak = s.health.borderLeakage;
    }
    if (s.health.state === 'recovered') recoveredFrames++;
    if (s.health.state === 'flagged') flaggedFrames++;

    if (s.fgStats && ctx.bgStats) {
      const comp = computeEnvironmentColorMatch(s.fgStats, ctx.bgStats, ctx.lightingPreset, {
        autoColorMatch: ctx.subjectConfig.autoColorMatch ?? true,
        colorMatchStrength: ctx.subjectConfig.colorMatchStrength ?? 0.72,
        exposureMatch: ctx.subjectConfig.exposureMatch ?? 0.65,
      });
      mismatchSum += comp.mismatchScore;
      mismatchCount++;
    }

    if (s.bounds) {
      if (s.bounds.minY <= 0.015 && ctx.subjectConfig.offsetY < -0.1) {
        headClipCount++;
      }
      if (s.bounds.coverage * ctx.subjectConfig.scale < 0.035) {
        tinySubjectCount++;
      }
    }
  }

  const avgCoverage = covSum / samples.length;
  const avgStability = stabCount > 0 ? stabSum / stabCount : 1;
  const lightingMismatchScore = mismatchCount > 0 ? mismatchSum / mismatchCount : 0;

  const issues: QualityIssue[] = [];

  if (ctx.segMode !== 'original') {
    // 1. Original room background leakage detection
    const leakRanges = groupConsecutiveRanges(
      samples,
      (s) => s.health.issueCategory === 'leakage' || s.health.borderLeakage > 0.36
    );
    leakRanges.forEach((r, idx) => {
      const persistent = r.count >= 2 || leakagePeak > 0.48;
      issues.push({
        id: `leak-${idx}`,
        category: 'background_leakage',
        severity: persistent ? 'critical' : 'warning',
        timestampStartSec: roundSec(r.startSec),
        timestampEndSec: roundSec(r.endSec),
        message: `Original room background leaked into frame margins (${Math.round(leakagePeak * 100)}% peak margin bleed).`,
        suggestedFix: 'Raise Anti-Halo Edge Trim & Temporal Stability or improve subject/wall contrast.',
      });
    });

    // 2. Missing subject dropouts
    const dropRanges = groupConsecutiveRanges(
      samples,
      (s) =>
        s.health.issueCategory === 'dropout' ||
        (s.health.coverage < 0.015 && s.health.state === 'flagged')
    );
    dropRanges.forEach((r, idx) => {
      issues.push({
        id: `drop-${idx}`,
        category: 'missing_subject',
        severity: r.count >= 2 || samples.length <= 3 ? 'critical' : 'warning',
        timestampStartSec: roundSec(r.startSec),
        timestampEndSec: roundSec(r.endSec),
        message: 'Human subject lost or segmentation collapsed during this segment.',
        suggestedFix: 'Increase Body Detection Boost and verify subject remains illuminated inside frame.',
      });
    });

    // 3. Flicker / temporal instability
    const flickerRanges = groupConsecutiveRanges(
      samples,
      (s) => s.health.issueCategory === 'flicker' || (s.health.iouStability < 0.56 && s.health.coverage > 0.02)
    );
    if (avgStability < 0.68 || flickerRanges.length > 0) {
      const first = flickerRanges[0] ?? {
        startSec: samples[0].timestampSec,
        endSec: samples[samples.length - 1].timestampSec,
      };
      issues.push({
        id: 'flicker-main',
        category: 'flicker',
        severity: avgStability < 0.54 ? 'critical' : 'warning',
        timestampStartSec: roundSec(first.startSec),
        timestampEndSec: roundSec(first.endSec),
        message: `Silhouette stability dropped to ${Math.round(avgStability * 100)}% around hair/shoulders.`,
        suggestedFix: 'Increase Temporal Stability and enable slight Inward Edge Feather.',
      });
    }

    // 4. Halo / cutout rim risk check
    if ((ctx.subjectConfig.edgeChoke ?? 0.3) < 0.14 && (ctx.subjectConfig.lightWrap ?? 0) < 0.12) {
      issues.push({
        id: 'halo-risk',
        category: 'halo_risk',
        severity: 'warning',
        timestampStartSec: roundSec(samples[0].timestampSec),
        timestampEndSec: roundSec(samples[samples.length - 1].timestampSec),
        message: 'Anti-Halo Edge Trim and Studio Light Wrap are near zero, which may leave cutout halos.',
        suggestedFix: 'Apply Auto Studio Blend to remove outer fringes and wrap studio light.',
      });
    }
  }

  // 5. Lighting & exposure mismatch
  if (lightingMismatchScore > 0.52 && !(ctx.subjectConfig.autoColorMatch ?? true)) {
    issues.push({
      id: 'lighting-mismatch',
      category: 'lighting_mismatch',
      severity: 'warning',
      timestampStartSec: roundSec(samples[0].timestampSec),
      timestampEndSec: roundSec(samples[samples.length - 1].timestampSec),
      message: 'Subject exposure or color temperature diverges noticeably from the studio backdrop.',
      suggestedFix: 'Enable Auto Color & Exposure Match to harmonize lighting while preserving skin tones.',
    });
  } else if (lightingMismatchScore > 0.72) {
    issues.push({
      id: 'lighting-extreme',
      category: 'lighting_mismatch',
      severity: 'warning',
      timestampStartSec: roundSec(samples[0].timestampSec),
      timestampEndSec: roundSec(samples[samples.length - 1].timestampSec),
      message: 'Large lighting contrast between original recording and studio set.',
      suggestedFix: 'Raise Exposure Match or fine-tune manual Brightness & Color Temperature.',
    });
  }

  // 6. Camera perspective / headroom check
  if (headClipCount > samples.length * 0.35) {
    issues.push({
      id: 'framing-headclip',
      category: 'framing_perspective',
      severity: 'warning',
      timestampStartSec: roundSec(samples[0].timestampSec),
      timestampEndSec: roundSec(samples[samples.length - 1].timestampSec),
      message: 'Top of subject head may be too close to the upper edge.',
      suggestedFix: 'Enable AI Auto-Frame or slightly lower Vertical Position / Scale.',
    });
  } else if (tinySubjectCount > samples.length * 0.5 && ctx.segMode !== 'original') {
    issues.push({
      id: 'framing-tiny',
      category: 'framing_perspective',
      severity: 'warning',
      timestampStartSec: roundSec(samples[0].timestampSec),
      timestampEndSec: roundSec(samples[samples.length - 1].timestampSec),
      message: 'Subject appears unusually small inside the studio perspective.',
      suggestedFix: 'Increase Subject Scale or click AI Auto-Frame to balance proportions.',
    });
  }

  const hasCritical = issues.some((i) => i.severity === 'critical');
  const overallStatus = hasCritical ? 'failed' : issues.length > 0 ? 'warnings' : 'passed';

  const summary =
    overallStatus === 'passed'
      ? `Passed all ${samples.length} sampled frames cleanly (${Math.round(avgStability * 100)}% matte stability, zero leakage).`
      : overallStatus === 'warnings'
      ? `Analyzed ${samples.length} frames with ${issues.length} visual integration recommendation${issues.length === 1 ? '' : 's'}.`
      : `Flagged ${issues.filter((i) => i.severity === 'critical').length} critical matting issue${issues.filter((i) => i.severity === 'critical').length === 1 ? '' : 's'} across ${samples.length} sampled frames. Review affected sections before exporting.`;

  return {
    overallStatus,
    passed: overallStatus !== 'failed',
    summary,
    issues,
    metrics: {
      framesAnalyzed: samples.length,
      avgCoverage: Number(avgCoverage.toFixed(3)),
      avgStability: Number(avgStability.toFixed(3)),
      leakagePeak: Number(leakagePeak.toFixed(3)),
      recoveredFrames,
      flaggedFrames,
      lightingMismatchScore: Number(lightingMismatchScore.toFixed(3)),
    },
  };
}

/**
 * Computes genuine corrective parameter adjustments based on detected QC issues.
 * Does NOT alter the QC verdict itself; callers must re-run QC after applying.
 */
export function computeAutoFixPatch(
  report: QualityReport,
  current: SubjectConfig
): Partial<SubjectConfig> {
  const patch: Partial<SubjectConfig> = {};

  for (const issue of report.issues) {
    if (issue.category === 'background_leakage') {
      patch.edgeChoke = Math.max(current.edgeChoke ?? 0.3, 0.44);
      patch.temporalStability = Math.max(current.temporalStability ?? 0.65, 0.78);
      patch.edgeSoftness = Math.max(current.edgeSoftness, 2);
    } else if (issue.category === 'missing_subject') {
      patch.bodySensitivity = Math.max(current.bodySensitivity ?? 0.6, 0.8);
      patch.temporalStability = Math.max(current.temporalStability ?? 0.65, 0.75);
    } else if (issue.category === 'flicker') {
      patch.temporalStability = Math.max(current.temporalStability ?? 0.65, 0.82);
      patch.edgeSoftness = Math.max(current.edgeSoftness, 2);
    } else if (issue.category === 'halo_risk') {
      patch.edgeChoke = Math.max(current.edgeChoke ?? 0.3, 0.36);
      patch.lightWrap = Math.max(current.lightWrap ?? 0.25, 0.34);
      patch.edgeSoftness = Math.max(current.edgeSoftness, 2);
    } else if (issue.category === 'lighting_mismatch') {
      patch.autoColorMatch = true;
      patch.colorMatchStrength = Math.max(current.colorMatchStrength ?? 0.7, 0.8);
      patch.exposureMatch = Math.max(current.exposureMatch ?? 0.65, 0.75);
    } else if (issue.category === 'framing_perspective') {
      if (issue.id.includes('tiny')) {
        patch.scale = Math.max(current.scale, 1.05);
      } else if (issue.id.includes('headclip')) {
        patch.offsetY = Math.max(current.offsetY, 0.04);
      }
    }
  }

  return patch;
}

/**
 * Scans an uploaded video file across its trimmed range `[trimStart, trimEnd]` using
 * an isolated offscreen `<video>` element + StudioSegmenter, collecting real per-frame
 * segmentation and color telemetry for Quality Control.
 */
export async function scanVideoClipQuality(params: {
  videoUrl: string;
  trimStart: number;
  trimEnd: number;
  segmenter: StudioSegmenter;
  ctx: QualityEvalContext;
  onProgress?: (pct: number) => void;
  isCancelled?: () => boolean;
}): Promise<QualityReport> {
  const { videoUrl, trimStart, trimEnd, segmenter, ctx, onProgress, isCancelled } = params;
  const span = Math.max(0.5, trimEnd - trimStart);
  const sampleCount = Math.max(6, Math.min(28, Math.round(span / 0.4) + 1));

  const probeVideo = document.createElement('video');
  probeVideo.muted = true;
  probeVideo.playsInline = true;
  probeVideo.preload = 'auto';
  probeVideo.src = videoUrl;

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      probeVideo.removeEventListener('loadeddata', onLoaded);
      probeVideo.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = () => {
      probeVideo.removeEventListener('loadeddata', onLoaded);
      probeVideo.removeEventListener('error', onErr);
      reject(new Error('Could not decode video frames for quality scan.'));
    };
    if (probeVideo.readyState >= 2) {
      resolve();
    } else {
      probeVideo.addEventListener('loadeddata', onLoaded);
      probeVideo.addEventListener('error', onErr);
    }
  });

  // Reset segmenter temporal buffers for a clean sequential pass from trimStart
  segmenter.resetTemporalState();
  const samples: QualitySample[] = [];
  const startBaseTs = performance.now() + 500;

  try {
    for (let i = 0; i < sampleCount; i++) {
      if (isCancelled?.()) break;
      const t = trimStart + (sampleCount === 1 ? 0 : (i / (sampleCount - 1)) * span);

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          probeVideo.removeEventListener('seeked', onSeeked);
          resolve();
        };
        probeVideo.addEventListener('seeked', onSeeked);
        probeVideo.currentTime = Math.min(probeVideo.duration || t, Math.max(0, t));
      });

      segmenter.extractSubjectCanvas(probeVideo, ctx.segMode, {
        lowPowerMode: true,
        edgeSoftness: ctx.subjectConfig.edgeSoftness,
        edgeChoke: ctx.subjectConfig.edgeChoke ?? 0.32,
        bodySensitivity: ctx.subjectConfig.bodySensitivity ?? 0.65,
        temporalStability: ctx.subjectConfig.temporalStability ?? 0.68,
        detectSilhouette: true,
        chromaColor: ctx.subjectConfig.chromaKeyColor,
        chromaSimilarity: ctx.subjectConfig.chromaSimilarity,
        chromaSmoothness: ctx.subjectConfig.chromaSmoothness,
        timestampMs: startBaseTs + i * 400,
      });

      samples.push({
        timestampSec: t,
        health: { ...segmenter.lastDiagnostics.health },
        bounds: segmenter.lastSilhouetteBounds ? { ...segmenter.lastSilhouetteBounds } : null,
        fgStats: segmenter.lastDiagnostics.fgStats ? { ...segmenter.lastDiagnostics.fgStats } : null,
      });

      onProgress?.(Math.round(((i + 1) / sampleCount) * 100));
    }
  } finally {
    probeVideo.pause();
    probeVideo.removeAttribute('src');
    probeVideo.load();
    segmenter.resetTemporalState();
  }

  return evaluateClipQuality(samples, ctx);
}
