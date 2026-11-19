import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AutoFrameTracker,
  computeAutoFrameTarget,
  computeSilhouetteBounds,
} from '../src/engine/autoFrame.ts';

test('computeSilhouetteBounds extracts subject box and ignores stray corner speckles', () => {
  const w = 100;
  const h = 100;
  const mask = new Float32Array(w * h);

  // Place a person silhouette in x: [60..85], y: [20..85]
  for (let y = 20; y <= 85; y++) {
    for (let x = 60; x <= 85; x++) {
      mask[y * w + x] = 0.95;
    }
  }
  // Add an isolated 1px noise speck at top-left (2, 2)
  mask[2 * w + 2] = 0.9;

  const bounds = computeSilhouetteBounds(mask, w, h);
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.minX - 60 / 99) < 0.02);
  assert.ok(Math.abs(bounds.maxX - 85 / 99) < 0.02);
  assert.ok(Math.abs(bounds.minY - 20 / 99) < 0.02);
  assert.ok(Math.abs(bounds.maxY - 85 / 99) < 0.02);
});

test('computeSilhouetteBounds returns null when frame has no subject', () => {
  const mask = new Float32Array(100 * 100);
  mask[500] = 0.8; // tiny 1px blip
  assert.equal(computeSilhouetteBounds(mask, 100, 100), null);
});

test('computeAutoFrameTarget centers off-center user and zooms in when distant', () => {
  // User is standing on the right half (x: 0.65..0.85) and small (y: 0.30..0.80)
  const bounds = { minX: 0.65, maxX: 0.85, minY: 0.3, maxY: 0.8, coverage: 0.1 };

  const normalRes = computeAutoFrameTarget(bounds, {
    canvasWidth: 1280,
    canvasHeight: 720,
    sourceWidth: 1280,
    sourceHeight: 720,
    mirrorCamera: false,
    deskEnabled: false,
    deskHeightRatio: 0.25,
  });

  // Should zoom in (scale > 1.3) and shift left (negative offsetX) to center x=0.75
  assert.ok(normalRes.scale > 1.35);
  assert.ok(normalRes.offsetX < -0.25);

  const mirroredRes = computeAutoFrameTarget(bounds, {
    canvasWidth: 1280,
    canvasHeight: 720,
    sourceWidth: 1280,
    sourceHeight: 720,
    mirrorCamera: true,
    deskEnabled: false,
    deskHeightRatio: 0.25,
  });

  // When mirrored, source x=0.75 renders on the left side, so offsetX must be positive to center
  assert.ok(mirroredRes.offsetX > 0.25);
});

test('computeAutoFrameTarget grounds waist-up shots so torso does not float above bottom edge', () => {
  const waistUpBounds = { minX: 0.3, maxX: 0.7, minY: 0.18, maxY: 0.99, coverage: 0.3 };
  const res = computeAutoFrameTarget(waistUpBounds, {
    canvasWidth: 1280,
    canvasHeight: 720,
    sourceWidth: 1280,
    sourceHeight: 720,
    mirrorCamera: true,
    deskEnabled: false,
    deskHeightRatio: 0.25,
  });

  // Bottom of silhouette (1 + offsetY - (1 - maxY) * scale) must sit at or below canvas bottom (1.0)
  const renderedBottom = 1 + res.offsetY - (1 - waistUpBounds.maxY) * res.scale;
  const renderedTop = 1 + res.offsetY - (1 - waistUpBounds.minY) * res.scale;
  assert.ok(renderedBottom >= 0.995, `expected grounded bottom >= 0.995, got ${renderedBottom}`);
  assert.ok(renderedTop >= 0.05, `expected headroom >= 0.05, got ${renderedTop}`);
});

test('AutoFrameTracker glides smoothly toward detected subject center', () => {
  const tracker = new AutoFrameTracker();
  const bounds = { minX: 0.1, maxX: 0.35, minY: 0.25, maxY: 0.85, coverage: 0.15 };
  let state = { scale: 0.95, offsetX: 0, offsetY: 0 };

  for (let i = 1; i <= 45; i++) {
    const out = tracker.update(
      bounds,
      state,
      {
        canvasWidth: 1280,
        canvasHeight: 720,
        sourceWidth: 1280,
        sourceHeight: 720,
        mirrorCamera: false,
        deskEnabled: false,
        deskHeightRatio: 0.25,
      },
      i * 33
    );
    assert.equal(out.detected, true);
    state = out.framing;
  }

  // After ~1.5s of tracking a person on the left (center=0.225), offsetX should be positive and scale zoomed in
  assert.ok(state.offsetX > 0.25, `expected positive offsetX centering left subject, got ${state.offsetX}`);
  assert.ok(state.scale > 1.15, `expected zoomed-in scale, got ${state.scale}`);
});
