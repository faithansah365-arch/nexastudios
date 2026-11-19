import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ForegroundMaskConfig, SubjectConfig } from '../../shared/types';

interface ThreeStagePreviewProps {
  backgroundUrl: string;
  subjectConfig: SubjectConfig;
  foregroundMaskConfig: ForegroundMaskConfig;
  className?: string;
}

/**
 * Interactive Three.js 2.5D depth-plane visualizer.
 * Renders the Background, Subject Silhouette Plane, and Foreground Desk Plane
 * separated along the Z-axis so creators can inspect 2.5D layering geometry.
 */
export function ThreeStagePreview({
  backgroundUrl,
  subjectConfig,
  foregroundMaskConfig,
  className = '',
}: ThreeStagePreviewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 360;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0.1, 5.2);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambient);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];

    // Layer 1: Background Plane (Z = -1.6)
    const bgGeo = new THREE.PlaneGeometry(6.4, 3.6);
    geometries.push(bgGeo);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x172033 });
    materials.push(bgMat);
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.position.set(0, 0, -1.6);
    scene.add(bgMesh);

    if (backgroundUrl) {
      const loader = new THREE.TextureLoader();
      loader.load(backgroundUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        textures.push(tex);
        bgMat.color.setHex(0xffffff);
        bgMat.map = tex;
        bgMat.needsUpdate = true;
      });
    }

    // Layer 2: Subject Depth Plane (Z = 0)
    const subjGeo = new THREE.PlaneGeometry(1.5 * subjectConfig.scale, 2.2 * subjectConfig.scale);
    geometries.push(subjGeo);
    const subjMat = new THREE.MeshBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.42,
      wireframe: false,
    });
    materials.push(subjMat);
    const subjMesh = new THREE.Mesh(subjGeo, subjMat);
    subjMesh.position.set(subjectConfig.offsetX * 3, -0.2 + subjectConfig.offsetY * 2, 0);
    scene.add(subjMesh);

    const subjEdges = new THREE.EdgesGeometry(subjGeo);
    geometries.push(subjEdges);
    const subjLineMat = new THREE.LineBasicMaterial({ color: 0x06b6d4 });
    materials.push(subjLineMat);
    const subjWire = new THREE.LineSegments(subjEdges, subjLineMat);
    subjMesh.add(subjWire);

    // Layer 3: Foreground Desk Plane (Z = +0.9)
    let deskMesh: THREE.Mesh | null = null;
    if (foregroundMaskConfig.enabled && foregroundMaskConfig.deskStyle !== 'none') {
      const deskH = 2.6 * Math.max(0.15, foregroundMaskConfig.deskHeightRatio);
      const deskGeo = new THREE.PlaneGeometry(3.8, deskH);
      geometries.push(deskGeo);
      const deskMat = new THREE.MeshBasicMaterial({
        color: 0x0f172a,
        transparent: true,
        opacity: Math.min(0.92, foregroundMaskConfig.deskOpacity),
      });
      materials.push(deskMat);
      deskMesh = new THREE.Mesh(deskGeo, deskMat);
      deskMesh.position.set(0, -1.3 + deskH / 2, 0.9);
      scene.add(deskMesh);

      const deskEdges = new THREE.EdgesGeometry(deskGeo);
      geometries.push(deskEdges);
      const deskLineMat = new THREE.LineBasicMaterial({ color: 0x6366f1 });
      materials.push(deskLineMat);
      deskMesh.add(new THREE.LineSegments(deskEdges, deskLineMat));
    }

    let targetX = 0.35;
    let targetY = 0.15;
    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      targetX = nx * 0.85;
      targetY = -ny * 0.4 + 0.12;
    };
    container.addEventListener('pointermove', onPointerMove);

    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      camera.position.x += (targetX - camera.position.x) * 0.08;
      camera.position.y += (targetY - camera.position.y) * 0.08;
      camera.lookAt(0, 0, -0.2);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 360;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      renderer.dispose();
    };
  }, [backgroundUrl, subjectConfig.scale, subjectConfig.offsetX, subjectConfig.offsetY, foregroundMaskConfig]);

  return (
    <div
      ref={mountRef}
      className={`relative w-full h-full overflow-hidden rounded-lg bg-[#080B14] border border-slate-800 ${className}`}
      aria-label="2.5D layered virtual studio depth stage"
    />
  );
}
