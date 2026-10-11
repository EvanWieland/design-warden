import type { Box } from '@design-warden/core';

export interface RegionOptions {
  cellSize: number;
  minCellPixels: number;
  minRegionPixels: number;
}

/**
 * Groups changed pixels into rectangles: mark grid cells with enough changed pixels,
 * then take 8-connected components of marked cells. Isolated anti-aliasing noise never
 * fills a cell, so it disappears without raising the color threshold (which would hide
 * real token changes). Calibrated in docs/research/visual-regression.md.
 */
export function changedRegions(mask: Uint8Array, width: number, height: number, o: RegionOptions): { regions: Box[]; pixels: number } {
  const cols = Math.ceil(width / o.cellSize);
  const rows = Math.ceil(height / o.cellSize);
  const counts = new Uint32Array(cols * rows);
  let pixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      pixels++;
      counts[Math.floor(y / o.cellSize) * cols + Math.floor(x / o.cellSize)]!++;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const regions: Box[] = [];
  for (let start = 0; start < counts.length; start++) {
    if (seen[start] || counts[start]! < o.minCellPixels) continue;
    // Flood fill over hot cells.
    let [minC, minR, maxC, maxR, total] = [Infinity, Infinity, -1, -1, 0];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const [c, r] = [i % cols, Math.floor(i / cols)];
      [minC, minR, maxC, maxR] = [Math.min(minC, c), Math.min(minR, r), Math.max(maxC, c), Math.max(maxR, r)];
      total += counts[i]!;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const [nc, nr] = [c + dc, r + dr];
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const n = nr * cols + nc;
          if (!seen[n] && counts[n]! >= o.minCellPixels) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    if (total < o.minRegionPixels) continue;
    const x = minC * o.cellSize;
    const y = minR * o.cellSize;
    regions.push({ x, y, width: Math.min(width, (maxC + 1) * o.cellSize) - x, height: Math.min(height, (maxR + 1) * o.cellSize) - y });
  }
  return { regions: regions.sort((a, b) => a.y - b.y || a.x - b.x), pixels };
}
