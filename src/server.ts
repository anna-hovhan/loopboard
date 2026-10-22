import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ConfigError, configuredServices, jiraConfig, miroToken, slackToken } from './config';
import * as slack from './lib/slack';
import * as jira from './lib/jira';
import * as miro from './lib/miro';
import { mapMessagesToStickies } from './lib/mappers/messages-to-stickies';
import { mapIssuesToCards } from './lib/mappers/issues-to-cards';
import { mapSynthesisToItems } from './lib/mappers/synthesis-to-items';
import { mapFrameItemsToIssues } from './lib/mappers/frame-to-issues';
import { stripHtml } from './utils/text';
import { MIRO_STICKY_COLORS } from './utils/color';

const server = new McpServer({ name: 'loopboard', version: '0.1.0' });

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

async function respond(work: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const result = await work();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const prefix = err instanceof ConfigError ? 'Not configured' : 'Error';
    return { content: [{ type: 'text', text: `${prefix}: ${message}` }], isError: true };
  }
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

const boardParam = z.string().describe('Miro board ID or board URL (https://miro.com/app/board/...)');
const daysBackParam = z.number().int().min(1).max(365).default(7)
  .describe('How many days of history to read, counting back from now');

function slackWindow(daysBack: number) {
  const now = Math.floor(Date.now() / 1000);
  return { oldestTs: String(now - daysBack * 86400), latestTs: String(now) };
}

