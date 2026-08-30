import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
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
  /** The user's configured working area (Settings -> Working Area), in mm
   * from machine (0,0); 0 = not configured. When set, the grid is drawn at
   * exactly this fixed size instead of auto-fitting to the loaded part - the
   * working area is a physical fact about the machine, not something that
   * should shrink to flatter an oversized job. 0 keeps the previous
   * auto-fit-to-part behavior for that axis. */
  spoilboardWidth: number;
  spoilboardHeight: number;
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

/** Shared by the camera fit and the grid resize, so "what does the loaded path actually occupy" is computed exactly once, the same way, for both. */
function boundsOfSegments(segments: Segment[], zOffset: number): THREE.Box3 {
  const box = new THREE.Box3();
  for (const seg of segments) {
    box.expandByPoint(new THREE.Vector3(seg.x1, seg.y1, seg.z1 + zOffset));
    box.expandByPoint(new THREE.Vector3(seg.x2, seg.y2, seg.z2 + zOffset));
  }
  return box;
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
  grid: THREE.LineSegments;
  axisRuler: THREE.Group;
  /** Live viewport size in pixels, shared with every LineMaterial in the axis
   * ruler - screen-space linewidth needs this kept in sync on every resize,
   * or the ruler's thickness silently drifts from what was asked for. */
  resolution: THREE.Vector2;
  doneLines: THREE.LineSegments;
  pendingLines: THREE.LineSegments;
  rapidLines: THREE.LineSegments;
  marker: THREE.Mesh;
}

const DEFAULT_GRID_SIZE = 400;
const GRID_DIVISIONS = 40;

/** Builds the ground grid as plain line segments spanning [minX,maxX] x
 * [minY,maxY] - NOT necessarily symmetric about (0,0). A plain THREE.GridHelper
 * can only ever be centered on its own origin, which is what this replaced:
 * to put machine (0,0) at a *corner* of the grid instead of its center (the
 * common case - work coordinates are all-positive, origin at a table/stock
 * corner), the grid needs independent min/max per axis. Square cells sized
 * off the larger of the two spans, so a wide-but-short part doesn't get
 * stretched rectangular cells. */
function makeGrid(minX: number, maxX: number, minY: number, maxY: number): THREE.LineSegments {
  const cellSize = Math.max(maxX - minX, maxY - minY, 1) / GRID_DIVISIONS;

  const points: number[] = [];
  for (let x = minX; x <= maxX + 1e-6; x += cellSize) points.push(x, minY, 0, x, maxY, 0);
  for (let y = minY; y <= maxY + 1e-6; y += cellSize) points.push(minX, y, 0, maxX, y, 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  // Confirmed the hard way: a resize does scene.remove()+scene.add(), which
  // moves the grid to the end of the scene graph - drawn after the
  // toolpath, which sits at the exact same Z0 plane. depthWrite:false alone
  // isn't enough: THREE's default depth *function* is LessEqualDepth, not
  // strict "less than", so a same-depth fragment still passes the test and
  // overwrites the color buffer regardless of depthWrite. depthTest:false
  // is what actually stops that - the grid then draws unconditionally, and
  // renderOrder=-2 makes sure that unconditional draw happens first
  // regardless of where the resize left it in the scene graph, so anything
  // drawn after (the toolpath, normal depth test) still wins correctly.
  // Must be strictly lower than the axis ruler's renderOrder (-1): both have
  // depthTest:false, so with equal renderOrder the tie-break between them is
  // arbitrary (material id, not scene order) - found the hard way when the
  // ruler silently lost that tie-break and was invisible behind the grid.
  const material = new THREE.LineBasicMaterial({ color: 0x333640, depthWrite: false, depthTest: false });
  const grid = new THREE.LineSegments(geometry, material);
  grid.renderOrder = -2;
  return grid;
}

/** Extends [minVal,maxVal] outward by 20% padding so the part's own edge
 * isn't flush against the grid boundary, rounded to a clean 100mm so the
 * size doesn't jitter by a millimeter between similar files, and never
 * smaller than the default grid size on the positive side. Deliberately
 * asymmetric: 0 only gets pushed outward on whichever side the part
 * actually crosses it, so an all-positive part (the common case - machine
 * origin at a table/stock corner) keeps (0,0) sitting at a corner of the
 * grid rather than forcing it back to the center. */
function paddedAxisRange(minVal: number, maxVal: number, defaultSize: number): [number, number] {
  const paddedMin = Math.min(0, minVal * 1.2);
  const paddedMax = Math.max(defaultSize, maxVal * 1.2);
  return [Math.floor(paddedMin / 100) * 100, Math.ceil(paddedMax / 100) * 100];
}

/** A configured spoilboard size (Settings -> Working Area) is a fixed
 * physical fact - once set, the grid always shows exactly [0,spoilboardSize]
 * for that axis, regardless of what's loaded (an oversized job should look
 * oversized against it, not silently grow the board to fit). 0 means "not
 * configured", falling back to the previous auto-fit-to-part behavior. */
function gridRangeFor(spoilboardSize: number, boxMin: number, boxMax: number, defaultSize: number): [number, number] {
  if (spoilboardSize > 0) return [0, spoilboardSize];
  return paddedAxisRange(boxMin, boxMax, defaultSize);
}

/** Picks the largest "nice" spacing (in mm) that keeps roughly 40 or fewer
 * ticks across the whole axis, so a big part's ruler doesn't turn into an
 * unreadable wall of tiny numbers - defaults to 20mm (what a small/default
 * grid gets) since that's the readable spacing for typical part sizes. */
function tickIntervalFor(gridSize: number): number {
  const candidates = [20, 50, 100, 200, 500, 1000, 2000, 5000];
  for (const c of candidates) {
    if (gridSize / c <= 40) return c;
  }
  return candidates[candidates.length - 1];
}

/** A small billboarded number, for ruler tick marks - same canvas-sprite technique as makeAxisLabel, just smaller since there are many more of these. Bold + high canvas resolution (scaled back down via the sprite's world-unit size below) - a thin unbolded glyph this small anti-aliases into an almost-illegible smudge. Canvas resolution and sprite scale are kept at the same ratio so bumping one for legibility doesn't blur the other. */
function makeTickLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 288;
  canvas.height = 144;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 96px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 144, 72);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, depthWrite: false }),
  );
  sprite.scale.set(15, 7.5, 1); // 3x the previous (5, 2.5) - requested bigger, easier to read at a glance
  return sprite;
}

