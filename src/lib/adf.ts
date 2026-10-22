/**
 * Minimal conversion between Atlassian Document Format (Jira Cloud's rich
 * text JSON) and plain text. Enough to read descriptions and comments and to
 * write paragraph-based descriptions back.
 */

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock', 'rule', 'panel', 'listItem', 'tableRow',
]);

export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return '';
  return render(node).replace(/\n{3,}/g, '\n\n').trim();
}

function render(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return node.text || '';
    case 'hardBreak':
      return '\n';
    case 'mention':
      return String(node.attrs?.text || '@someone');
    case 'emoji':
      return String(node.attrs?.text || node.attrs?.shortName || '');
    case 'inlineCard':
    case 'blockCard':
      return String(node.attrs?.url || '');
    case 'listItem':
      return `• ${renderChildren(node).trim()}\n`;
    case 'tableCell':
    case 'tableHeader':
      return `${renderChildren(node).trim()} | `;
  }
  const inner = renderChildren(node);
  return BLOCK_TYPES.has(node.type) ? `${inner}\n` : inner;
}

function renderChildren(node: AdfNode): string {
  return (node.content || []).map(render).join('');
}

/** Blank lines separate paragraphs; single newlines become hard breaks. */
export function textToAdf(text: string): { type: 'doc'; version: 1; content: AdfNode[] } {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const content: AdfNode[] = [];
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' });
        if (line) content.push({ type: 'text', text: line });
      });
      return { type: 'paragraph', content };
    });

  return { type: 'doc', version: 1, content: paragraphs };
}