server.registerTool('loopboard_status', {
  title: 'Check connections',
  description:
    'Report which of Slack, Jira and Miro are configured and whether each credential works. ' +
    'Call this first when a loopboard tool reports a configuration or auth error.',
  inputSchema: {},
  annotations: READ_ONLY,
}, () => respond(async () => {
  const configured = configuredServices();
  const check = async (enabled: boolean, probe: () => Promise<unknown>) => {
    if (!enabled) return { configured: false };
    try {
      return { configured: true, ok: true, account: await probe() };
    } catch (err) {
      return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  return {
    slack: await check(configured.slack, () => slack.authTest(slackToken())),
    jira: await check(configured.jira, () => jira.getMyself(jiraConfig())),
    miro: await check(configured.miro, async () => {
      const boards = await miro.listBoards(miroToken());
      return { boardsVisible: boards.length };
    }),
  };
}));

// ---------------------------------------------------------------- Slack

server.registerTool('slack_list_channels', {
  title: 'List Slack channels',
  description: 'List Slack channels the token can see, optionally filtered by a name fragment.',
  inputSchema: {
    name_contains: z.string().optional().describe('Only channels whose name contains this text'),
    include_private: z.boolean().default(false)
      .describe('Include private channels (token needs groups:read)'),
  },
  annotations: READ_ONLY,
}, ({ name_contains, include_private }) => respond(async () => {
  const channels = await slack.listChannels(slackToken(), include_private);
  const needle = name_contains?.toLowerCase();
  return needle ? channels.filter((ch) => ch.name.toLowerCase().includes(needle)) : channels;
}));

server.registerTool('slack_get_messages', {
  title: 'Read Slack messages',
  description:
    'Read messages from a Slack channel for a time window, oldest first, with author names resolved. ' +
    'Use this to read and synthesise a discussion; use slack_import_to_miro to put the raw messages on a board.',
  inputSchema: {
    channel: z.string().describe('Channel ID, #name, or a Slack channel link'),
    days_back: daysBackParam,
    include_threads: z.boolean().default(true).describe('Also fetch thread replies'),
    max_messages: z.number().int().min(1).max(1000).default(300)
      .describe('Most recent top-level messages to return'),
  },
  annotations: READ_ONLY,
}, ({ channel, days_back, include_threads, max_messages }) => respond(async () => {
  const token = slackToken();
  const resolved = await slack.resolveChannel(token, channel);
  const { messages, truncated } = await slack.getChannelMessages(token, resolved.id, {
    ...slackWindow(days_back),
    includeThreads: include_threads,
    maxMessages: max_messages,
  });
  return {
    channel: resolved,
    window: `last ${days_back} days`,
    count: messages.length,
    truncated,
    messages: messages.map((m) => ({
      at: slack.formatSlackDate(m.ts),
      author: m.username,
      reply: m.isReply || undefined,
      replies: m.replyCount || undefined,
      text: m.text,
    })),
  };
}));

server.registerTool('slack_import_to_miro', {
  title: 'Import Slack channel to Miro',
  description:
    'Create a frame on a Miro board holding one sticky note per Slack message (colored by author, ' +
    '5-column grid, chronological, max 200). The frame is placed to the right of existing frames.',
  inputSchema: {
    board: boardParam,
    channel: z.string().describe('Channel ID, #name, or a Slack channel link'),
    days_back: daysBackParam,
    include_threads: z.boolean().default(false)
      .describe('Add thread replies as stickies after their parent message'),
  },
  annotations: WRITES,
}, ({ board, channel, days_back, include_threads }) => respond(async () => {
  const token = slackToken();
  const miroAccess = miroToken();
  const boardId = miro.parseBoardId(board);
  const resolved = await slack.resolveChannel(token, channel);
  const { messages } = await slack.getChannelMessages(token, resolved.id, {
    ...slackWindow(days_back),
    includeThreads: include_threads,
    maxMessages: 200,
  });
  if (messages.length === 0) {
    return { channel: resolved.name, messages: 0, note: 'No messages in that window; nothing was created.' };
  }

  const mapped = mapMessagesToStickies(resolved.name, `last ${days_back} days`, messages);
  const frame = await miro.createFrameInFreeSpace(boardId, miroAccess, mapped.frame.title, mapped.frame);
  await miro.createItemsInFrame(boardId, miroAccess, frame.id, mapped.stickies);

  return {
    channel: resolved.name,
    messages: messages.length,
    stickies: mapped.stickies.length,
    truncated: mapped.truncated,
    frameId: frame.id,
    frameTitle: mapped.frame.title,
    frameUrl: miro.itemUrl(boardId, frame.id),
  };
}));

// ---------------------------------------------------------------- Jira

server.registerTool('jira_list_projects', {
  title: 'List Jira projects',
  description: 'List Jira projects with their keys and the issue types each one accepts.',
  inputSchema: {
    query: z.string().optional().describe('Filter by project name or key'),
  },
  annotations: READ_ONLY,
}, ({ query }) => respond(() => jira.listProjects(jiraConfig(), query)));

server.registerTool('jira_search_issues', {
  title: 'Search Jira issues',
  description:
    'Run a JQL search and return each issue with status, people, description and comments as plain text. ' +
    'Use this to read and synthesise the discussion on issues; use jira_import_to_miro to put them on a board.',
  inputSchema: {
    jql: z.string().describe('JQL, e.g. project = PROJ AND updated >= -7d ORDER BY updated DESC'),
    max_results: z.number().int().min(1).max(200).default(50),
  },
  annotations: READ_ONLY,
}, ({ jql, max_results }) => respond(async () => {
  const { issues, truncated } = await jira.searchIssues(jiraConfig(), jql, max_results);
  return { jql, count: issues.length, truncated, issues };
}));

server.registerTool('jira_import_to_miro', {
  title: 'Import Jira issues to Miro',
  description:
    'Create a frame on a Miro board holding one card per Jira issue from a JQL search (4-column grid, ' +
    'max 100). Card titles start with the issue key, so jira_export_frame never re-creates them.',
  inputSchema: {
    board: boardParam,
    jql: z.string().describe('JQL selecting the issues to import'),
    frame_label: z.string().optional().describe('Frame name after "🎫 Jira: " (defaults to the JQL)'),
    max_results: z.number().int().min(1).max(100).default(50),
  },
  annotations: WRITES,
}, ({ board, jql, frame_label, max_results }) => respond(async () => {
  const config = jiraConfig();
  const miroAccess = miroToken();
  const boardId = miro.parseBoardId(board);
  const { issues } = await jira.searchIssues(config, jql, max_results);
  if (issues.length === 0) {
    return { jql, issues: 0, note: 'The search returned no issues; nothing was created.' };
  }

  const mapped = mapIssuesToCards(frame_label || jql, issues);
  const frame = await miro.createFrameInFreeSpace(boardId, miroAccess, mapped.frame.title, mapped.frame);
  await miro.createItemsInFrame(boardId, miroAccess, frame.id, mapped.cards);

  return {
    jql,
    issues: issues.length,
    cards: mapped.cards.length,
    truncated: mapped.truncated,
    frameId: frame.id,
    frameTitle: mapped.frame.title,
    frameUrl: miro.itemUrl(boardId, frame.id),
  };
}));

// ---------------------------------------------------------------- Miro

server.registerTool('miro_list_boards', {
  title: 'List Miro boards',
  description: 'List Miro boards the token can access, most recently modified first.',
  inputSchema: {
    query: z.string().optional().describe('Filter boards by name'),
  },
  annotations: READ_ONLY,
}, ({ query }) => respond(() => miro.listBoards(miroToken(), query)));

server.registerTool('miro_list_frames', {
  title: 'List frames on a Miro board',
  description: 'List the frames on a Miro board with their IDs and titles.',
  inputSchema: { board: boardParam },
  annotations: READ_ONLY,
}, ({ board }) => respond(async () => {
  const boardId = miro.parseBoardId(board);
  const frames = await miro.listFrames(boardId, miroToken());
  return frames.map((f) => ({ id: f.id, title: f.data.title, url: miro.itemUrl(boardId, f.id) }));
}));

server.registerTool('miro_get_frame_items', {
  title: 'Read a Miro frame',
  description:
    'Read every item inside a frame as plain text, top to bottom then left to right. ' +
    'Use this to see what the team wrote on the board before synthesising or exporting.',
  inputSchema: {
    board: boardParam,
    frame: z.string().describe('Frame ID, frame title, or a link containing moveToWidget=<id>'),
  },
  annotations: READ_ONLY,
}, ({ board, frame }) => respond(async () => {
  const token = miroToken();
  const boardId = miro.parseBoardId(board);
  const resolved = await miro.resolveFrame(boardId, token, frame);
  const items = await miro.getFrameItems(boardId, token, resolved.id);
  return {
    frame: { id: resolved.id, title: resolved.data.title },
    count: items.length,
    items: items
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0))
      .map((item) => ({
        id: item.id,
        type: item.type,
        title: item.data?.title ? stripHtml(item.data.title) : undefined,
        text: stripHtml(item.data?.content || item.data?.description || ''),
        color: item.style?.fillColor,
      })),
  };
}));

