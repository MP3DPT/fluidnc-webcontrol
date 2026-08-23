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
  /** Purely a display preference, not physical truth - shifts the whole path
   * so it renders entirely above (or entirely below) the grid plane, since a
   * path that straddles Z0 reads as visually tangled with the grid. */
  aboveGrid: boolean;
}

/** How far to shift every Z so the path sits flush against the grid on the
 * requested side, instead of straddling it. 0 with no segments loaded. */
function zOffsetFor(segments: Segment[], aboveGrid: boolean): number {
  if (segments.length === 0) return 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const seg of segments) {
    minZ = Math.min(minZ, seg.z1, seg.z2);
    maxZ = Math.max(maxZ, seg.z1, seg.z2);
  }
  return aboveGrid ? -minZ : -maxZ;
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

/** Reads a CSS custom property (e.g. "#a78bfa") and returns it as a THREE color hex number. */
function cssVarHex(name: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return fallback;
  return parseInt(value.slice(1), 16);
}

/** A billboarded text label (canvas-drawn, then used as a sprite texture) - the
 * lightweight way to drop a letter into a THREE scene without a text-layout library. */
function makeAxisLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 44px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, depthWrite: false }),
  );
  sprite.scale.set(6, 6, 1);
  return sprite;
}

export const ToolpathPreview3D = forwardRef<ToolpathPreviewHandle, Props>(function ToolpathPreview3D(
  { segments, currentPosition, sentLines, aboveGrid },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const segmentsRef = useRef<Segment[]>(segments);
  segmentsRef.current = segments;
  // Kept in sync by the geometry-rebuild effect below, so the camera-fit and
  // live-position marker (both of which run far more often than the geometry
  // itself changes) can reuse the same offset without recomputing it.
  const zOffsetRef = useRef(0);

  const fitToSegments = () => {
    const s = sceneRef.current;
    const currentSegments = segmentsRef.current;
    if (!s || currentSegments.length === 0) return;

    const zOffset = zOffsetRef.current;
    const box = new THREE.Box3();
    for (const seg of currentSegments) {
      box.expandByPoint(new THREE.Vector3(seg.x1, seg.y1, seg.z1 + zOffset));
      box.expandByPoint(new THREE.Vector3(seg.x2, seg.y2, seg.z2 + zOffset));
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

    // The container's own height now comes from CSS flex layout (it fills
    // whatever space the Toolpath card's flex:1 gives it), not a fixed
    // pixel constant - read both dimensions live instead of assuming one.
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    camera.up.set(0, 0, 1); // Z-up, matching CNC convention
    camera.position.set(150, -250, 200);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const grid = new THREE.GridHelper(400, 40, 0x666666, 0x333640);
    grid.rotation.x = Math.PI / 2; // GridHelper defaults to the XZ plane - rotate flat onto XY
    scene.add(grid);
    scene.add(new THREE.AxesHelper(30));

    // Axis letters at the tip of each AxesHelper line - matching its default
    // red/green/blue so the label color ties directly back to the line it names.
    const xLabel = makeAxisLabel('X', '#ff4d4d');
    xLabel.position.set(34, 0, 0);
    const yLabel = makeAxisLabel('Y', '#4dff4d');
    yLabel.position.set(0, 34, 0);
    const zLabel = makeAxisLabel('Z', '#4d8cff');
    zLabel.position.set(0, 0, 34);
    scene.add(xLabel, yLabel, zLabel);

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
      const h = container.clientHeight;
      if (w === 0 || h === 0) return; // mid-layout, before flex sizing has settled
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
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

  // Rebuild line geometry whenever the loaded path, streaming progress, or
  // the above/below-grid display preference changes.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    const zOffset = zOffsetFor(segments, aboveGrid);
    zOffsetRef.current = zOffset;

    const done: number[] = [];
    const pending: number[] = [];
    const rapid: number[] = [];

    for (const seg of segments) {
      const bucket = seg.rapid ? rapid : seg.lineIndex < sentLines ? done : pending;
      bucket.push(seg.x1, seg.y1, seg.z1 + zOffset, seg.x2, seg.y2, seg.z2 + zOffset);
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
  }, [segments, sentLines, aboveGrid]);

  // Fit the camera to the loaded path - only on a new file or a toggle of the
  // above/below preference, not on every progress tick (which would
  // otherwise yank the view while orbiting/watching).
  useEffect(() => {
    fitToSegments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, aboveGrid]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (currentPosition) {
      s.marker.visible = true;
      s.marker.position.set(currentPosition.x, currentPosition.y, currentPosition.z + zOffsetRef.current);
    } else {
      s.marker.visible = false;
    }
  }, [currentPosition]);

  return <div ref={containerRef} className="toolpath-container" />;
});
