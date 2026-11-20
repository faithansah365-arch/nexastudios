import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeImageColorStats,
  analyzeMaskHealthAndRecover,
  computeCinematicCameraTransform,
  computeEnvironmentColorMatch,
  createMaskPipelineBuffers,
  extractLumaAndMotion,
  refineAlphaMaskPipeline,
} from '../src/engine/mattingMath.ts';
import {
  computeAutoFixPatch,
  evaluateClipQuality,
  type QualitySample,
} from '../src/engine/qualityControl.ts';

function buildTestFrame(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const [r, g, b] = fn(x, y);
      rgba[p] = r;
      rgba[p + 1] = g;
      rgba[p + 2] = b;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

test('refineAlphaMaskPipeline preserves moving fingertips while keeping static walls suppressed', () => {
  const w = 64;
  const h = 48;
  const bufs = createMaskPipelineBuffers(w * h);

  // Frame 1: person torso in center, wall dark gray (50,50,50)
  const frame1 = buildTestFrame(w, h, (x, y) => {
    const inTorso = x >= 22 && x <= 42 && y >= 10 && y <= 46;
    return inTorso ? [190, 155, 140] : [50, 50, 50];
  });
  const conf1 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      conf1[y * w + x] = x >= 22 && x <= 42 && y >= 10 ? 0.95 : 0.02;
    }
  }

  extractLumaAndMotion(frame1, bufs, w * h, false);
  refineAlphaMaskPipeline(conf1, w, h, bufs, {
    bodySensitivity: 0.7,
    edgeChoke: 0.45,
    edgeSoftness: 1,
    temporalStability: 0.75,
    hasTemporalHistory: false,
  });

  // Frame 2: person raises thin hand swiftly to (x: 12..19, y: 16..24) where MediaPipe only gives partial 0.42 confidence
  const frame2 = buildTestFrame(w, h, (x, y) => {
    const inTorso = x >= 22 && x <= 42 && y >= 10 && y <= 46;
    const inMovingHand = x >= 12 && x <= 19 && y >= 16 && y <= 24;
    return inTorso || inMovingHand ? [200, 165, 145] : [50, 50, 50];
  });
  const conf2 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inTorso = x >= 22 && x <= 42 && y >= 10;
      const inMovingHand = x >= 12 && x <= 19 && y >= 16 && y <= 24;
      // Add slight sensor jitter noise on background wall
      conf2[y * w + x] = inTorso ? 0.95 : inMovingHand ? 0.44 : x === 3 && y === 3 ? 0.2 : 0.02;
    }
  }

  extractLumaAndMotion(frame2, bufs, w * h, true);
  const out2 = refineAlphaMaskPipeline(conf2, w, h, bufs, {
    bodySensitivity: 0.72,
    edgeChoke: 0.45,
    edgeSoftness: 1,
    temporalStability: 0.75,
    hasTemporalHistory: true,
  });

  // Moving hand center must stay robustly foreground (> 0.65) even after temporal stabilization
  const handAlpha = out2[20 * w + 15];
  assert.ok(handAlpha > 0.65, `expected moving hand alpha > 0.65, got ${handAlpha}`);

  // Static corner wall noise must stay strictly background (0)
  assert.ok(out2[3 * w + 3] < 0.08, `expected static wall suppressed, got ${out2[3 * w + 3]}`);
});

test('analyzeMaskHealthAndRecover prevents raw room restore on low-light dropout and leakage spikes, then flags persistent failure', () => {
  const w = 40;
  const h = 30;
  const prevGood = new Float32Array(w * h);
  for (let y = 5; y < 29; y++) {
    for (let x = 14; x < 26; x++) {
      prevGood[y * w + x] = 1;
    }
  }

  // 1. Sudden low-light collapse (empty candidate mask) -> must safely recover prevGood
  const emptyDropout = new Float32Array(w * h);
  const r1 = analyzeMaskHealthAndRecover(emptyDropout, prevGood, w, h, {
    hasPrevGood: true,
    prevCoverage: 0.24,
    recoveryStreak: 0,
    maxHoldFrames: 3,
  });
  assert.equal(r1.state, 'recovered');
  assert.equal(r1.issueCategory, 'dropout');
  assert.equal(emptyDropout[15 * w + 20], 1, 'recovered matte must hold subject center instead of blanking out');

  // 2. Room wall margin leakage spike (walls flood top corners) -> clamped toward prevGood
  const leakedMask = new Float32Array(w * h).fill(0.9);
  const r2 = analyzeMaskHealthAndRecover(leakedMask, prevGood, w, h, {
    hasPrevGood: true,
    prevCoverage: 0.24,
    recoveryStreak: 0,
    maxHoldFrames: 3,
  });
  assert.equal(r2.state, 'recovered');
  assert.equal(r2.issueCategory, 'leakage');
  assert.ok(leakedMask[1 * w + 1] < 0.25, `leaked corner pixel should be clamped down, got ${leakedMask[1 * w + 1]}`);

  // 3. Persistent dropout beyond hold budget -> must transition to 'flagged' for QC review
  const persistentDropout = new Float32Array(w * h);
  const r3 = analyzeMaskHealthAndRecover(persistentDropout, prevGood, w, h, {
    hasPrevGood: true,
    prevCoverage: 0.24,
    recoveryStreak: 3,
    maxHoldFrames: 3,
  });
  assert.equal(r3.state, 'flagged');
  assert.equal(r3.issueCategory, 'dropout');
});