/** A single solid-colored, screen-space-thick line segment. Plain THREE.Line
 * is WebGL's thinnest possible line - effectively always 1px on every
 * platform regardless of `linewidth` (a long-standing WebGL limitation, not
 * a three.js bug) - which reads as "practically invisible" against a busy
 * grid at a normal viewport size. LineSegments2/LineMaterial draws an
 * actual screen-space-width quad instead, which is why it needs the
 * viewport's pixel size (`resolution`) kept in sync on every resize. */
function makeAxisLine(from: THREE.Vector3, to: THREE.Vector3, colorHex: number, resolution: THREE.Vector2): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions([from.x, from.y, from.z, to.x, to.y, to.z]);
  const material = new LineMaterial({
    color: colorHex,
    linewidth: 2, // screen pixels (worldUnits defaults to false)
    depthWrite: false,
    depthTest: false,
    resolution,
  });
  return new LineSegments2(geometry, material);
}

/** Full-length solid X/Y axis lines through the origin, with numbered tick
 * labels at a regular interval - so it's obvious at a glance exactly where a
 * point sits relative to machine (0,0), not just "somewhere near the grid".
 * Spans [minX,maxX] x [minY,maxY] to match the grid exactly (same reasoning
 * as makeGrid - not necessarily symmetric about 0), rebuilt alongside it on
 * every resize. paddedAxisRange guarantees 0 is always within both ranges,
 * so the axis lines and the shared "0" label are always in-bounds. */
