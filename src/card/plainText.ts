/**
 * Markdown → plain text, for the canvas body preview (spec 7.3, LOD `full`).
 *
 * This is deliberately a lightweight unmarshaller rather than a parser: the
 * preview is one truncated line inside a 240 px card, and pulling the full
 * remark pipeline in for every visible node would cost more than it renders.
 */

const FENCE = /^[ \t]*(?:```|~~~).*$/gm;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const REF_LINK = /\[([^\]]*)\]\[[^\]]*\]/g;
const AUTOLINK = /<((?:https?|mailto):[^>\s]+)>/g;
const HTML_TAG = /<\/?[A-Za-z][^>]*>/g;
const HEADING = /^[ \t]*#{1,6}[ \t]+/gm;
const QUOTE = /^[ \t]*>+[ \t]?/gm;
const RULE = /^[ \t]*(?:[-*_][ \t]*){3,}$/gm;
const TASK_MARKER = /^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]*/gm;
const BULLET = /^[ \t]*[-*+][ \t]+/gm;
const ORDERED = /^[ \t]*\d+[.)][ \t]+/gm;
const TABLE_DIVIDER = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm;
const STRONG = /(\*\*|__)(.+?)\1/g;
const EMPHASIS = /(^|[\s(«"'])[*_]([^*_\n]+)[*_](?=[\s).,;:!?»"']|$)/g;
const STRIKE = /~~(.+?)~~/g;
const CODE_SPAN = /`+([^`]+)`+/g;
const WHITESPACE = /\s+/g;

/**
 * The first `maxChars` characters of `markdown` with its syntax removed,
 * collapsed onto a single line. Truncation falls back to a word boundary when
 * one is close enough, and appends an ellipsis.
 */
export function plainTextPreview(markdown: string, maxChars: number): string {
  if (typeof markdown !== 'string' || markdown.length === 0) return '';

  const text = markdown
    .replace(FENCE, '')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(REF_LINK, '$1')
    .replace(AUTOLINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(RULE, ' ')
    .replace(TABLE_DIVIDER, ' ')
    .replace(HEADING, '')
    .replace(QUOTE, '')
    .replace(TASK_MARKER, '')
    .replace(BULLET, '')
    .replace(ORDERED, '')
    .replace(STRONG, '$2')
    .replace(EMPHASIS, '$1$2')
    .replace(STRIKE, '$1')
    .replace(CODE_SPAN, '$1')
    .replace(/\|/g, ' ')
    .replace(WHITESPACE, ' ')
    .trim();

  return truncate(text, maxChars);
}

function truncate(text: string, maxChars: number): string {
  const limit = Math.max(0, Math.floor(maxChars));
  if (limit === 0) return '';
  if (text.length <= limit) return text;

  const head = text.slice(0, limit);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > limit * 0.6 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}