test('computeEnvironmentColorMatch harmonizes subject to warm & cool studios without unnatural over-saturation', () => {
  // Neutral/slightly cool indoor webcam subject
  const fgStats = {
    meanLuma: 105,
    contrastStd: 34,
    meanR: 104,
    meanG: 108,
    meanB: 118,
    warmth: (104 - 118) / 255,
    sampleCount: 400,
  };

  // Warm orange church/lounge lighting
  const warmBg = {
    meanLuma: 140,
    contrastStd: 40,
    meanR: 185,
    meanG: 135,
    meanB: 85,
    warmth: (185 - 85) / 255,
    sampleCount: 400,
  };

  const warmMatch = computeEnvironmentColorMatch(fgStats, warmBg, 'warm_studio', {
    autoColorMatch: true,
    colorMatchStrength: 0.8,
    exposureMatch: 0.75,
  });
  assert.ok(warmMatch.exposureGain > 1.05, 'should lift exposure toward brighter warm studio');
  assert.ok(warmMatch.warmSepia > 0.03 && warmMatch.warmSepia <= 0.16, 'warm shift must be subtle & skin-safe');
  assert.equal(warmMatch.coolHueDeg, 0);

  // Cool blue broadcast studio lighting
  const coolBg = {
    meanLuma: 88,
    contrastStd: 38,
    meanR: 60,
    meanG: 105,
    meanB: 170,
    warmth: (60 - 170) / 255,
    sampleCount: 400,
  };

  const coolMatch = computeEnvironmentColorMatch(fgStats, coolBg, 'cool_broadcast', {
    autoColorMatch: true,
    colorMatchStrength: 0.8,
    exposureMatch: 0.75,
  });
  assert.ok(coolMatch.coolHueDeg < -3 && coolMatch.coolHueDeg >= -11, 'cool shift must stay skin-safe');
  assert.equal(coolMatch.warmSepia, 0);
  assert.ok(coolMatch.saturationGain >= 0.9 && coolMatch.saturationGain <= 1.06);
});

test('analyzeImageColorStats ignores transparent background pixels when measuring foreground subject', () => {
  const w = 10;
  const h = 10;
  // Bright green/white room wall on top half, darker warm speaker on bottom half
  const rgba = buildTestFrame(w, h, (_x, y) => (y < 5 ? [240, 250, 240] : [120, 90, 80]));
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      alpha[y * w + x] = y >= 5 ? 0.95 : 0;
    }
  }
  const fgOnly = analyzeImageColorStats(rgba, w, h, alpha);
  assert.ok(fgOnly.meanR > fgOnly.meanB, 'should reflect warm subject pixels, not bright wall');
  assert.ok(fgOnly.meanLuma < 120);
});

test('computeCinematicCameraTransform produces cohesive 2.5D depth scaling and fade transitions', () => {
  const locked = computeCinematicCameraTransform(4000, {
    motionMode: 'none',
    motionIntensity: 0.8,
    colorGrade: 'natural',
    sceneTransition: 'none',
    bgHorizonShift: 0,
    bgPerspectiveZoom: 1.04,
  });
  assert.equal(locked.subjectScaleMul, 1);
  assert.equal(locked.bgScale, 1.04);
  assert.equal(locked.fadeAlpha, 1);

  const pushIn = computeCinematicCameraTransform(8000, {
    motionMode: 'subtle_push_in',
    motionIntensity: 1,
    colorGrade: 'warm_cinema',
    sceneTransition: 'smooth_fade',
    bgHorizonShift: 0,
    bgPerspectiveZoom: 1.04,
  });
  assert.ok(pushIn.fgScaleMul > pushIn.subjectScaleMul, 'foreground plane must push slightly faster for 2.5D parallax');
  assert.ok(pushIn.subjectScaleMul > 1.03);
  assert.equal(pushIn.fadeAlpha, 1);

  const fadeStart = computeCinematicCameraTransform(162, {
    motionMode: 'none',
    motionIntensity: 0,
    colorGrade: 'natural',
    sceneTransition: 'smooth_fade',
    bgHorizonShift: 0,
    bgPerspectiveZoom: 1.04,
  });
  assert.ok(fadeStart.fadeAlpha > 0.2 && fadeStart.fadeAlpha < 0.35);
});

