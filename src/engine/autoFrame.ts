export interface SilhouetteBounds {
  minX: number; // 0..1 normalized in source video coordinates
  maxX: number; // 0..1 normalized in source video coordinates
  minY: number; // 0..1 normalized in source video coordinates
  maxY: number; // 0..1 normalized in source video coordinates
  coverage: number; // fraction of foreground pixels (0..1)
}

export interface FramingState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface AutoFrameOptions {
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  mirrorCamera: boolean;
  deskEnabled: boolean;
  deskHeightRatio: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Extracts robust silhouette bounds from an alpha buffer using row/column density
 * projections so isolated single-pixel noise in corners never shifts camera framing.
 */
export function computeSilhouetteBounds(
  buf: Float32Array | Uint8ClampedArray,
  w: number,
  h: number,
  options: { isRgbaUint8?: boolean } = {}
): SilhouetteBounds | null {
  if (w <= 0 || h <= 0) return null;
  const total = w * h;
  const rowCounts = new Uint16Array(h);
  const colCounts = new Uint16Array(w);
  let fgPixels = 0;

  if (options.isRgbaUint8) {
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      let rowHit = 0;
      for (let x = 0; x < w; x++) {
        if (buf[(rowOffset + x) * 4 + 3] >= 90) {
          rowHit++;
          colCounts[x]++;
        }
      }
      rowCounts[y] = rowHit;
      fgPixels += rowHit;
    }
  } else {
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      let rowHit = 0;
      for (let x = 0; x < w; x++) {
        if (buf[rowOffset + x] >= 0.35) {
          rowHit++;
          colCounts[x]++;
        }
      }
      rowCounts[y] = rowHit;
      fgPixels += rowHit;
    }
  }

  const coverage = fgPixels / total;
  if (coverage < 0.008) return null;

  const minRowSupport = Math.max(2, Math.round(w * 0.012));
  const minColSupport = Math.max(2, Math.round(h * 0.015));

  let minY = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    if (rowCounts[y] >= minRowSupport) {
      if (minY === -1) minY = y;
      maxY = y;
    }
  }

  let minX = -1;
  let maxX = -1;
  for (let x = 0; x < w; x++) {
    if (colCounts[x] >= minColSupport) {
      if (minX === -1) minX = x;
      maxX = x;
    }
  }

  if (minX === -1 || minY === -1 || maxX <= minX || maxY <= minY) {
    return null;
  }

  return {
    minX: minX / (w - 1 || 1),
    maxX: maxX / (w - 1 || 1),
    minY: minY / (h - 1 || 1),
    maxY: maxY / (h - 1 || 1),
    coverage,
  };
}

/**
 * Computes the ideal digital zoom (scale) and horizontal/vertical offsets so the detected
 * silhouette stays centered horizontally and naturally framed vertically with headroom.
 */
export function computeAutoFrameTarget(
  bounds: SilhouetteBounds,
  opts: AutoFrameOptions
): FramingState {
  const {
    canvasWidth: w,
    canvasHeight: h,
    sourceWidth: sw,
    sourceHeight: sh,
    mirrorCamera,
    deskEnabled,
    deskHeightRatio,
  } = opts;

  if (!w || !h || !sw || !sh) {
    return { scale: 0.95, offsetX: 0, offsetY: 0 };
  }

  const baseAtOne = Math.min(w / sw, h / sh);
  const wRatio = (sw * baseAtOne) / w;
  const hRatio = (sh * baseAtOne) / h;

  const boxW = Math.max(0.14, bounds.maxX - bounds.minX);
  const boxH = Math.max(0.18, bounds.maxY - bounds.minY);
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;

  const activeDeskRatio = deskEnabled ? clamp(deskHeightRatio || 0.25, 0.14, 0.5) : 0;
  const desiredHeightFrac = deskEnabled
    ? Math.max(0.52, (1 - activeDeskRatio) * 0.88)
    : 0.76;
  const desiredMaxWidthFrac = 0.68;

  const scaleForHeight = desiredHeightFrac / (boxH * hRatio);
  const scaleForWidth = desiredMaxWidthFrac / (boxW * wRatio);
  let targetScale = clamp(Math.min(scaleForHeight, scaleForWidth), 0.55, 1.85);

  // Horizontal centering accounting for mirrored vs normal rendering in studioRenderer.ts
  const deltaXFromSourceCenter = mirrorCamera ? 0.5 - centerX : centerX - 0.5;
  const offsetX = clamp(-deltaXFromSourceCenter * wRatio * targetScale, -0.6, 0.6);

  // Vertical framing: center above desk (or mid-canvas) while preserving headroom & grounding cutoffs
  const targetCenterYFrac = deskEnabled
    ? Math.max(0.38, 0.5 - activeDeskRatio * 0.25)
    : 0.52;

  const headroomMinFrac = 0.06;
  const renderedHFrac = hRatio * targetScale;

  // If the camera already clips near the bottom (waist-up shot), anchor the bottom edge to avoid floating torso
  const touchesBottom = bounds.maxY >= 0.94;
  if (touchesBottom) {
    const maxScaleForHeadroom =
      (1 - headroomMinFrac) / Math.max(0.1, (bounds.maxY - bounds.minY) * hRatio);
    if (targetScale > maxScaleForHeadroom) {
      targetScale = clamp(maxScaleForHeadroom, 0.45, 1.85);
    }
  }

  const finalRenderedHFrac = hRatio * targetScale;
  let offsetY = (1 - centerY) * finalRenderedHFrac + targetCenterYFrac - 1;

  if (touchesBottom) {
    const minGroundedOffsetY = (1 - bounds.maxY) * finalRenderedHFrac;
    if (offsetY < minGroundedOffsetY) {
      offsetY = minGroundedOffsetY;
    }
  }

  // Always preserve minimum top headroom so the user's head is never clipped at the top edge
  const minHeadroomOffsetY = (1 - bounds.minY) * finalRenderedHFrac + headroomMinFrac - 1;
  if (offsetY < minHeadroomOffsetY) {
    offsetY = minHeadroomOffsetY;
  }

  return {
    scale: Number(clamp(targetScale, 0.35, 2.0).toFixed(3)),
    offsetX: Number(clamp(offsetX, -0.6, 0.6).toFixed(3)),
    offsetY: Number(clamp(offsetY, -0.5, 0.5).toFixed(3)),
  };
}

