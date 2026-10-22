import type { BoardItemSpec } from '../miro';
import type { FrameSpec } from './messages-to-stickies';
import { gridLayout, calculateFrameSize } from '../../utils/layout';
import { colorForSource } from '../../utils/color';
import { escapeHtml, toParagraphs, truncate } from '../../utils/text';

export interface SynthesisItem {
  kind: 'card' | 'sticky';
  title: string;
  body?: string;
  color?: string;
}

const MAX_ITEMS = 100;
const CARD_WIDTH = 320;
const CARD_HEIGHT = 160;
const STICKY_SIZE = 200;

/**
 * Items Claude has written (themes, decisions, action items) laid out in one
 * grid. Cards and stickies share a cell size so mixed frames stay aligned.
 */
export function mapSynthesisToItems(
  frameTitle: string,
  items: SynthesisItem[],
  columns = 4
): { frame: FrameSpec; items: BoardItemSpec[]; truncated: boolean } {
  const itemsToProcess = items.slice(0, MAX_ITEMS);
  const truncated = items.length > MAX_ITEMS;
  const hasCards = itemsToProcess.some((item) => item.kind === 'card');
  const cellWidth = hasCards ? CARD_WIDTH : STICKY_SIZE;
  const cellHeight = hasCards ? Math.max(CARD_HEIGHT, STICKY_SIZE) : STICKY_SIZE;

  const positions = gridLayout(itemsToProcess.length, columns, cellWidth, cellHeight);
  const frameSize = calculateFrameSize(itemsToProcess.length, columns, cellWidth, cellHeight);

  const boardItems: BoardItemSpec[] = itemsToProcess.map((item, i) => {
    if (item.kind === 'card') {
      return {
        type: 'card' as const,
        title: escapeHtml(truncate(item.title, 250)),
        content: toParagraphs(truncate(item.body || '', 2000)),
        position: positions[i],
      };
    }
    const body = item.body ? toParagraphs(truncate(item.body, 400)) : '';
    return {
      type: 'sticky_note' as const,
      content: `<p><strong>${escapeHtml(truncate(item.title, 120))}</strong></p>${body}`,
      color: item.color || colorForSource('synthesis'),
      position: positions[i],
    };
  });

  return { frame: { title: frameTitle, ...frameSize }, items: boardItems, truncated };
}