test('evaluateClipQuality flags timestamp ranges for background leakage & dropout without false positives', () => {
  const baseSubject = {
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
    bodySensitivity: 0.66,
    lightWrap: 0.32,
    temporalStability: 0.72,
    autoColorMatch: true,
    shadowIntensity: 0.22,
    chromaKeyEnabled: false,
    chromaKeyColor: '#00b140',
    chromaSimilarity: 0.24,
    chromaSmoothness: 0.08,
  };
  const fgConfig = {
    enabled: true,
    deskHeightRatio: 0.25,
    deskStyle: 'news_glass' as const,
    perspectiveTilt: 0,
    deskOpacity: 0.96,
  };

  // Failing clip with room leakage at 1.2s–2.0s and missing subject at 3.2s
  const failingSamples: QualitySample[] = [
    {
      timestampSec: 0.0,
      health: { state: 'ok', coverage: 0.28, borderLeakage: 0.01, iouStability: 0.96, recoveryStreak: 0, issueCategory: null, issueReason: null },
      bounds: { minX: 0.35, maxX: 0.65, minY: 0.15, maxY: 0.95, coverage: 0.28 },
      fgStats: null,
    },
    {
      timestampSec: 1.2,
      health: { state: 'flagged', coverage: 0.68, borderLeakage: 0.54, iouStability: 0.58, recoveryStreak: 4, issueCategory: 'leakage', issueReason: 'Wall leak' },
      bounds: { minX: 0.02, maxX: 0.98, minY: 0.02, maxY: 0.99, coverage: 0.68 },
      fgStats: null,
    },
    {
      timestampSec: 2.0,
      health: { state: 'flagged', coverage: 0.71, borderLeakage: 0.58, iouStability: 0.55, recoveryStreak: 5, issueCategory: 'leakage', issueReason: 'Wall leak' },
      bounds: { minX: 0.02, maxX: 0.98, minY: 0.02, maxY: 0.99, coverage: 0.71 },
      fgStats: null,
    },
    {
      timestampSec: 3.2,
      health: { state: 'flagged', coverage: 0.004, borderLeakage: 0, iouStability: 0.1, recoveryStreak: 13, issueCategory: 'dropout', issueReason: 'Subject lost' },
      bounds: null,
      fgStats: null,
    },
  ];

  const badReport = evaluateClipQuality(failingSamples, {
    segMode: 'mediapipe',
    subjectConfig: baseSubject,
    fgConfig,
    bgStats: null,
    lightingPreset: 'neutral',
  });
  assert.equal(badReport.overallStatus, 'failed');
  assert.equal(badReport.passed, false);
  const leakIssue = badReport.issues.find((i) => i.category === 'background_leakage');
  assert.ok(leakIssue);
  assert.equal(leakIssue.timestampStartSec, 1.2);
  assert.equal(leakIssue.timestampEndSec, 2.0);
  assert.ok(badReport.issues.some((i) => i.category === 'missing_subject'));

  const fixPatch = computeAutoFixPatch(badReport, baseSubject);
  assert.ok((fixPatch.edgeChoke ?? 0) > baseSubject.edgeChoke);
  assert.ok((fixPatch.bodySensitivity ?? 0) > baseSubject.bodySensitivity);

  // Clean clip -> must pass cleanly
  const cleanSamples: QualitySample[] = [0, 0.5, 1.0, 1.5].map((t) => ({
    timestampSec: t,
    health: { state: 'ok', coverage: 0.3, borderLeakage: 0.02, iouStability: 0.95, recoveryStreak: 0, issueCategory: null, issueReason: null },
    bounds: { minX: 0.35, maxX: 0.65, minY: 0.16, maxY: 0.94, coverage: 0.3 },
    fgStats: null,
  }));
  const cleanReport = evaluateClipQuality(cleanSamples, {
    segMode: 'mediapipe',
    subjectConfig: baseSubject,
    fgConfig,
    bgStats: null,
    lightingPreset: 'neutral',
  });
  assert.equal(cleanReport.overallStatus, 'passed');
  assert.equal(cleanReport.passed, true);
  assert.equal(cleanReport.issues.length, 0);
});
