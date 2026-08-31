/**
 * A one-line plain-text reduction of markdown, for the card body preview on the
 * canvas (spec 7.3). Rendering markdown in three hundred nodes is not worth the
 * frames — the editor panel renders the real thing.
 */
const RULES: ReadonlyArray<[RegExp, string]> = [
  [/```[\s\S]*?```/g, ' '], // fenced code
  [/`([^`]+)`/g, '$1'], // inline code
  [/!\[[^\]]*\]\([^)]*\)/g, ' '], // images
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'], // links
  [/^\s{0,3}>+\s?/gm, ''], // block quotes
  [/^\s{0,3}#{1,6}\s+/gm, ''], // headings
  [/^\s{0,3}([-*_]\s*){3,}$/gm, ' '], // thematic breaks
  [/^\s*([-*+]|\d+[.)])\s+/gm, ''], // list markers
  [/^\s*\|.*\|\s*$/gm, ' '], // tables
  [/<\/?[a-z][^>]*>/gi, ' '], // inline html
  [/(\*\*|__|\*|_|~~)/g, ''], // emphasis
];

export function stripMarkdown(source: string): string {
  let text = source;
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, ' ').trim();
}

/** Stripped and cut to `limit` characters on a word boundary. */
export function previewText(source: string, limit = 140): string {
  const text = stripMarkdown(source);
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