function makeAxisRuler(minX: number, maxX: number, minY: number, maxY: number, resolution: THREE.Vector2): THREE.Group {
  const group = new THREE.Group();
  const interval = tickIntervalFor(Math.max(maxX - minX, maxY - minY));
  const xColorHex = 0xff4d4d;
  const yColorHex = 0x4dff4d;

  // depthTest/depthWrite both false, same reason as the grid (see makeGrid's
  // comment) - a resize re-adds this at the end of the scene graph too, and
  // it sits at the same Z0 plane as the toolpath. renderOrder=-1 (vs the
  // grid's -2) so this reliably draws after the grid and wins the shared
  // Z0 plane instead of an arbitrary tie-break.
  const xLine = makeAxisLine(new THREE.Vector3(minX, 0, 0), new THREE.Vector3(maxX, 0, 0), xColorHex, resolution);
  const yLine = makeAxisLine(new THREE.Vector3(0, minY, 0), new THREE.Vector3(0, maxY, 0), yColorHex, resolution);
  group.add(xLine, yLine);
  group.renderOrder = -1;

  // Nudges each label off the line it's labeling, so it doesn't render
  // directly on top of it - widened alongside the 3x-bigger label sprites
  // (makeTickLabel) so the label actually clears the line instead of
  // straddling it. Always offset from the *other* axis's line at 0 (not
  // from minX/minY) - that's the line each tick is actually next to.
  const tickOffset = Math.max(interval * 0.25, 8);

  const firstX = Math.ceil(minX / interval) * interval;
  for (let v = firstX; v <= maxX + 1e-6; v += interval) {
    if (Math.abs(v) < interval / 2) continue; // origin gets one shared "0" below, not one per axis
    const xTick = makeTickLabel(String(Math.round(v)), '#ff4d4d');
    xTick.position.set(v, -tickOffset, 0.1);
    group.add(xTick);
  }
  const firstY = Math.ceil(minY / interval) * interval;
  for (let v = firstY; v <= maxY + 1e-6; v += interval) {
    if (Math.abs(v) < interval / 2) continue;
    const yTick = makeTickLabel(String(Math.round(v)), '#4dff4d');
    yTick.position.set(-tickOffset, v, 0.1);
    group.add(yTick);
  }
  const zero = makeTickLabel('0', '#aaaaaa');
  zero.position.set(-tickOffset, -tickOffset, 0.1);
  group.add(zero);

  return group;
}

