import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { computeSilhouetteBounds, type SilhouetteBounds } from './autoFrame';

export type SegmentationMode = 'mediapipe' | 'chroma_key' | 'original';

export interface SegmentationStatus {
  mode: SegmentationMode;
  ready: boolean;
  loading: boolean;
  error: string | null;
  backendInfo: string;
}

export class StudioSegmenter {
  private segmenter: ImageSegmenter | null = null;
  private initPromise: Promise<void> | null = null;
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private personCanvas: HTMLCanvasElement;
  private personCtx: CanvasRenderingContext2D;
  private sampleCanvas: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D;
  private lastMaskImageData: ImageData | null = null;

  // Reusable per-pixel Float32 buffers for zero-allocation mask refinement
  private maskBufSize = 0;
  private rawBuf = new Float32Array(0);
  private erodeHorizBuf = new Float32Array(0);
  private erodedBuf = new Float32Array(0);
  private temporalBuf = new Float32Array(0);
  private blurHorizBuf = new Float32Array(0);
  private finalBuf = new Float32Array(0);
  private hasTemporalHistory = false;
  public lastSilhouetteBounds: SilhouetteBounds | null = null;

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
    this.personCanvas = document.createElement('canvas');
    this.personCtx = this.personCanvas.getContext('2d')!;
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  private ensureBuffers(len: number): void {
    if (this.maskBufSize === len) return;
    this.maskBufSize = len;
    this.rawBuf = new Float32Array(len);
    this.erodeHorizBuf = new Float32Array(len);
    this.erodedBuf = new Float32Array(len);
    this.temporalBuf = new Float32Array(len);
    this.blurHorizBuf = new Float32Array(len);
    this.finalBuf = new Float32Array(len);
    this.hasTemporalHistory = false;
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
   * Produces a clean, halo-free transparent RGBA canvas containing the segmented subject.
   */
  extractSubjectCanvas(
    source: HTMLVideoElement | HTMLCanvasElement,
    mode: SegmentationMode,
    options: {
      lowPowerMode: boolean;
      edgeSoftness: number;
      edgeChoke?: number;
      bodySensitivity?: number;
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
      if (options.detectSilhouette && this.segmenter) {
        const maskW = Math.min(256, srcW);
        const maskH = Math.max(1, Math.round((maskW / srcW) * srcH));
        if (this.sampleCanvas.width !== maskW || this.sampleCanvas.height !== maskH) {
          this.sampleCanvas.width = maskW;
          this.sampleCanvas.height = maskH;
        }
        this.sampleCtx.drawImage(source, 0, 0, maskW, maskH);
        try {
          const result = this.segmenter.segmentForVideo(this.sampleCanvas, options.timestampMs);
          const confidenceMasks = result.confidenceMasks;
          if (confidenceMasks && confidenceMasks.length > 0) {
            const floats = confidenceMasks[0].getAsFloat32Array();
            this.lastSilhouetteBounds = computeSilhouetteBounds(floats, maskW, maskH);
            result.close();
          }
        } catch {
          // Keep last valid bounds if single frame fails
        }
      } else if (!options.detectSilhouette) {
        this.lastSilhouetteBounds = null;
      }
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
      this.lastMaskImageData = this.maskCtx.createImageData(maskW, maskH);
      this.ensureBuffers(maskW * maskH);
    }

    this.sampleCtx.drawImage(source, 0, 0, maskW, maskH);

    const choke = Math.max(0, Math.min(1, options.edgeChoke ?? 0.3));
    const sensitivity = Math.max(0, Math.min(1, options.bodySensitivity ?? 0.6));
    const softness = Math.max(0, Math.min(10, options.edgeSoftness ?? 2));

    try {
      const result = this.segmenter.segmentForVideo(this.sampleCanvas, options.timestampMs);
      const confidenceMasks = result.confidenceMasks;
      if (confidenceMasks && confidenceMasks.length > 0) {
        const floats = confidenceMasks[0].getAsFloat32Array();
        const total = maskW * maskH;
        const raw = this.rawBuf;

        // 1. Calibrated smoothstep guided by bodySensitivity (keeps hands, arms & dark clothes) + edgeChoke
        const low = Math.max(0.08, 0.36 - sensitivity * 0.22 + choke * 0.14);
        const high = Math.max(low + 0.16, 0.78 - sensitivity * 0.2);
        const span = high - low;
        for (let i = 0; i < total; i++) {
          const conf = floats[i];
          if (conf <= low) {
            raw[i] = 0;
          } else if (conf >= high) {
            raw[i] = 1;
          } else {
            const t = (conf - low) / span;
            raw[i] = t * t * (3 - 2 * t);
          }
        }
        result.close();

        // 1b. Interior hole recovery: if neighboring pixels are mostly body, restore dropped torso/hand patches
        if (sensitivity > 0.35) {
          const recoverWeight = Math.min(1, (sensitivity - 0.35) * 1.4);
          for (let y = 1; y < maskH - 1; y++) {
            const row = y * maskW;
            for (let x = 1; x < maskW - 1; x++) {
              const idx = row + x;
              const cur = raw[idx];
              if (cur > 0.04 && cur < 0.85) {
                const neighAvg =
                  (raw[idx - 1] + raw[idx + 1] + raw[idx - maskW] + raw[idx + maskW]) * 0.25;
                if (neighAvg > 0.65) {
                  raw[idx] = cur + (neighAvg - cur) * recoverWeight * 0.65;
                }
              }
            }
          }
        }

        // 2. Gentle 1px inward anti-halo trim (preserves thin arms/hands while removing background lines)
        const eroded = this.erodedBuf;
        if (choke > 0.06) {
          const eH = this.erodeHorizBuf;
          for (let y = 0; y < maskH; y++) {
            const row = y * maskW;
            for (let x = 0; x < maskW; x++) {
              let m = raw[row + x];
              const xl = x > 0 ? x - 1 : 0;
              const xr = x + 1 < maskW ? x + 1 : maskW - 1;
              if (raw[row + xl] < m) m = raw[row + xl];
              if (raw[row + xr] < m) m = raw[row + xr];
              eH[row + x] = m;
            }
          }
          const erodeBlend = Math.min(0.85, choke * 0.9);
          for (let y = 0; y < maskH; y++) {
            const row = y * maskW;
            const yu = (y > 0 ? y - 1 : 0) * maskW;
            const yd = (y + 1 < maskH ? y + 1 : maskH - 1) * maskW;
            for (let x = 0; x < maskW; x++) {
              let m = eH[row + x];
              if (eH[yu + x] < m) m = eH[yu + x];
              if (eH[yd + x] < m) m = eH[yd + x];
              eroded[row + x] = raw[row + x] * (1 - erodeBlend) + m * erodeBlend;
            }
          }
        } else {
          eroded.set(raw);
        }

        // 3. Motion-adaptive temporal stabilization (stops silhouette line shimmer without ghosting)
        const temporal = this.temporalBuf;
        if (!this.hasTemporalHistory) {
          temporal.set(eroded);
          this.hasTemporalHistory = true;
        } else {
          for (let i = 0; i < total; i++) {
            const curr = eroded[i];
            const prev = temporal[i];
            const diff = Math.abs(curr - prev);
            // Large motion updates fast; micro-jitter around edges is damped
            const blend = diff > 0.28 ? 0.88 : diff > 0.1 ? 0.62 : 0.4;
            temporal[i] = prev + (curr - prev) * blend;
          }
        }

        // 4. Strictly INWARD spatial feathering (never expands alpha outward over room walls)
        const out = this.finalBuf;
        if (softness > 0.2) {
          const bH = this.blurHorizBuf;
          const r = softness >= 4 ? 2 : 1;
          const div = r * 2 + 1;
          for (let y = 0; y < maskH; y++) {
            const row = y * maskW;
            for (let x = 0; x < maskW; x++) {
              let sum = temporal[row + x];
              for (let k = 1; k <= r; k++) {
                const xl = x - k >= 0 ? x - k : 0;
                const xr = x + k < maskW ? x + k : maskW - 1;
                sum += temporal[row + xl] + temporal[row + xr];
              }
              bH[row + x] = sum / div;
            }
          }
          const featherMix = Math.min(1, softness / 5);
          for (let y = 0; y < maskH; y++) {
            const row = y * maskW;
            for (let x = 0; x < maskW; x++) {
              let sum = bH[row + x];
              for (let k = 1; k <= r; k++) {
                const yu = (y - k >= 0 ? y - k : 0) * maskW;
                const yd = (y + k < maskH ? y + k : maskH - 1) * maskW;
                sum += bH[yu + x] + bH[yd + x];
              }
              const blurred = sum / div;
              const orig = temporal[row + x];
              const mixed = orig * (1 - featherMix) + blurred * featherMix;
              // Clamping to `orig` prevents any outward halo expansion into background pixels
              out[row + x] = mixed < orig ? mixed : orig;
            }
          }
        } else {
          out.set(temporal);
        }

        if (options.detectSilhouette) {
          this.lastSilhouetteBounds = computeSilhouetteBounds(out, maskW, maskH);
        } else {
          this.lastSilhouetteBounds = null;
        }

        const imgData = this.lastMaskImageData!;
        const data = imgData.data;
        for (let i = 0; i < total; i++) {
          const p = i * 4;
          data[p] = 255;
          data[p + 1] = 255;
          data[p + 2] = 255;
          data[p + 3] = Math.max(0, Math.min(255, Math.round(out[i] * 255)));
        }
        this.maskCtx.putImageData(imgData, 0, 0);
      }
    } catch {
      // Keep last valid mask if a single frame fails
    }

    this.personCtx.save();
    this.personCtx.clearRect(0, 0, srcW, srcH);
    this.personCtx.imageSmoothingEnabled = true;
    this.personCtx.imageSmoothingQuality = 'high';
    this.personCtx.drawImage(this.maskCanvas, 0, 0, srcW, srcH);
    this.personCtx.globalCompositeOperation = 'source-in';
    this.personCtx.drawImage(source, 0, 0, srcW, srcH);
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
      }
    }

    if (options.detectSilhouette) {
      this.lastSilhouetteBounds = computeSilhouetteBounds(d, w, h, { isRgbaUint8: true });
    } else {
      this.lastSilhouetteBounds = null;
    }

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
