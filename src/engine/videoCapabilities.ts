export interface BrowserCapabilities {
  mediaDevicesSupported: boolean;
  mediaRecorderSupported: boolean;
  supportedMimeType: string | null;
  webGLSupported: boolean;
  webGPUSupported: boolean;
  hardwareConcurrency: number;
  lowPowerRecommended: boolean;
}

export function detectBrowserCapabilities(): BrowserCapabilities {
  const mediaDevicesSupported = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const mediaRecorderSupported = typeof MediaRecorder !== 'undefined';

  const preferredMimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4',
  ];

  let supportedMimeType: string | null = null;
  if (mediaRecorderSupported && typeof MediaRecorder.isTypeSupported === 'function') {
    for (const mime of preferredMimeTypes) {
      if (MediaRecorder.isTypeSupported(mime)) {
        supportedMimeType = mime;
        break;
      }
    }
  }

  let webGLSupported = false;
  try {
    const testCanvas = document.createElement('canvas');
    webGLSupported = Boolean(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'));
  } catch {
    webGLSupported = false;
  }

  const webGPUSupported = 'gpu' in navigator;
  const hardwareConcurrency = navigator.hardwareConcurrency || 4;
  const lowPowerRecommended = hardwareConcurrency <= 4;

  return {
    mediaDevicesSupported,
    mediaRecorderSupported,
    supportedMimeType,
    webGLSupported,
    webGPUSupported,
    hardwareConcurrency,
    lowPowerRecommended,
  };
}

export function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
