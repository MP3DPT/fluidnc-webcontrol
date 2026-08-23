import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Segment } from '../gcode/parseToolpath';
import type { Position } from '../types';

interface Props {
  segments: Segment[];
  currentPosition: Position | null;
  /** Number of lines already streamed (ProgramStatus.sent) - segments with
   * a lineIndex below this are drawn as "done" rather than "pending". */
  sentLines: number;
}

export interface ToolpathPreviewHandle {
  /** Re-fits the camera to the currently loaded path - same framing logic used automatically on a new file. */
  resetView: () => void;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  doneLines: THREE.LineSegments;
  pendingLines: THREE.LineSegments;
  rapidLines: THREE.LineSegments;
  marker: THREE.Mesh;
}

const HEIGHT = 320;

/** Reads a CSS custom property (e.g. "#a78bfa") and returns it as a THREE color hex number. */
function cssVarHex(name: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return fallback;
  return parseInt(value.slice(1), 16);
}

export const ToolpathPreview3D = forwardRef<ToolpathPreviewHandle, Props>(function ToolpathPreview3D(
  { segments, currentPosition, sentLines },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const segmentsRef = useRef<Segment[]>(segments);
  segmentsRef.current = segments;

  const fitToSegments = () => {
    const s = sceneRef.current;
    const currentSegments = segmentsRef.current;
    if (!s || currentSegments.length === 0) return;

    const box = new THREE.Box3();
    for (const seg of currentSegments) {
      box.expandByPoint(new THREE.Vector3(seg.x1, seg.y1, seg.z1));
      box.expandByPoint(new THREE.Vector3(seg.x2, seg.y2, seg.z2));
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);

    s.controls.target.copy(center);
    s.camera.position.set(center.x - maxDim, center.y - maxDim, center.z + maxDim);
    s.camera.near = maxDim / 100;
    s.camera.far = maxDim * 100;
    s.camera.updateProjectionMatrix();
  };

  useImperativeHandle(ref, () => ({ resetView: fitToSegments }));

  // One-time scene setup.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, width / HEIGHT, 0.1, 10000);
    camera.up.set(0, 0, 1); // Z-up, matching CNC convention
    camera.position.set(150, -250, 200);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, HEIGHT);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const grid = new THREE.GridHelper(400, 40, 0x666666, 0x333640);
    grid.rotation.x = Math.PI / 2; // GridHelper defaults to the XZ plane - rotate flat onto XY
    scene.add(grid);
    scene.add(new THREE.AxesHelper(30));

    const doneColor = cssVarHex('--success', 0x22c55e);
    const pendingColor = cssVarHex('--primary', 0x3b82f6);
    const dangerColor = cssVarHex('--danger', 0xef4444);

    const doneLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: doneColor }));
    const pendingLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: pendingColor }));
    const rapidLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x777777, dashSize: 2, gapSize: 1.5 }),
    );
    scene.add(doneLines, pendingLines, rapidLines);

    const marker = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 16), new THREE.MeshBasicMaterial({ color: dangerColor }));
    marker.visible = false;
    scene.add(marker);

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    sceneRef.current = { renderer, scene, camera, controls, doneLines, pendingLines, rapidLines, marker };

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      camera.aspect = w / HEIGHT;
      camera.updateProjectionMatrix();
      renderer.setSize(w, HEIGHT);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Rebuild line geometry whenever the loaded path or streaming progress changes.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    const done: number[] = [];
    const pending: number[] = [];
    const rapid: number[] = [];

    for (const seg of segments) {
      const bucket = seg.rapid ? rapid : seg.lineIndex < sentLines ? done : pending;
      bucket.push(seg.x1, seg.y1, seg.z1, seg.x2, seg.y2, seg.z2);
    }

    const setPositions = (line: THREE.LineSegments, positions: number[]) => {
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry();
      line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    };
    setPositions(s.doneLines, done);
    setPositions(s.pendingLines, pending);
    setPositions(s.rapidLines, rapid);
    s.rapidLines.computeLineDistances();
  }, [segments, sentLines]);

  // Fit the camera to the loaded path - only on a new file, not on every
  // progress tick (which would otherwise yank the view while orbiting/watching).
  useEffect(() => {
    fitToSegments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (currentPosition) {
      s.marker.visible = true;
      s.marker.position.set(currentPosition.x, currentPosition.y, currentPosition.z);
    } else {
      s.marker.visible = false;
    }
  }, [currentPosition]);

  return <div ref={containerRef} className="toolpath-container" style={{ height: HEIGHT }} />;
});