/**
 * Frame-rate independent smooth PTZ-style camera tracker with deadzone stabilization.
 */
export class AutoFrameTracker {
  private smoothedBounds: SilhouetteBounds | null = null;
  private latchedTarget: FramingState | null = null;
  private lastTimestampMs = 0;

  reset(): void {
    this.smoothedBounds = null;
    this.latchedTarget = null;
    this.lastTimestampMs = 0;
  }

  update(
    rawBounds: SilhouetteBounds | null,
    current: FramingState,
    opts: AutoFrameOptions,
    timestampMs: number
  ): { framing: FramingState; detected: boolean } {
    const dt =
      this.lastTimestampMs > 0
        ? Math.min(0.15, Math.max(0.004, (timestampMs - this.lastTimestampMs) / 1000))
        : 1 / 30;
    this.lastTimestampMs = timestampMs;

    if (!rawBounds) {
      return { framing: current, detected: false };
    }

    if (!this.smoothedBounds) {
      this.smoothedBounds = { ...rawBounds };
    } else {
      const bAlpha = 1 - Math.exp(-dt * 6.5);
      this.smoothedBounds = {
        minX: this.smoothedBounds.minX + (rawBounds.minX - this.smoothedBounds.minX) * bAlpha,
        maxX: this.smoothedBounds.maxX + (rawBounds.maxX - this.smoothedBounds.maxX) * bAlpha,
        minY: this.smoothedBounds.minY + (rawBounds.minY - this.smoothedBounds.minY) * bAlpha,
        maxY: this.smoothedBounds.maxY + (rawBounds.maxY - this.smoothedBounds.maxY) * bAlpha,
        coverage: rawBounds.coverage,
      };
    }

    const candidate = computeAutoFrameTarget(this.smoothedBounds, opts);

    // Deadzone hysteresis prevents subtle micro-sway when already nicely centered
    if (!this.latchedTarget) {
      this.latchedTarget = candidate;
    } else {
      const dx = Math.abs(candidate.offsetX - this.latchedTarget.offsetX);
      const dy = Math.abs(candidate.offsetY - this.latchedTarget.offsetY);
      const ds = Math.abs(candidate.scale - this.latchedTarget.scale);
      if (dx > 0.015 || dy > 0.018 || ds > 0.035) {
        this.latchedTarget = candidate;
      }
    }

    const panBlend = 1 - Math.exp(-dt * 3.4);
    const zoomBlend = 1 - Math.exp(-dt * 2.2);

    const nextScale = current.scale + (this.latchedTarget.scale - current.scale) * zoomBlend;
    const nextOffsetX = current.offsetX + (this.latchedTarget.offsetX - current.offsetX) * panBlend;
    const nextOffsetY = current.offsetY + (this.latchedTarget.offsetY - current.offsetY) * panBlend;

    return {
      detected: true,
      framing: {
        scale: clamp(Number(nextScale.toFixed(4)), 0.35, 2.0),
        offsetX: clamp(Number(nextOffsetX.toFixed(4)), -0.6, 0.6),
        offsetY: clamp(Number(nextOffsetY.toFixed(4)), -0.5, 0.5),
      },
    };
  }
}
