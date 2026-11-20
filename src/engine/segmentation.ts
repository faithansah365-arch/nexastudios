import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { computeSilhouetteBounds, type SilhouetteBounds } from './autoFrame';
import {
  analyzeImageColorStats,
  analyzeMaskHealthAndRecover,
  createMaskPipelineBuffers,
  extractLumaAndMotion,
  refineAlphaMaskPipeline,
  type ImageColorStats,
  type MaskHealthMetrics,
  type MaskPipelineBuffers,
} from './mattingMath';

export type SegmentationMode = 'mediapipe' | 'chroma_key' | 'original';

export interface SegmentationStatus {
  mode: SegmentationMode;
  ready: boolean;
  loading: boolean;
  error: string | null;
  backendInfo: string;
}

export interface SegmentationDiagnostics {
  health: MaskHealthMetrics;
  fgStats: ImageColorStats | null;
  recoveredFramesCount: number;
  flaggedFramesCount: number;
}

const DEFAULT_HEALTH: MaskHealthMetrics = {
  state: 'ok',
  coverage: 0,
  borderLeakage: 0,
  iouStability: 1,
  recoveryStreak: 0,
  issueCategory: null,
  issueReason: null,
};

export class StudioSegmenter {
  private segmenter: ImageSegmenter | null = null;
  private initPromise: Promise<void> | null = null;
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private decontamCanvas: HTMLCanvasElement;
  private decontamCtx: CanvasRenderingContext2D;
  private personCanvas: HTMLCanvasElement;
  private personCtx: CanvasRenderingContext2D;
  private sampleCanvas: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D;
  private lastMaskImageData: ImageData | null = null;
  private lastDecontamImageData: ImageData | null = null;

  private maskBufSize = 0;
  private bufs: MaskPipelineBuffers = createMaskPipelineBuffers(0);
  private hasPrevFrame = false;
  private hasTemporalHistory = false;
  private hasPrevGood = false;
  private prevCoverage = 0;
  private recoveryStreak = 0;
  private lastMediaPipeTs = 0;

  public lastSilhouetteBounds: SilhouetteBounds | null = null;
  public lastDiagnostics: SegmentationDiagnostics = {
    health: DEFAULT_HEALTH,
    fgStats: null,
    recoveredFramesCount: 0,
    flaggedFramesCount: 0,
  };

  public status: SegmentationStatus = {
    mode: 'mediapipe',
    ready: false,
    loading: false,
    error: null,
    backendInfo: 'Not initialized',
  };

