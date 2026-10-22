/**
 * Deterministic color assignment based on a string key (e.g., user ID).
 * Uses Miro's supported sticky note colors.
 */

export const MIRO_STICKY_COLORS = [
  'light_yellow',
  'yellow',
  'light_green',
  'green',
  'dark_green',
  'cyan',
  'light_blue',
  'blue',
  'dark_blue',
  'light_pink',
  'pink',
  'violet',
  'red',
  'orange',
  'gray',
] as const;

export type StickyColor = (typeof MIRO_STICKY_COLORS)[number];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function colorForKey(key: string): StickyColor {
  const index = hashString(key) % MIRO_STICKY_COLORS.length;
  return MIRO_STICKY_COLORS[index];
}

const SOURCE_COLORS: Record<string, StickyColor> = {
  slack: 'light_yellow',
  jira: 'light_blue',
  synthesis: 'light_green',
};

export function colorForSource(source: string): StickyColor {
  return SOURCE_COLORS[source] || 'gray';
}