/** Disposes every child's geometry/material/texture - a plain scene.remove() only unlinks them, it doesn't free the GPU-side resources this group accumulates every resize. */
function disposeAxisRuler(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof LineSegments2) {
      // Note: NOT a THREE.Line - LineSegments2 extends Mesh, so it needs its
      // own branch here or dispose() silently does nothing for it.
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    } else if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  }
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
  { segments, currentPosition, sentLines, aboveGrid, spoilboardWidth, spoilboardHeight },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const segmentsRef = useRef<Segment[]>(segments);
  segmentsRef.current = segments;
  // Read by rebuildGrid, including from the one-time setup effect below
  // (which only runs once, so it can't just close over the latest props) -
  // refs keep both call sites reading the current value without needing
  // rebuildGrid itself in that effect's dep array.
  const spoilboardWidthRef = useRef(spoilboardWidth);
  spoilboardWidthRef.current = spoilboardWidth;
  const spoilboardHeightRef = useRef(spoilboardHeight);
  spoilboardHeightRef.current = spoilboardHeight;
  // Kept in sync by the geometry-rebuild effect below, so the camera-fit and
  // live-position marker (both of which run far more often than the geometry
  // itself changes) can reuse the same offset without recomputing it.
  const zOffsetRef = useRef(0);

  const fitToSegments = () => {
    const s = sceneRef.current;
    const currentSegments = segmentsRef.current;
    if (!s || currentSegments.length === 0) return;

    const box = boundsOfSegments(currentSegments, zOffsetRef.current);
    box.expandByScalar(20); // 20mm breathing room on every side, so the part doesn't sit flush against the frame edge
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);

    s.controls.target.copy(center);
    s.camera.position.set(center.x - maxDim, center.y - maxDim, center.z + maxDim);
    s.camera.near = maxDim / 100;
    s.camera.far = maxDim * 100;
    s.camera.updateProjectionMatrix();
  };

  // Resizes the ground grid to match whichever of the two applies:
  // - A configured spoilboard size (Settings -> Working Area, per-axis,
  //   0 = not configured) is a fixed physical fact about the machine, so
  //   that axis always shows exactly [0, spoilboardSize] - an oversized job
  //   should look oversized against it, not silently grow the board.
  // - Otherwise, auto-fits to whatever's loaded, instead of a fixed 400mm
  //   plane a larger job just extends past. Deliberately NEVER recenters on
  //   the part - (0,0) is the machine's actual, fixed origin (confirmed:
  //   moving the grid's own center to the part's centroid, an earlier
  //   version of this fix, visually disconnected the grid's center cross
  //   from the real origin the AxesHelper marks - misleading, since a
  //   machine's origin doesn't move depending on what's loaded). Instead
  //   (0,0) stays fixed and each axis only extends outward on the side the
  //   part actually needs (see paddedAxisRange) - for the common
  //   all-positive-work-coordinates case, that puts machine (0,0) at a
  //   corner of the grid rather than its center, matching where the
  //   machine's actual home position sits.
  // Runs even with nothing loaded (no early return on empty segments) so a
  // configured spoilboard still shows up as the idle grid, and so this
  // reacts live to a spoilboard size change without needing a file reload.
  const rebuildGrid = () => {
    const s = sceneRef.current;
    if (!s) return;
    const currentSegments = segmentsRef.current;

    // Z doesn't matter here - the grid is a flat XY plane, always at world
    // Z0 regardless of aboveGrid (that toggle shifts the *path*, not the
    // table it's drawn relative to - see zOffsetFor's own comment).
    const box = boundsOfSegments(currentSegments, 0);
    const [minX, maxX] = gridRangeFor(spoilboardWidthRef.current, box.min.x, box.max.x, DEFAULT_GRID_SIZE);
    const [minY, maxY] = gridRangeFor(spoilboardHeightRef.current, box.min.y, box.max.y, DEFAULT_GRID_SIZE);

    s.scene.remove(s.grid);
    s.grid.geometry.dispose();
    (s.grid.material as THREE.Material).dispose();
    s.grid = makeGrid(minX, maxX, minY, maxY);
    s.scene.add(s.grid);

    s.scene.remove(s.axisRuler);
    disposeAxisRuler(s.axisRuler);
    s.axisRuler = makeAxisRuler(minX, maxX, minY, maxY, s.resolution);
    s.scene.add(s.axisRuler);
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Default grid is corner-anchored at (0,0), not centered - point the
    // idle camera at the grid's actual center (not world origin) so it
    // fills the frame nicely instead of being crammed into one corner.
    // Same relative offset as the old fixed (150,-250,200), just re-based
    // off this target instead of off world (0,0,0).
    const defaultTarget = new THREE.Vector3(DEFAULT_GRID_SIZE / 2, DEFAULT_GRID_SIZE / 2, 0);
    controls.target.copy(defaultTarget);
    camera.position.set(defaultTarget.x + 150, defaultTarget.y - 250, defaultTarget.z + 200);

    const resolution = new THREE.Vector2(width, height);
    // Corner-anchored by default too (0..DEFAULT_GRID_SIZE on both axes, not
    // -half..+half) - matches rebuildGrid so the origin doesn't jump from a
    // corner to the center the moment a file is loaded. Immediately
    // corrected to the real spoilboard-aware size by the rebuildGrid effect
    // below, which also runs on mount - this is just the first-paint shape.
    const grid = makeGrid(0, DEFAULT_GRID_SIZE, 0, DEFAULT_GRID_SIZE);
    scene.add(grid);
    const axisRuler = makeAxisRuler(0, DEFAULT_GRID_SIZE, 0, DEFAULT_GRID_SIZE, resolution);
    scene.add(axisRuler);

    // X/Y get the full numbered ruler above; Z keeps the original short
    // single-line indicator (a ruler reads naturally lying flat on the grid
    // plane the way X/Y do, not standing up out of it).
    const zLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 30)]),
      new THREE.LineBasicMaterial({ color: 0x4d8cff }),
    );
    scene.add(zLine);
    const zLabel = makeAxisLabel('Z', '#4d8cff');
    zLabel.position.set(0, 0, 34);
    scene.add(zLabel);

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

    sceneRef.current = { renderer, scene, camera, controls, grid, axisRuler, resolution, doneLines, pendingLines, rapidLines, marker };
    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return; // mid-layout, before flex sizing has settled
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      resolution.set(w, h);
      // LineMaterial bakes the viewport size into its line-thickness math, so
      // every LineSegments2 currently in the ruler needs its own material
      // told about the new size too - `resolution` above is only the shared
      // Vector2 passed to *future* makeAxisRuler() calls, it doesn't reach
      // into materials already built from it.
      for (const child of sceneRef.current?.axisRuler.children ?? []) {
        if (child instanceof LineSegments2) child.material.resolution.set(w, h);
      }
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

  // Rebuilds the grid on a new file, or on a spoilboard size change (live,
  // without needing a file reload) - unlike the camera, it has no reason to
  // change on the above/below toggle (that shifts the path in Z, not the
  // grid's XY footprint), so tearing it down there would just be wasted
  // work.
  useEffect(() => {
    rebuildGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, spoilboardWidth, spoilboardHeight]);

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