server.registerTool('miro_create_frame', {
  title: 'Create a Miro frame from a synthesis',
  description:
    'Create a frame of cards and/or sticky notes from content you have written, such as themes, ' +
    'decisions, open questions or proposed tickets. Cards are the best fit for proposed Jira tickets: ' +
    'title becomes the issue summary and body the description when exported with jira_export_frame.',
  inputSchema: {
    board: boardParam,
    title: z.string().describe('Frame title, e.g. "🧭 Themes: #support, last 7 days"'),
    items: z.array(z.object({
      kind: z.enum(['card', 'sticky']),
      title: z.string().min(1).describe('Card title, or the bold first line of a sticky'),
      body: z.string().optional().describe('Card description or sticky body; newlines are kept'),
      color: z.enum(MIRO_STICKY_COLORS).optional().describe('Sticky color (stickies only)'),
    })).min(1).max(100),
    columns: z.number().int().min(1).max(8).default(4),
  },
  annotations: WRITES,
}, ({ board, title, items, columns }) => respond(async () => {
  const token = miroToken();
  const boardId = miro.parseBoardId(board);
  const mapped = mapSynthesisToItems(title, items, columns);
  const frame = await miro.createFrameInFreeSpace(boardId, token, mapped.frame.title, mapped.frame);
  await miro.createItemsInFrame(boardId, token, frame.id, mapped.items);
  return {
    items: mapped.items.length,
    frameId: frame.id,
    frameTitle: title,
    frameUrl: miro.itemUrl(boardId, frame.id),
  };
}));

