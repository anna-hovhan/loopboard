import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapFrameItemsToIssues } from '../src/lib/mappers/frame-to-issues';
import { mapMessagesToStickies } from '../src/lib/mappers/messages-to-stickies';
import { mapIssuesToCards } from '../src/lib/mappers/issues-to-cards';
import { mapSynthesisToItems } from '../src/lib/mappers/synthesis-to-items';
import { gridLayout, calculateFrameSize, nextFramePosition } from '../src/utils/layout';
import { slackToPlainText, stripHtml } from '../src/utils/text';
import { adfToText, textToAdf } from '../src/lib/adf';
import { parseBoardId } from '../src/lib/miro';
import { normalizeBaseUrl } from '../src/config';
import type { JiraIssue } from '../src/lib/jira';
import type { SlackMessage } from '../src/lib/slack';

test('frame items export in reading order, skipping items already in Jira', () => {
  const { drafts, skipped } = mapFrameItemsToIssues([
    { id: '3', type: 'card', data: { title: 'Second row', description: '<p>Details</p>' }, position: { x: 0, y: 200 } },
    { id: '2', type: 'sticky_note', data: { content: '<p><strong>@anna</strong></p><p>Login is slow</p><p>Since Monday</p>' }, position: { x: 300, y: 5 } },
    { id: '1', type: 'card', data: { title: 'PROJ-12: Imported', description: '' }, position: { x: 0, y: 0 } },
    { id: '4', type: 'sticky_note', data: { content: '<p><strong>PROJ-40</strong></p><p>Exported before</p>' }, position: { x: 0, y: 400 } },
    { id: '5', type: 'text', data: { content: 'A label' }, position: { x: 0, y: 500 } },
  ]);

  assert.deepEqual(drafts.map((d) => d.itemId), ['2', '3']);
  assert.equal(drafts[0].summary, 'Login is slow');
  assert.equal(drafts[0].description, 'Login is slow\nSince Monday\n\nRaised by @anna');
  assert.equal(drafts[1].summary, 'Second row');
  assert.equal(drafts[1].description, 'Details');
  assert.deepEqual(skipped.map((s) => [s.itemId, s.reason]), [
    ['1', 'already in Jira as PROJ-12'],
    ['4', 'already in Jira as PROJ-40'],
    ['5', 'type "text" not included'],
  ]);
});

test('frame export honours item_ids and appends the board link', () => {
  const { drafts } = mapFrameItemsToIssues(
    [
      { id: 'a', type: 'card', data: { title: 'Keep' } },
      { id: 'b', type: 'card', data: { title: 'Drop' } },
    ],
    { itemIds: ['a'], itemLink: (id) => `https://miro.test/${id}` }
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].description, 'Keep\n\nSource: Miro board item https://miro.test/a');
});

test('summaries are single-line and capped', () => {
  const { drafts } = mapFrameItemsToIssues([
    { id: 'x', type: 'card', data: { title: `${'word '.repeat(60)}`, description: '' } },
  ]);
  assert.ok(drafts[0].summary.length <= 120);
  assert.ok(!drafts[0].summary.includes('\n'));
});

test('slack messages become escaped stickies colored by author', () => {
  const messages: SlackMessage[] = [
    { user: 'U1', username: 'anna', text: 'a < b & c', ts: '1', isReply: false, replyCount: 1 },
    { user: 'U2', username: 'ben', text: 'reply', ts: '2', isReply: true, replyCount: 0 },
  ];
  const mapped = mapMessagesToStickies('support', 'last 7 days', messages);
  assert.equal(mapped.frame.title, '💬 #support (last 7 days)');
  assert.equal(mapped.stickies[0].content, '<p><strong>@anna</strong></p><p>a &lt; b &amp; c</p>');
  assert.match(mapped.stickies[1].content, /↳ @ben/);
  assert.equal(mapped.truncated, false);

  const roundTrip = mapFrameItemsToIssues([{ id: 's', type: 'sticky_note', data: { content: mapped.stickies[0].content } }]);
  assert.equal(roundTrip.drafts[0].summary, 'a < b & c');
});

test('jira issues become cards whose title carries the key', () => {
  const issue: JiraIssue = {
    key: 'PROJ-7', url: 'https://x.atlassian.net/browse/PROJ-7', summary: 'Fix <login>',
    issueType: 'Bug', status: 'To Do', priority: 'High', assignee: undefined, reporter: 'Ben',
    labels: [], created: '', updated: '', description: 'Steps',
    comments: [{ author: 'Ann', created: '', body: 'Seen it too' }], commentTotal: 1,
  };
  const mapped = mapIssuesToCards('project = PROJ', [issue]);
  assert.equal(mapped.cards[0].title, 'PROJ-7: Fix &lt;login&gt;');
  assert.match(mapped.cards[0].content, /Unassigned/);
  assert.match(mapped.cards[0].content, /@Ann: Seen it too/);

  const back = mapFrameItemsToIssues([{ id: 'c', type: 'card', data: { title: mapped.cards[0].title } }]);
  assert.equal(back.drafts.length, 0);
});

test('synthesis items share one grid', () => {
  const mapped = mapSynthesisToItems('Themes', [
    { kind: 'card', title: 'Ticket', body: 'line 1\nline 2' },
    { kind: 'sticky', title: 'Theme' },
  ]);
  assert.equal(mapped.items[0].content, '<p>line 1</p><p>line 2</p>');
  assert.equal(mapped.items[1].color, 'light_green');
  assert.equal(mapped.items[0].position.y, mapped.items[1].position.y);
});

test('grid positions sit inside the frame measured from its top-left corner', () => {
  const positions = gridLayout(7, 5, 200, 200);
  const frame = calculateFrameSize(7, 5, 200, 200);
  for (const p of positions) {
    assert.ok(p.x - 100 >= 0 && p.x + 100 <= frame.width);
    assert.ok(p.y - 100 >= 0 && p.y + 100 <= frame.height);
  }
});

test('new frames go to the right of existing ones', () => {
  const pos = nextFramePosition([{ x: 0, y: 0, width: 400, height: 200 }], { width: 600, height: 400 });
  assert.deepEqual(pos, { x: 200 + 200 + 300, y: -100 + 200 });
  assert.deepEqual(nextFramePosition([], { width: 600, height: 400 }), { x: 300, y: 200 });
});

test('slack mrkdwn becomes readable text', () => {
  const names = new Map([['U1', 'anna']]);
  assert.equal(
    slackToPlainText('<@U1> see <https://x.io|the doc> in <#C1|eng> &amp; <!here>', names),
    '@anna see the doc (https://x.io) in #eng & @here'
  );
});

test('stripHtml keeps line structure', () => {
  assert.equal(stripHtml('<p><strong>A</strong></p><p>b &amp; c</p><ul><li>d</li></ul>'), 'A\nb & c\n• d');
});

test('ADF converts both ways', () => {
  const adf = textToAdf('First line\nsecond\n\nNew paragraph');
  assert.equal(adf.content.length, 2);
  assert.equal(adfToText(adf), 'First line\nsecond\nNew paragraph');
  assert.equal(adfToText({
    type: 'doc',
    content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }] }],
  }), '• item');
});

test('board IDs come out of links', () => {
  assert.equal(parseBoardId('https://miro.com/app/board/uXjVK1a2b3c=/?moveToWidget=345'), 'uXjVK1a2b3c=');
  assert.equal(parseBoardId('uXjVK1a2b3c='), 'uXjVK1a2b3c=');
  assert.equal(normalizeBaseUrl('acme.atlassian.net/'), 'https://acme.atlassian.net');
});
