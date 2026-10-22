/**
 * Layout utilities for positioning Miro items inside frames.
 * Miro positions child items relative to the parent frame's top-left corner,
 * and each position is the item's center, so every grid starts half an item
 * plus one gap in from the corner.
 */

const GAP = 20;
const MIN_FRAME_WIDTH = 400;
const MIN_FRAME_HEIGHT = 200;

export interface Position {
  x: number;
  y: number;
}

export function gridLayout(
  count: number,
  columns: number,
  itemWidth: number,
  itemHeight: number
): Position[] {
  const positions: Position[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    positions.push({
      x: GAP + itemWidth / 2 + col * (itemWidth + GAP),
      y: GAP + itemHeight / 2 + row * (itemHeight + GAP),
    });
  }
  return positions;
}

export function calculateFrameSize(
  itemCount: number,
  columns: number,
  itemWidth: number,
  itemHeight: number
): { width: number; height: number } {
  const usedColumns = Math.min(columns, Math.max(itemCount, 1));
  const rows = Math.max(Math.ceil(itemCount / columns), 1);
  return {
    width: Math.max(usedColumns * (itemWidth + GAP) + GAP, MIN_FRAME_WIDTH),
    height: Math.max(rows * (itemHeight + GAP) + GAP, MIN_FRAME_HEIGHT),
  };
}

export interface PlacedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Center of a new frame placed to the right of every existing frame,
 * top-aligned with the highest one, so repeated imports never overlap.
 */
export function nextFramePosition(
  existing: PlacedRect[],
  size: { width: number; height: number },
  spacing = 200
): Position {
  if (existing.length === 0) {
    return { x: size.width / 2, y: size.height / 2 };
  }
  const rightEdge = Math.max(...existing.map((r) => r.x + r.width / 2));
  const topEdge = Math.min(...existing.map((r) => r.y - r.height / 2));
  return {
    x: rightEdge + spacing + size.width / 2,
    y: topEdge + size.height / 2,
  };
}
