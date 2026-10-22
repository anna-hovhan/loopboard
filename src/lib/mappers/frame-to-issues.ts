import type { MiroBoardItem } from '../miro';
import { stripHtml, truncate } from '../../utils/text';

/**
 * Converts Miro frame items into Jira issue drafts, read top to bottom then
 * left to right.
 *
 * Cards: title -> summary, description -> description
 * Sticky notes, text and shapes: first line -> summary, full text -> description
 *
 * Items whose text starts with an issue key (e.g. "PROJ-12: ...") are already
 * in Jira, either imported from it or exported earlier, and are skipped.
 * A leading "@name" line, as written by the Slack import, becomes attribution.
 */

export type ExportableType = 'card' | 'sticky_note' | 'text' | 'shape';

export interface IssueDraft {
  itemId: string;
  itemType: string;
  summary: string;
  description: string;
}

export interface SkippedItem {
  itemId: string;
  itemType: string;
  reason: string;
}

export interface FrameToIssuesOptions {
  includeTypes?: ExportableType[];
  itemIds?: string[];
  itemLink?: (itemId: string) => string;
}

const ISSUE_KEY = /^([A-Z][A-Z0-9_]+-\d+)\b/;
const AUTHOR_LINE = /^(?:↳\s*)?@[^\n]{1,80}$/;
const SUMMARY_MAX = 120;
const ROW_TOLERANCE = 20;

export function mapFrameItemsToIssues(
  items: MiroBoardItem[],
  options: FrameToIssuesOptions = {}
): { drafts: IssueDraft[]; skipped: SkippedItem[] } {
  const includeTypes = new Set<string>(options.includeTypes || ['card', 'sticky_note']);
  const onlyIds = options.itemIds && options.itemIds.length > 0 ? new Set(options.itemIds) : null;
  const drafts: IssueDraft[] = [];
  const skipped: SkippedItem[] = [];

  for (const item of sortByReadingOrder(items)) {
    if (onlyIds && !onlyIds.has(item.id)) continue;
    const skip = (reason: string) => skipped.push({ itemId: item.id, itemType: item.type, reason });

    if (!includeTypes.has(item.type)) {
      skip(`type "${item.type}" not included`);
      continue;
    }

    const draft = item.type === 'card' ? draftFromCard(item) : draftFromText(item);
    if (!draft) {
      skip('no text');
      continue;
    }

    const existingKey = draft.summary.match(ISSUE_KEY)?.[1];
    if (existingKey) {
      skip(`already in Jira as ${existingKey}`);
      continue;
    }

    const source = options.itemLink ? `\n\nSource: Miro board item ${options.itemLink(item.id)}` : '';
    drafts.push({
      itemId: item.id,
      itemType: item.type,
      summary: draft.summary,
      description: draft.description + source,
    });
  }

  return { drafts, skipped };
}

function sortByReadingOrder(items: MiroBoardItem[]): MiroBoardItem[] {
  return [...items].sort((a, b) => {
    const ay = a.position?.y ?? 0;
    const by = b.position?.y ?? 0;
    if (Math.abs(ay - by) < ROW_TOLERANCE) {
      return (a.position?.x ?? 0) - (b.position?.x ?? 0);
    }
    return ay - by;
  });
}

function draftFromCard(item: MiroBoardItem): { summary: string; description: string } | null {
  const title = stripHtml(item.data?.title || '');
  const description = stripHtml(item.data?.description || '');
  const summary = singleLine(title) || firstLine(description);
  if (!summary) return null;
  return { summary: truncate(summary, SUMMARY_MAX), description: description || title };
}

function draftFromText(item: MiroBoardItem): { summary: string; description: string } | null {
  const text = stripHtml(item.data?.content || '');
  if (!text) return null;

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  let author: string | undefined;
  if (lines.length > 1 && AUTHOR_LINE.test(lines[0]) && !ISSUE_KEY.test(lines[0])) {
    author = lines.shift()!.replace(/^↳\s*/, '');
  }

  const summary = truncate(singleLine(lines[0] || ''), SUMMARY_MAX);
  if (!summary) return null;

  const body = lines.join('\n');
  const attribution = author ? `\n\nRaised by ${author}` : '';
  return { summary, description: body + attribution };
}

function firstLine(text: string): string {
  return singleLine(text.split('\n').find((line) => line.trim()) || '');
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
