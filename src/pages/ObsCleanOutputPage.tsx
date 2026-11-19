import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { StudioSegmenter } from '../engine/segmentation';
import { getAspectDimensions, renderStudioFrame } from '../engine/studioRenderer';
import { loadImageElement } from '../engine/videoCapabilities';
import { apiRequest } from '../lib/api';
import type { CustomStudio, ExportResolution } from '../../shared/types';

/**
 * Clean OBS Browser Source Output View.
 * Exposes ONLY the rendered studio composition — never account info, navigation, or private project data.
 */
export function ObsCleanOutputPage() {
  const { studioId } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const transparent = params.get('transparent') === '1';
  const rawRes = params.get('res');
  const qualityProfile: ExportResolution =
    rawRes === '720p' || rawRes === '4k' ? rawRes : '1080p';
  const outDims = getAspectDimensions('16:9', qualityProfile);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const segRef = useRef<StudioSegmenter | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);

  const [scene, setScene] = useState<CustomStudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    if (!studioId || !token) {
      setError('Missing broadcast studio token.');
      return;
    }
    apiRequest<{ scene: CustomStudio }>(`/api/obs-scene/${encodeURIComponent(studioId)}?token=${encodeURIComponent(token)}`)
      .then((d) => {
        setScene(d.scene);
        if (d.scene.backgroundUrl) {
          loadImageElement(d.scene.backgroundUrl).then((img) => {
            bgImgRef.current = img;
          });
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load OBS scene.'));
  }, [studioId, token]);

  useEffect(() => {
    if (!scene) return;
    const seg = new StudioSegmenter();
    segRef.current = seg;
    let stream: MediaStream | null = null;

    const captureDims = getAspectDimensions('16:9', qualityProfile === '4k' ? '1080p' : qualityProfile);
    seg.initMediaPipe().then(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: captureDims.width }, height: { ideal: captureDims.height }, frameRate: { ideal: 30 } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        setError('Camera permission required inside OBS Browser Source or browser window.');
      }
    });

    return () => {
      seg.dispose();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [scene, qualityProfile]);

  useEffect(() => {
    if (!scene) return;
    let rafId = 0;
    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const seg = segRef.current;
      if (!canvas) return;
      if (canvas.width !== outDims.width || canvas.height !== outDims.height) {
        canvas.width = outDims.width;
        canvas.height = outDims.height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let subj: HTMLCanvasElement | null = null;
      if (cameraReady && video && video.readyState >= 2 && seg) {
        subj = seg.extractSubjectCanvas(video, 'mediapipe', {
          lowPowerMode: qualityProfile === '720p',
          edgeSoftness: scene.subjectConfig.edgeSoftness ?? 2,
          edgeChoke: scene.subjectConfig.edgeChoke ?? 0.3,
          bodySensitivity: scene.subjectConfig.bodySensitivity ?? 0.6,
          chromaColor: scene.subjectConfig.chromaKeyColor,
          chromaSimilarity: scene.subjectConfig.chromaSimilarity,
          chromaSmoothness: scene.subjectConfig.chromaSmoothness,
          timestampMs: now,
        });
      }

      renderStudioFrame(ctx, outDims.width, outDims.height, {
        backgroundImg: bgImgRef.current,
        customMaskImg: null,
        logoImg: null,
        subjectCanvas: subj,
        subjectConfig: scene.subjectConfig,
        foregroundMaskConfig: scene.foregroundMaskConfig,
        brandingConfig: scene.brandingConfig,
        lightingPreset: scene.lightingPreset,
        aspectRatio: '16:9',
        mirrorCamera: true,
        watermarkRequired: false,
        transparentBackground: transparent,
      });
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [scene, cameraReady, transparent, qualityProfile, outDims.width, outDims.height]);

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className={`w-screen h-screen overflow-hidden flex items-center justify-center ${transparent ? 'bg-transparent' : 'bg-black'}`}>
      <video ref={videoRef} playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="w-full h-full object-contain" />
    </div>
  );
}