// ---------------------------------------------------------------- Export

server.registerTool('jira_export_frame', {
  title: 'Export a Miro frame to Jira',
  description:
    'Turn the items in a Miro frame into Jira issues: cards (title -> summary, description -> description) ' +
    'and sticky notes (first line -> summary). Items already carrying an issue key are skipped. ' +
    'dry_run defaults to true and only returns the drafts; show them to the user and get confirmation ' +
    'before calling again with dry_run=false. With mark_on_board, each exported item gets its new issue ' +
    'key written on it, so exporting the same frame again does not duplicate issues.',
  inputSchema: {
    board: boardParam,
    frame: z.string().describe('Frame ID, frame title, or a link containing moveToWidget=<id>'),
    project_key: z.string().describe('Jira project key, e.g. PROJ'),
    issue_type: z.string().default('Task').describe('Issue type name valid in that project'),
    labels: z.array(z.string()).optional().describe('Labels to add to every created issue'),
    include_types: z.array(z.enum(['card', 'sticky_note', 'text', 'shape']))
      .default(['card', 'sticky_note']).describe('Which board item types become issues'),
    item_ids: z.array(z.string()).optional()
      .describe('Export only these item IDs (from the dry run); omit to export every eligible item'),
    dry_run: z.boolean().default(true),
    mark_on_board: z.boolean().default(true),
  },
  annotations: WRITES,
}, (args) => respond(async () => {
  const token = miroToken();
  const config = jiraConfig();
  const boardId = miro.parseBoardId(args.board);
  const frame = await miro.resolveFrame(boardId, token, args.frame);
  const items = await miro.getFrameItems(boardId, token, frame.id);
  const { drafts, skipped } = mapFrameItemsToIssues(items, {
    includeTypes: args.include_types,
    itemIds: args.item_ids,
    itemLink: (itemId) => miro.itemUrl(boardId, itemId),
  });

  const target = { project: args.project_key, issueType: args.issue_type, labels: args.labels || [] };
  if (args.dry_run) {
    return {
      dryRun: true,
      frame: frame.data.title,
      target,
      wouldCreate: drafts,
      skipped,
      next: 'Confirm with the user, then call again with dry_run=false (optionally with item_ids).',
    };
  }

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const created: Array<{ key: string; url: string; summary: string; itemId: string; markedOnBoard?: boolean }> = [];
  const failed: Array<{ itemId: string; summary: string; error: string }> = [];

  for (const draft of drafts) {
    try {
      const issue = await jira.createIssue(config, {
        projectKey: args.project_key,
        issueType: args.issue_type,
        summary: draft.summary,
        description: draft.description,
        labels: args.labels,
      });
      const entry: (typeof created)[number] = { ...issue, summary: draft.summary, itemId: draft.itemId };
      if (args.mark_on_board) {
        entry.markedOnBoard = await markItem(boardId, token, itemsById.get(draft.itemId), issue.key);
      }
      created.push(entry);
    } catch (err) {
      failed.push({
        itemId: draft.itemId,
        summary: draft.summary,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { dryRun: false, frame: frame.data.title, target, created, failed, skipped };
}));

async function markItem(
  boardId: string,
  token: string,
  item: miro.MiroBoardItem | undefined,
  issueKey: string
): Promise<boolean> {
  if (!item) return false;
  try {
    if (item.type === 'card') {
      await miro.updateCardTitle(boardId, token, item.id, `${issueKey}: ${item.data?.title || ''}`);
      return true;
    }
    await miro.updateItemContent(
      boardId, token, item.type, item.id, `<p><strong>${issueKey}</strong></p>${item.data?.content || ''}`
    );
    return true;
  } catch {
    // The issue exists either way; the result reports that the board was not marked.
  }
  return false;
}

await server.connect(new StdioServerTransport());
