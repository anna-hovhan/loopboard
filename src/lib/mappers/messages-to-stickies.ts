import type { SlackMessage } from '../slack';
import type { BoardItemSpec } from '../miro';
import { gridLayout, calculateFrameSize } from '../../utils/layout';
import { colorForKey } from '../../utils/color';
import { escapeHtml, toParagraphs, truncate } from '../../utils/text';

export interface FrameSpec {
  title: string;
  width: number;
  height: number;
}

const MAX_MESSAGES = 200;
const STICKY_SIZE = 200;
const COLUMNS = 5;

/**
 * One sticky per message, colored by author, in a 5-column grid in
 * chronological order. Thread replies follow their parent, marked with ↳.
 */
export function mapMessagesToStickies(
  channelName: string,
  dateRange: string,
  messages: SlackMessage[]
): { frame: FrameSpec; stickies: BoardItemSpec[]; truncated: boolean } {
  const messagesToProcess = messages.slice(0, MAX_MESSAGES);
  const truncated = messages.length > MAX_MESSAGES;

  const positions = gridLayout(messagesToProcess.length, COLUMNS, STICKY_SIZE, STICKY_SIZE);
  const frameSize = calculateFrameSize(messagesToProcess.length, COLUMNS, STICKY_SIZE, STICKY_SIZE);

  const stickies: BoardItemSpec[] = messagesToProcess.map((msg, i) => {
    const author = `${msg.isReply ? '↳ ' : ''}@${msg.username}`;
    return {
      type: 'sticky_note' as const,
      content: `<p><strong>${escapeHtml(author)}</strong></p>${toParagraphs(truncateText(msg.text))}`,
      color: colorForKey(msg.user),
      position: positions[i],
    };
  });

  return {
    frame: {
      title: `💬 #${channelName} (${dateRange})`,
      ...frameSize,
    },
    stickies,
    truncated,
  };
}

function truncateText(text: string): string {
  return truncate(text, 500);
}
