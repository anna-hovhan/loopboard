import type { JiraIssue } from '../jira';
import type { BoardItemSpec } from '../miro';
import type { FrameSpec } from './messages-to-stickies';
import { gridLayout, calculateFrameSize } from '../../utils/layout';
import { escapeHtml, truncate } from '../../utils/text';

const MAX_ISSUES = 100;
const COLUMNS = 4;
const CARD_WIDTH = 320;
const CARD_HEIGHT = 160;
const RECENT_COMMENTS = 3;

/**
 * One card per issue in a 4-column grid. The card title starts with the issue
 * key, which is also how the export recognises cards already in Jira.
 */
export function mapIssuesToCards(
  frameLabel: string,
  issues: JiraIssue[]
): { frame: FrameSpec; cards: BoardItemSpec[]; truncated: boolean } {
  const issuesToProcess = issues.slice(0, MAX_ISSUES);
  const truncated = issues.length > MAX_ISSUES;

  const positions = gridLayout(issuesToProcess.length, COLUMNS, CARD_WIDTH, CARD_HEIGHT);
  const frameSize = calculateFrameSize(issuesToProcess.length, COLUMNS, CARD_WIDTH, CARD_HEIGHT);

  const cards: BoardItemSpec[] = issuesToProcess.map((issue, i) => ({
    type: 'card' as const,
    title: escapeHtml(truncate(`${issue.key}: ${issue.summary}`, 250)),
    content: describeIssue(issue),
    position: positions[i],
  }));

  return {
    frame: { title: `🎫 Jira: ${frameLabel}`, ...frameSize },
    cards,
    truncated,
  };
}

function describeIssue(issue: JiraIssue): string {
  const facts = [
    `<strong>Status:</strong> ${escapeHtml(issue.status)}`,
    `<strong>Type:</strong> ${escapeHtml(issue.issueType)}`,
    issue.priority && `<strong>Priority:</strong> ${escapeHtml(issue.priority)}`,
  ].filter(Boolean).join(' · ');

  const parts = [`<p>${facts}</p>`];
  parts.push(`<p><strong>Assignee:</strong> ${escapeHtml(issue.assignee || 'Unassigned')}</p>`);

  if (issue.description) {
    parts.push(`<p>${escapeHtml(truncate(issue.description.replace(/\s+/g, ' '), 300))}</p>`);
  }

  const recent = issue.comments.slice(-RECENT_COMMENTS);
  if (recent.length > 0) {
    parts.push(`<p><strong>Latest comments (${issue.commentTotal}):</strong></p>`);
    for (const comment of recent) {
      const body = truncate(comment.body.replace(/\s+/g, ' '), 200);
      parts.push(`<p>@${escapeHtml(comment.author)}: ${escapeHtml(body)}</p>`);
    }
  }

  parts.push(`<p><a href="${escapeHtml(issue.url)}">${escapeHtml(issue.key)} in Jira</a></p>`);
  return parts.join('');
}
