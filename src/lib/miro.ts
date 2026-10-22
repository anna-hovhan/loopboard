import { fetchWithRetry } from './http';
import { nextFramePosition } from '../utils/layout';

const MIRO_API_BASE = 'https://api.miro.com/v2';

interface MiroRequestOptions {
  method?: string;
  body?: unknown;
  accessToken: string;
}

async function miroFetch<T>(path: string, opts: MiroRequestOptions): Promise<T> {
  const { method = 'GET', body, accessToken } = opts;

  const res = await fetchWithRetry(`${MIRO_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Miro API ${method} ${path} failed (${res.status}): ${errorText}`);
  }

  return res.json() as Promise<T>;
}

function boardPath(boardId: string): string {
  return `/boards/${encodeURIComponent(boardId)}`;
}

/** Accepts a board ID or any miro.com/app/board/<id>/ link. */
export function parseBoardId(boardOrUrl: string): string {
  const match = boardOrUrl.match(/\/board\/([^/?#]+)/);
  return decodeURIComponent(match ? match[1] : boardOrUrl.trim());
}

export function boardUrl(boardId: string): string {
  return `https://miro.com/app/board/${encodeURIComponent(boardId)}/`;
}

export function itemUrl(boardId: string, itemId: string): string {
  return `${boardUrl(boardId)}?moveToWidget=${itemId}`;
}

export interface MiroFrame {
  id: string;
  type: 'frame';
  data: { title: string };
  position: { x: number; y: number };
  geometry: { width: number; height: number };
}

export interface MiroBoardItem {
  id: string;
  type: string;
  data?: { content?: string; title?: string; description?: string };
  style?: Record<string, unknown>;
  position?: { x: number; y: number };
  geometry?: { width?: number; height?: number };
}

export async function getBoard(boardId: string, accessToken: string) {
  return miroFetch<{ id: string; name: string; viewLink?: string }>(boardPath(boardId), { accessToken });
}

export async function listBoards(accessToken: string, query?: string) {
  const params = new URLSearchParams({ limit: '50', sort: 'last_modified' });
  if (query) params.set('query', query);
  const res = await miroFetch<{ data: Array<{ id: string; name: string; viewLink?: string }> }>(
    `/boards?${params}`, { accessToken }
  );
  return res.data.map((board) => ({ id: board.id, name: board.name, url: board.viewLink }));
}

async function listItems(
  boardId: string,
  accessToken: string,
  filter: Record<string, string>
): Promise<MiroBoardItem[]> {
  const allItems: MiroBoardItem[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ ...filter, limit: '50' });
    if (cursor) params.set('cursor', cursor);

    const res = await miroFetch<{
      data: MiroBoardItem[];
      cursor?: string;
    }>(`${boardPath(boardId)}/items?${params}`, { accessToken });

    allItems.push(...res.data);
    cursor = res.cursor;
  } while (cursor);

  return allItems;
}

export async function listFrames(boardId: string, accessToken: string): Promise<MiroFrame[]> {
  const items = await listItems(boardId, accessToken, { type: 'frame' });
  return items.map((item) => ({
    id: item.id,
    type: 'frame' as const,
    data: { title: item.data?.title || '' },
    position: { x: item.position?.x ?? 0, y: item.position?.y ?? 0 },
    geometry: { width: item.geometry?.width ?? 0, height: item.geometry?.height ?? 0 },
  }));
}

export async function getFrameItems(
  boardId: string,
  accessToken: string,
  frameId: string
): Promise<MiroBoardItem[]> {
  return listItems(boardId, accessToken, { parent_item_id: frameId });
}

/**
 * Accepts a frame ID, a link with ?moveToWidget=<id>, or a frame title
 * (exact match first, then a unique partial match).
 */
export async function resolveFrame(
  boardId: string,
  accessToken: string,
  frame: string
): Promise<MiroFrame> {
  const frames = await listFrames(boardId, accessToken);
  const widgetMatch = frame.match(/moveToWidget=(\d+)/);
  const wanted = (widgetMatch ? widgetMatch[1] : frame).trim();

  const byId = frames.find((f) => f.id === wanted);
  if (byId) return byId;

  const lower = wanted.toLowerCase();
  const exact = frames.filter((f) => f.data.title.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];

  const partial = frames.filter((f) => f.data.title.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];

  const candidates = (exact.length > 1 ? exact : partial).map((f) => `"${f.data.title}" (${f.id})`);
  if (candidates.length > 1) {
    throw new Error(`Several frames match "${frame}": ${candidates.join(', ')}. Pass the frame ID.`);
  }
  throw new Error(`No frame matching "${frame}" on this board. Use miro_list_frames to see them.`);
}

export async function createFrame(
  boardId: string,
  accessToken: string,
  title: string,
  width: number,
  height: number,
  position: { x: number; y: number }
): Promise<MiroFrame> {
  return miroFetch(`${boardPath(boardId)}/frames`, {
    method: 'POST',
    accessToken,
    body: {
      data: { title, format: 'custom' },
      position: { x: position.x, y: position.y, origin: 'center' },
      geometry: { width, height },
    },
  });
}

/** Creates a frame of the given size to the right of every existing frame. */
export async function createFrameInFreeSpace(
  boardId: string,
  accessToken: string,
  title: string,
  size: { width: number; height: number }
): Promise<MiroFrame> {
  const existing = await listFrames(boardId, accessToken);
  const position = nextFramePosition(
    existing.map((f) => ({ ...f.position, ...f.geometry })),
    size
  );
  return createFrame(boardId, accessToken, title, size.width, size.height, position);
}

export async function createStickyNote(
  boardId: string,
  accessToken: string,
  content: string,
  color: string,
  position: { x: number; y: number },
  parentFrameId?: string
) {
  const body: Record<string, unknown> = {
    data: { content, shape: 'square' },
    style: { fillColor: color, textAlign: 'left', textAlignVertical: 'top' },
    position: { x: position.x, y: position.y, origin: 'center' },
  };
  if (parentFrameId) {
    body.parent = { id: parentFrameId };
  }
  return miroFetch<{ id: string }>(`${boardPath(boardId)}/sticky_notes`, {
    method: 'POST',
    accessToken,
    body,
  });
}

export async function createCard(
  boardId: string,
  accessToken: string,
  title: string,
  description: string,
  position: { x: number; y: number },
  parentFrameId?: string
) {
  const body: Record<string, unknown> = {
    data: { title, description },
    position: { x: position.x, y: position.y, origin: 'center' },
    geometry: { width: 320 },
  };
  if (parentFrameId) {
    body.parent = { id: parentFrameId };
  }
  return miroFetch<{ id: string }>(`${boardPath(boardId)}/cards`, {
    method: 'POST',
    accessToken,
    body,
  });
}

export async function updateCardTitle(
  boardId: string,
  accessToken: string,
  itemId: string,
  title: string
) {
  return miroFetch(`${boardPath(boardId)}/cards/${itemId}`, {
    method: 'PATCH',
    accessToken,
    body: { data: { title } },
  });
}

const CONTENT_ENDPOINTS: Record<string, string> = {
  sticky_note: 'sticky_notes',
  text: 'texts',
  shape: 'shapes',
};

export async function updateItemContent(
  boardId: string,
  accessToken: string,
  itemType: string,
  itemId: string,
  content: string
) {
  const endpoint = CONTENT_ENDPOINTS[itemType];
  if (!endpoint) throw new Error(`Cannot update content of a ${itemType}`);
  return miroFetch(`${boardPath(boardId)}/${endpoint}/${itemId}`, {
    method: 'PATCH',
    accessToken,
    body: { data: { content } },
  });
}

export interface BoardItemSpec {
  type: 'card' | 'sticky_note';
  title?: string;
  content: string;
  color?: string;
  position: { x: number; y: number };
}

/** Creates items one by one inside a frame; returns how many were created. */
export async function createItemsInFrame(
  boardId: string,
  accessToken: string,
  frameId: string,
  items: BoardItemSpec[]
): Promise<number> {
  for (const item of items) {
    if (item.type === 'card') {
      await createCard(boardId, accessToken, item.title || '', item.content, item.position, frameId);
    } else {
      await createStickyNote(
        boardId, accessToken, item.content, item.color || 'light_yellow', item.position, frameId
      );
    }
  }
  return items.length;
}
