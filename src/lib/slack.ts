import { fetchWithRetry } from './http';
import { slackToPlainText, mentionedUserIds } from '../utils/text';

const SLACK_API_BASE = 'https://slack.com/api';

interface SlackResponse {
  ok: boolean;
  error?: string;
  needed?: string;
  response_metadata?: { next_cursor?: string };
}

async function slackApi<T extends SlackResponse>(
  method: string,
  token: string,
  params: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }

  const res = await fetchWithRetry(`${SLACK_API_BASE}/${method}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Slack ${method} failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as T;
  if (!data.ok) {
    const scopeHint = data.needed ? ` (token needs scope: ${data.needed})` : '';
    throw new Error(`Slack ${method} failed: ${data.error}${scopeHint}`);
  }
  return data;
}

export async function authTest(token: string) {
  const data = await slackApi<SlackResponse & { team?: string; user?: string; url?: string }>(
    'auth.test', token, {}
  );
  return { team: data.team, user: data.user, url: data.url };
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  memberCount?: number;
  topic?: string;
}

interface RawChannel {
  id: string;
  name: string;
  is_private?: boolean;
  num_members?: number;
  topic?: { value?: string };
}

export async function listChannels(token: string, includePrivate = false): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const result = await slackApi<SlackResponse & { channels?: RawChannel[] }>(
      'conversations.list', token, {
        types: includePrivate ? 'public_channel,private_channel' : 'public_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      }
    );
    for (const ch of result.channels || []) {
      channels.push({
        id: ch.id,
        name: ch.name,
        isPrivate: !!ch.is_private,
        memberCount: ch.num_members,
        topic: ch.topic?.value || undefined,
      });
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor && channels.length < 2000);

  return channels;
}

/**
 * Accepts a channel ID, a channel name with or without '#', or a Slack
 * archive link such as https://team.slack.com/archives/C0123ABCD.
 */
export async function resolveChannel(
  token: string,
  channel: string
): Promise<{ id: string; name: string }> {
  const trimmed = channel.trim();
  const linkMatch = trimmed.match(/\/archives\/([A-Z0-9]+)/);
  const candidateId = linkMatch ? linkMatch[1] : trimmed;

  if (/^[CG][A-Z0-9]{6,}$/.test(candidateId)) {
    const info = await slackApi<SlackResponse & { channel?: { id: string; name: string } }>(
      'conversations.info', token, { channel: candidateId }
    );
    return { id: candidateId, name: info.channel?.name || candidateId };
  }

  const name = trimmed.replace(/^#/, '').toLowerCase();
  const channels = await listChannels(token, true).catch(() => listChannels(token, false));
  const match = channels.find((ch) => ch.name.toLowerCase() === name);
  if (!match) {
    throw new Error(`No Slack channel named #${name} is visible to this token.`);
  }
  return { id: match.id, name: match.name };
}

export interface SlackMessage {
  user: string;
  username: string;
  text: string;
  ts: string;
  isReply: boolean;
  replyCount: number;
}

interface RawMessage {
  user?: string;
  text?: string;
  ts?: string;
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
}

export interface MessageQuery {
  oldestTs: string;
  latestTs: string;
  includeThreads?: boolean;
  maxMessages?: number;
}

export async function getChannelMessages(
  token: string,
  channelId: string,
  query: MessageQuery
): Promise<{ messages: SlackMessage[]; truncated: boolean }> {
  const maxMessages = query.maxMessages ?? 500;
  const rawMessages: RawMessage[] = [];
  let cursor: string | undefined;
  let truncated = false;

  do {
    const result = await slackApi<SlackResponse & { messages?: RawMessage[]; has_more?: boolean }>(
      'conversations.history', token, {
        channel: channelId,
        oldest: query.oldestTs,
        latest: query.latestTs,
        limit: 200,
        cursor,
      }
    );
    rawMessages.push(...(result.messages || []).filter((msg) => !msg.subtype));
    cursor = result.response_metadata?.next_cursor || undefined;
    if (rawMessages.length >= maxMessages) {
      truncated = !!cursor || rawMessages.length > maxMessages;
      break;
    }
  } while (cursor);

  // History pages arrive newest first; keep the most recent maxMessages, oldest first.
  const topLevel = rawMessages.slice(0, maxMessages).reverse();

  const withReplies: Array<RawMessage & { isReply: boolean }> = [];
  for (const msg of topLevel) {
    withReplies.push({ ...msg, isReply: false });
    if (query.includeThreads && msg.reply_count && msg.ts) {
      const replies = await getThreadReplies(token, channelId, msg.ts);
      withReplies.push(...replies.map((reply) => ({ ...reply, isReply: true })));
    }
  }

  const userNames = await resolveUserNames(token, withReplies);

  const messages = withReplies.map((msg) => {
    const userId = msg.user || 'unknown';
    return {
      user: userId,
      username: userNames.get(userId) || userId,
      text: slackToPlainText(msg.text || '', userNames),
      ts: msg.ts || '',
      isReply: msg.isReply,
      replyCount: msg.reply_count || 0,
    };
  });

  return { messages, truncated };
}

async function getThreadReplies(token: string, channelId: string, threadTs: string) {
  const replies: RawMessage[] = [];
  let cursor: string | undefined;
  do {
    const result = await slackApi<SlackResponse & { messages?: RawMessage[] }>(
      'conversations.replies', token, { channel: channelId, ts: threadTs, limit: 200, cursor }
    );
    replies.push(...(result.messages || []).filter((msg) => msg.ts !== threadTs && !msg.subtype));
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return replies;
}

async function resolveUserNames(token: string, messages: RawMessage[]): Promise<Map<string, string>> {
  const userIds = new Set<string>();
  for (const msg of messages) {
    if (msg.user) userIds.add(msg.user);
    for (const id of mentionedUserIds(msg.text || '')) userIds.add(id);
  }

  const names = new Map<string, string>();
  for (const userId of userIds) {
    try {
      const info = await slackApi<SlackResponse & {
        user?: { name?: string; real_name?: string; profile?: { display_name?: string } };
      }>('users.info', token, { user: userId });
      names.set(
        userId,
        info.user?.profile?.display_name || info.user?.real_name || info.user?.name || userId
      );
    } catch {
      names.set(userId, userId);
    }
  }
  return names;
}

export function formatSlackDate(ts: string): string {
  return new Date(Number(ts) * 1000).toISOString().replace('T', ' ').slice(0, 16);
}
