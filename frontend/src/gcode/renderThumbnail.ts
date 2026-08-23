import type { Segment } from './parseToolpath';

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

/** Isometric X/Y for a 3D point - Z-up, same convention as the 3D toolpath view. */
function isoProject(x: number, y: number, z: number): [number, number] {
  return [(x - y) * COS30, (x + y) * SIN30 + z];
}

/**
 * Isometric snapshot of a toolpath rendered to a small offscreen canvas and
 * returned as a PNG data URL - used as the File Manager's thumbnail. A flat
 * top-down (X/Y only) projection hides pockets, steps, and anything else
 * that only shows up in Z, so this projects all three axes instead -
 * recognizable at a glance the same way the main 3D view is, without the
 * cost of spinning up a Three.js scene per file.
 */
export function renderThumbnail(segments: Segment[], size = 160): string | null {
  if (segments.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const projected = segments.map(
    (seg) => [isoProject(seg.x1, seg.y1, seg.z1), isoProject(seg.x2, seg.y2, seg.z2)] as const,
  );

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [[x1, y1], [x2, y2]] of projected) {
    minX = Math.min(minX, x1, x2);
    maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxY = Math.max(maxY, y1, y2);
  }

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const padding = size * 0.12;
  const scale = Math.min((size - padding * 2) / spanX, (size - padding * 2) / spanY);
  const offsetX = (size - spanX * scale) / 2;
  const offsetY = (size - spanY * scale) / 2;

  // Higher Z/further "up" in the isometric projection should land nearer
  // the top of the image, but canvas Y grows downward - flip it.
  const toPx = (x: number, y: number): [number, number] => [
    offsetX + (x - minX) * scale,
    size - (offsetY + (y - minY) * scale),
  ];

  ctx.fillStyle = '#14161a';
  ctx.fillRect(0, 0, size, size);

  ctx.lineWidth = 1;

  // Two passes so cut moves always draw on top of (and stay visually
  // distinct from) rapids, regardless of which order they appear in.
  ctx.strokeStyle = 'rgba(154,160,170,0.35)';
  segments.forEach((seg, i) => {
    if (!seg.rapid) return;
    const [[ix1, iy1], [ix2, iy2]] = projected[i];
    const [x1, y1] = toPx(ix1, iy1);
    const [x2, y2] = toPx(ix2, iy2);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
  ctx.strokeStyle = '#3b82f6';
  segments.forEach((seg, i) => {
    if (seg.rapid) return;
    const [[ix1, iy1], [ix2, iy2]] = projected[i];
    const [x1, y1] = toPx(ix1, iy1);
    const [x2, y2] = toPx(ix2, iy2);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });

  return canvas.toDataURL('image/png');
}