  constructor() {
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true })!;
    this.decontamCanvas = document.createElement('canvas');
    this.decontamCtx = this.decontamCanvas.getContext('2d')!;
    this.personCanvas = document.createElement('canvas');
    this.personCtx = this.personCanvas.getContext('2d')!;
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  private ensureBuffers(len: number): void {
    if (this.maskBufSize === len) return;
    this.maskBufSize = len;
    this.bufs = createMaskPipelineBuffers(len);
    this.hasPrevFrame = false;
    this.hasTemporalHistory = false;
    this.hasPrevGood = false;
    this.prevCoverage = 0;
    this.recoveryStreak = 0;
  }

  /**
   * Resets temporal history & failure streaks (call when switching clips or jumping timeline).
   */
  resetTemporalState(): void {
    this.hasPrevFrame = false;
    this.hasTemporalHistory = false;
    this.hasPrevGood = false;
    this.prevCoverage = 0;
    this.recoveryStreak = 0;
    this.lastDiagnostics = {
      health: DEFAULT_HEALTH,
      fgStats: null,
      recoveredFramesCount: 0,
      flaggedFramesCount: 0,
    };
  }

  private getMonotonicTimestamp(requestedMs: number): number {
    const candidate = Number.isFinite(requestedMs) ? Math.round(requestedMs) : this.lastMediaPipeTs + 33;
    const safeTs = Math.max(this.lastMediaPipeTs + 1, candidate);
    this.lastMediaPipeTs = safeTs;
    return safeTs;
  }

  async initMediaPipe(): Promise<boolean> {
    if (this.segmenter) {
      this.status = {
        mode: 'mediapipe',
        ready: true,
        loading: false,
        error: null,
        backendInfo: 'MediaPipe SelfieSegmenter (Local WASM)',
      };
      return true;
    }
    if (this.initPromise) {
      await this.initPromise;
      return Boolean(this.segmenter);
    }

    this.status = {
      ...this.status,
      loading: true,
      error: null,
      backendInfo: 'Loading local WASM segmentation model...',
    };

    this.initPromise = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        this.segmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/selfie_segmenter.tflite',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        this.status = {
          mode: 'mediapipe',
          ready: true,
          loading: false,
          error: null,
          backendInfo: 'MediaPipe SelfieSegmenter (GPU Delegate)',
        };
      } catch {
        try {
          const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
          this.segmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/models/selfie_segmenter.tflite',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          });
          this.status = {
            mode: 'mediapipe',
            ready: true,
            loading: false,
            error: null,
            backendInfo: 'MediaPipe SelfieSegmenter (CPU WASM)',
          };
        } catch (cpuErr) {
          this.segmenter = null;
          this.status = {
            mode: 'chroma_key',
            ready: true,
            loading: false,
            error:
              cpuErr instanceof Error
                ? `AI segmentation unavailable on this device (${cpuErr.message}). Switched to Chroma Key / Original mode.`
                : 'AI segmentation unavailable on this device. Switched to Chroma Key / Original mode.',
            backendInfo: 'Fallback: Chroma Key / Pass-through',
          };
        }
      }
    })();

    await this.initPromise;
    return Boolean(this.segmenter);
  }

  /**
   * Produces a clean, halo-free transparent RGBA canvas containing the segmented subject,
   * using motion-aware joint-edge matting, temporal hold recovery, and edge color decontamination.
   */
  extractSubjectCanvas(
    source: HTMLVideoElement | HTMLCanvasElement,
    mode: SegmentationMode,
    options: {
      lowPowerMode: boolean;
      edgeSoftness: number;
      edgeChoke?: number;
      bodySensitivity?: number;
      temporalStability?: number;
      detectSilhouette?: boolean;
      chromaColor: string;
      chromaSimilarity: number;
      chromaSmoothness: number;
      timestampMs: number;
    }
  ): HTMLCanvasElement {
    const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!srcW || !srcH) {
      this.lastSilhouetteBounds = null;
      return this.personCanvas;
    }

    if (this.personCanvas.width !== srcW || this.personCanvas.height !== srcH) {
      this.personCanvas.width = srcW;
      this.personCanvas.height = srcH;
    }

    if (mode === 'original') {
      const w = Math.min(256, srcW);
      const h = Math.max(1, Math.round((w / srcW) * srcH));
      if (this.sampleCanvas.width !== w || this.sampleCanvas.height !== h) {
        this.sampleCanvas.width = w;
        this.sampleCanvas.height = h;
      }
      this.sampleCtx.drawImage(source, 0, 0, w, h);
      const srcPixels = this.sampleCtx.getImageData(0, 0, w, h).data;
      const fgStats = analyzeImageColorStats(srcPixels, w, h);

      if (options.detectSilhouette && this.segmenter) {
        try {
          const result = this.segmenter.segmentForVideo(
            this.sampleCanvas,
            this.getMonotonicTimestamp(options.timestampMs)
          );
          const confidenceMasks = result.confidenceMasks;
          if (confidenceMasks && confidenceMasks.length > 0) {
            const floats = confidenceMasks[0].getAsFloat32Array();
            this.lastSilhouetteBounds = computeSilhouetteBounds(floats, w, h);
            result.close();
          }
        } catch {
          // Keep last valid bounds if single frame fails
        }
      } else if (!options.detectSilhouette) {
        this.lastSilhouetteBounds = null;
      }
      this.lastDiagnostics = {
        ...this.lastDiagnostics,
        health: { ...DEFAULT_HEALTH, coverage: this.lastSilhouetteBounds?.coverage ?? 0.45 },
        fgStats,
      };
      this.personCtx.clearRect(0, 0, srcW, srcH);
      this.personCtx.drawImage(source, 0, 0, srcW, srcH);
      return this.personCanvas;
    }

    if (mode === 'chroma_key') {
      return this.processChromaKey(source, srcW, srcH, options);
    }

    if (!this.segmenter) {
      this.lastSilhouetteBounds = null;
      this.personCtx.clearRect(0, 0, srcW, srcH);
      this.personCtx.drawImage(source, 0, 0, srcW, srcH);
      return this.personCanvas;
    }

    const maskW = options.lowPowerMode ? Math.min(360, srcW) : Math.min(640, srcW);
    const maskH = Math.max(1, Math.round((maskW / srcW) * srcH));

    if (this.sampleCanvas.width !== maskW || this.sampleCanvas.height !== maskH) {
      this.sampleCanvas.width = maskW;
      this.sampleCanvas.height = maskH;
      this.maskCanvas.width = maskW;
      this.maskCanvas.height = maskH;
      this.decontamCanvas.width = maskW;
      this.decontamCanvas.height = maskH;
      this.lastMaskImageData = this.maskCtx.createImageData(maskW, maskH);
      this.lastDecontamImageData = this.decontamCtx.createImageData(maskW, maskH);
      this.ensureBuffers(maskW * maskH);
    }

    this.sampleCtx.drawImage(source, 0, 0, maskW, maskH);
    const srcPixels = this.sampleCtx.getImageData(0, 0, maskW, maskH).data;
    const total = maskW * maskH;

    extractLumaAndMotion(srcPixels, this.bufs, total, this.hasPrevFrame);
    this.hasPrevFrame = true;

    const choke = Math.max(0, Math.min(1, options.edgeChoke ?? 0.3));
    const sensitivity = Math.max(0, Math.min(1, options.bodySensitivity ?? 0.65));
    const softness = Math.max(0, Math.min(10, options.edgeSoftness ?? 2));
    const stability = Math.max(0, Math.min(1, options.temporalStability ?? 0.65));

    try {
      const result = this.segmenter.segmentForVideo(
        this.sampleCanvas,
        this.getMonotonicTimestamp(options.timestampMs)
      );
      const confidenceMasks = result.confidenceMasks;
      if (confidenceMasks && confidenceMasks.length > 0) {
        const floats = confidenceMasks[0].getAsFloat32Array();
        const out = refineAlphaMaskPipeline(floats, maskW, maskH, this.bufs, {
          bodySensitivity: sensitivity,
          edgeChoke: choke,
          edgeSoftness: softness,
          temporalStability: stability,
          hasTemporalHistory: this.hasTemporalHistory,
        });
        result.close();
        this.hasTemporalHistory = true;

        // Failure Detection & Safe Temporal Recovery (never restores room background)
        const health = analyzeMaskHealthAndRecover(out, this.bufs.prevGood, maskW, maskH, {
          hasPrevGood: this.hasPrevGood,
          prevCoverage: this.prevCoverage,
          recoveryStreak: this.recoveryStreak,
          maxHoldFrames: 12,
        });

        if (health.state === 'ok') {
          this.hasPrevGood = true;
          this.prevCoverage = health.coverage;
          this.recoveryStreak = 0;
        } else {
          this.recoveryStreak = health.recoveryStreak;
        }

        // Always maintain silhouette bounds for QC & live framing diagnostics
        this.lastSilhouetteBounds = computeSilhouetteBounds(out, maskW, maskH);

        // Zero-readback foreground color analysis for auto studio color/exposure matching
        const fgStats = analyzeImageColorStats(srcPixels, maskW, maskH, out);

        this.lastDiagnostics = {
          health,
          fgStats,
          recoveredFramesCount:
            this.lastDiagnostics.recoveredFramesCount + (health.state === 'recovered' ? 1 : 0),
          flaggedFramesCount:
            this.lastDiagnostics.flaggedFramesCount + (health.state === 'flagged' ? 1 : 0),
        };

        const imgData = this.lastMaskImageData!;
        const data = imgData.data;
        const decontamData = this.lastDecontamImageData!.data;

        for (let y = 0; y < maskH; y++) {
          const row = y * maskW;
          for (let x = 0; x < maskW; x++) {
            const i = row + x;
            const p = i * 4;
            const alpha = out[i];

            if (alpha <= 0.015) {
              data[p] = 255;
              data[p + 1] = 255;
              data[p + 2] = 255;
              data[p + 3] = 0;
              decontamData[p + 3] = 0;
              continue;
            }

            if (alpha >= 0.88) {
              // Opaque interior core uses 100% full-resolution camera pixels
              data[p] = 255;
              data[p + 1] = 255;
              data[p + 2] = 255;
              data[p + 3] = Math.min(255, Math.round(alpha * 255));
              decontamData[p + 3] = 0;
              continue;
            }

            // Semi-transparent transition rim: decontaminate RGB toward nearby solid foreground color
            // so original room wall color does not bleed onto hair, ears, or shoulders
            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            let weightSum = 0;
            for (let dy = -2; dy <= 2; dy++) {
              const ny = y + dy;
              if (ny < 0 || ny >= maskH) continue;
              const nRow = ny * maskW;
              for (let dx = -2; dx <= 2; dx++) {
                const nx = x + dx;
                if (nx < 0 || nx >= maskW) continue;
                const na = out[nRow + nx];
                if (na >= 0.8) {
                  const np = (nRow + nx) * 4;
                  const w = na * (1 / (1 + dx * dx + dy * dy));
                  sumR += srcPixels[np] * w;
                  sumG += srcPixels[np + 1] * w;
                  sumB += srcPixels[np + 2] * w;
                  weightSum += w;
                }
              }
            }

            if (weightSum > 0) {
              const fgR = sumR / weightSum;
              const fgG = sumG / weightSum;
              const fgB = sumB / weightSum;
              const replaceMix = Math.min(0.95, 1 - alpha * 0.55);
              decontamData[p] = Math.round(srcPixels[p] * (1 - replaceMix) + fgR * replaceMix);
              decontamData[p + 1] = Math.round(srcPixels[p + 1] * (1 - replaceMix) + fgG * replaceMix);
              decontamData[p + 2] = Math.round(srcPixels[p + 2] * (1 - replaceMix) + fgB * replaceMix);
              decontamData[p + 3] = Math.min(255, Math.round(alpha * 255));
              // Exclude semi-transparent edge from full-res draw to avoid double room-color spill
              data[p] = 255;
              data[p + 1] = 255;
              data[p + 2] = 255;
              data[p + 3] = 0;
            } else {
              data[p] = 255;
              data[p + 1] = 255;
              data[p + 2] = 255;
              data[p + 3] = Math.min(255, Math.round(alpha * 255));
              decontamData[p + 3] = 0;
            }
          }
        }
        this.maskCtx.putImageData(imgData, 0, 0);
        this.decontamCtx.putImageData(this.lastDecontamImageData!, 0, 0);
      }
    } catch {
      // Keep last valid maskCanvas + decontamCanvas safely rather than exposing raw room background
      this.lastDiagnostics = {
        ...this.lastDiagnostics,
        recoveredFramesCount: this.lastDiagnostics.recoveredFramesCount + 1,
        health: {
          ...this.lastDiagnostics.health,
          state: this.hasPrevGood ? 'recovered' : 'flagged',
          issueCategory: 'dropout',
          issueReason: 'Frame segmentation interrupted; safely holding prior foreground matte.',
        },
      };
    }

    this.personCtx.save();
    this.personCtx.clearRect(0, 0, srcW, srcH);
    this.personCtx.imageSmoothingEnabled = true;
    this.personCtx.imageSmoothingQuality = 'high';
    this.personCtx.drawImage(this.maskCanvas, 0, 0, srcW, srcH);
    this.personCtx.globalCompositeOperation = 'source-in';
    this.personCtx.drawImage(source, 0, 0, srcW, srcH);
    // Composite decontaminated semi-transparent hair/shoulder rim behind full-res interior core
    this.personCtx.globalCompositeOperation = 'destination-over';
    this.personCtx.drawImage(this.decontamCanvas, 0, 0, srcW, srcH);
    this.personCtx.restore();

    return this.personCanvas;
  }

  private processChromaKey(
    source: HTMLVideoElement | HTMLCanvasElement,
    srcW: number,
    srcH: number,
    options: {
      lowPowerMode: boolean;
      detectSilhouette?: boolean;
      chromaColor: string;
      chromaSimilarity: number;
      chromaSmoothness: number;
    }
  ): HTMLCanvasElement {
    const scale = options.lowPowerMode ? 0.5 : 0.75;
    const w = Math.max(160, Math.round(srcW * scale));
    const h = Math.max(90, Math.round(srcH * scale));
    if (this.sampleCanvas.width !== w || this.sampleCanvas.height !== h) {
      this.sampleCanvas.width = w;
      this.sampleCanvas.height = h;
    }

    this.sampleCtx.drawImage(source, 0, 0, w, h);
    const frame = this.sampleCtx.getImageData(0, 0, w, h);
    const d = frame.data;

    const hex = options.chromaColor.replace('#', '');
    const keyR = parseInt(hex.slice(0, 2), 16) || 0;
    const keyG = parseInt(hex.slice(2, 4), 16) || 177;
    const keyB = parseInt(hex.slice(4, 6), 16) || 64;
    const isGreenScreen = keyG >= keyR && keyG >= keyB;
    const isBlueScreen = !isGreenScreen && keyB > keyR && keyB > keyG;

    const sim = options.chromaSimilarity * 255;
    const smooth = Math.max(1, options.chromaSmoothness * 255);

    let fgSumR = 0;
    let fgSumG = 0;
    let fgSumB = 0;
    let fgLumaSum = 0;
    let fgLumaSq = 0;
    let fgCount = 0;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const dr = r - keyR;
      const dg = g - keyG;
      const db = b - keyB;
      const dist = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);

      if (dist < sim) {
        d[i + 3] = 0;
      } else {
        if (dist < sim + smooth) {
          const t = (dist - sim) / smooth;
          d[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
        }
        // Color spill suppression on edge pixels so green/blue halos don't outline the subject
        if (isGreenScreen) {
          const maxOther = Math.max(r, b);
          if (g > maxOther) {
            const spillFactor = dist < sim + smooth * 2.2 ? 0.85 : 0.45;
            d[i + 1] = Math.round(g - (g - maxOther) * spillFactor);
          }
        } else if (isBlueScreen) {
          const maxOther = Math.max(r, g);
          if (b > maxOther) {
            const spillFactor = dist < sim + smooth * 2.2 ? 0.85 : 0.45;
            d[i + 2] = Math.round(b - (b - maxOther) * spillFactor);
          }
        }
        if (d[i + 3] >= 180) {
          const luma = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
          fgSumR += d[i];
          fgSumG += d[i + 1];
          fgSumB += d[i + 2];
          fgLumaSum += luma;
          fgLumaSq += luma * luma;
          fgCount++;
        }
      }
    }

    const bounds = computeSilhouetteBounds(d, w, h, { isRgbaUint8: true });
    this.lastSilhouetteBounds = bounds;

    const meanLuma = fgCount > 0 ? fgLumaSum / fgCount : 120;
    const fgStats: ImageColorStats | null =
      fgCount > 20
        ? {
            meanLuma,
            contrastStd: Math.sqrt(Math.max(0, fgLumaSq / fgCount - meanLuma * meanLuma)),
            meanR: fgSumR / fgCount,
            meanG: fgSumG / fgCount,
            meanB: fgSumB / fgCount,
            warmth: (fgSumR - fgSumB) / (fgCount * 255),
            sampleCount: fgCount,
          }
        : null;

    this.lastDiagnostics = {
      health: {
        state: bounds ? 'ok' : 'flagged',
        coverage: bounds?.coverage ?? 0,
        borderLeakage: 0,
        iouStability: 1,
        recoveryStreak: 0,
        issueCategory: bounds ? null : 'dropout',
        issueReason: bounds ? null : 'No subject visible after chroma key filter.',
      },
      fgStats,
      recoveredFramesCount: this.lastDiagnostics.recoveredFramesCount,
      flaggedFramesCount: this.lastDiagnostics.flaggedFramesCount + (bounds ? 0 : 1),
    };

    this.sampleCtx.putImageData(frame, 0, 0);
    this.personCtx.save();
    this.personCtx.clearRect(0, 0, srcW, srcH);
    this.personCtx.imageSmoothingEnabled = true;
    this.personCtx.imageSmoothingQuality = 'high';
    this.personCtx.drawImage(this.sampleCanvas, 0, 0, srcW, srcH);
    this.personCtx.restore();
    return this.personCanvas;
  }

  dispose(): void {
    if (this.segmenter) {
      this.segmenter.close();
      this.segmenter = null;
    }
    this.initPromise = null;
  }
}
